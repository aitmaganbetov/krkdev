"""Комитет ректорского контроля: составы комитета по учебным годам (приказы) и их члены.

На каждый учебный год — свой состав (committee_orders.academic_year). Состав формируется в системе как проект
приказа и отправляется на подпись выбранному подписанту: он подписывает документ своей ЭЦП (NCALayer → Kalkan +
OCSP, ИИН сертификата = ИИН подписанта в Platonus), после чего приказ неизменяем и становится действующим.
Подлинность проверяется по QR-коду (verify_token) на открытой странице. Приказ, подписанный на бумаге
(скан, номер и дата внесены вручную), делается действующим кнопкой.
Действует один приказ (is_active). Члены его состава, сопоставленные с преподавателями Platonus, получают роль
«Член комитета КРК» (права «Сотрудника» — проверки занятий): роль выставляет auth_service.sync_auto_roles
после каждого изменения действующего состава.

ФИО члена («Фамилия И.О.») и должность берутся из карточки преподавателя: снимок Platonus (people_profiles)
и правки КРК поверх него (people_overrides). Тексты сохраняются в составе — утверждённый приказ не меняется
сам при следующей синхронизации; обновить их из Platonus можно явно (refresh_members).
"""
import hashlib
import json
import logging
import os
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy import bindparam, func, inspect, text
from sqlalchemy.orm import Session

from migrations import RECTOR_SETTING_KEY
from models.committee import CommitteeMember, CommitteeOrder
from services.auth_service import sync_auto_roles
from services.ecp_signing import verify_signature
from services.notification_service import login_aliases, notify
from services.peer_visit_schedule_service import TutorMatcher, fold_name
from services.people_service import KIND_TUTOR, attach_accounts

ORDER_FIELDS = ("number", "order_date", "academic_year", "title_ru", "title_kz", "purpose_ru", "purpose_kz",
                "basis_ru", "basis_kz", "signer_tutor_id", "signer_position")
UTC_PLUS_5 = timedelta(hours=5)
logger = logging.getLogger(__name__)
MAX_FILE_SIZE = 20 * 1024 * 1024
# Поля карточки преподавателя, из которых собираются ФИО и должность члена комитета
PERSON_FIELDS = ("full_name", "job_title", "scientific_degree", "academic_status")
# Должности, которые пишутся без кафедры («Декан технологического факультета»)
_STANDALONE_JOB = re.compile(r"декан|ректор|директор|руковод", re.IGNORECASE)
# «Заведующий кафедрой», «Заведующая кафедрой», «Зав.каф»
_HEAD_OF_CAFEDRA = re.compile(r"заведующ\w*\s+кафедр|зав\.?\s*каф", re.IGNORECASE)
_LATIN_LOOKALIKES = str.maketrans("aceopxyACEOPXHKMTB", "асеорхуАСЕОРХНКМТВ")


def files_dir() -> str:
    return os.getenv("COMMITTEE_FILES_DIR", "/app/media/committee")


# Колонки электронной подписи (добавлены после первой версии таблицы)
_SIGNING_COLUMNS = {
    "signer_tutor_id": "INT NULL, ADD KEY ix_committee_orders_signer (signer_tutor_id)",
    "signer_position": "VARCHAR(255) NULL",
    "sent_at": "DATETIME NULL",
    "signed_at": "DATETIME NULL",
    "signature_cms": "LONGTEXT NULL",
    "signature_info": "JSON NULL",
    "document_hash": "VARCHAR(64) NULL",
    "verify_token": "VARCHAR(32) NULL, ADD UNIQUE KEY uq_committee_orders_verify (verify_token)",
    "signed_members": "JSON NULL",
}


def ensure_committee_schema(engine) -> None:
    """Стартовая миграция: номер и дата приказа необязательны — у проекта состава их ещё нет;
    колонки подписания ЭЦП (таблицы создаёт create_all)."""
    with engine.begin() as conn:
        if "committee_orders" not in inspect(conn).get_table_names():
            return
        columns = {c["name"]: c for c in inspect(conn).get_columns("committee_orders")}
        if not columns["number"]["nullable"] or not columns["order_date"]["nullable"]:
            conn.execute(text("ALTER TABLE committee_orders MODIFY number VARCHAR(50) NULL, MODIFY order_date DATE NULL"))
        for name, definition in _SIGNING_COLUMNS.items():
            if name not in columns:
                conn.execute(text(f"ALTER TABLE committee_orders ADD COLUMN {name} {definition}"))


# --- ФИО и должность из карточки преподавателя ---

def _text(value, lang: str) -> str:
    """Значение справочника Platonus — {ru, kz, en}; правка КРК и свободный текст Platonus — строка."""
    if isinstance(value, dict):
        value = value.get(lang) or value.get("ru")
    # Двойные пробелы из Platonus («Старший  преподаватель»)
    return " ".join(value.split()) if isinstance(value, str) else ""


def _lower_first(value: str) -> str:
    """«Кандидат наук» → «кандидат наук»; аббревиатуры («PhD докторы») не трогаются."""
    first = value.split(" ", 1)[0]
    return value[:1].lower() + value[1:] if first[1:2].islower() and not any(ch.isupper() for ch in first[1:]) else value


def _fix_lookalikes(value: Optional[str]) -> Optional[str]:
    """Латинские буквы-двойники в кириллических словах из Platonus («Cоциально…» с латинской C)."""
    if not value:
        return value
    return " ".join(w.translate(_LATIN_LOOKALIKES) if re.search("[а-яәғқңөұүһі]", w, re.IGNORECASE) else w for w in value.split())


def short_name(full_name: str) -> str:
    """«Сафуани Жанар Есенқұлқызы» → «Сафуани Ж.Е.» (как в приказах); ФИО заглавными буквами — с заглавной."""
    words = (full_name or "").split()
    if not words:
        return ""
    words = [w.capitalize() if w.isupper() else w for w in words]
    return " ".join([words[0], "".join(f"{w[0]}." for w in words[1:3])]).strip()


def _faculty_genitive_ru(name: str) -> str:
    """«Технологический факультет» → «технологического факультета»,
    «Факультет экономики и бизнеса» → «факультета экономики и бизнеса»."""
    words = name.split()
    if words and words[0].lower() == "факультет":
        return " ".join(["факультета", *(_lower_first(w) for w in words[1:2]), *words[2:]])
    if len(words) == 2 and words[1].lower() == "факультет" and words[0].lower().endswith(("ий", "ый")):
        return f"{words[0][:-2].lower()}ого факультета"
    return f"факультета «{name}»"


def _faculty_genitive_kz(name: str) -> str:
    """«Технологиялық факультеті» → «Технологиялық факультетінің»."""
    return f"{name}нің" if name.endswith("факультеті") else f"«{name}» факультетінің"


def compose_position(job, degree, status, cafedra_ru: Optional[str], cafedra_kz: Optional[str],
                     dean_of: Optional[tuple[str, str]] = None, head_of: Optional[tuple[str, str]] = None) -> tuple[str, str]:
    """Должность для приказа на русском и казахском, как в приказе о комитете:
    декан (faculties.facultyDean в Platonus) — «Декан технологического факультета»;
    заведующий (cafedras.cafedraManager) — «Заведующий кафедрой «…»»; остальные — «Старший преподаватель
    кафедры «IT», кандидат наук», без должности в Platonus — «ППС кафедры …». Степень и звание — только
    у преподавателей, как в приказе. «Зав.каф» в тексте должности без назначения заведующим в Platonus устарел."""
    result = []
    cafedra_ru, cafedra_kz = _fix_lookalikes(cafedra_ru), _fix_lookalikes(cafedra_kz)
    for lang, cafedra in (("ru", cafedra_ru), ("kz", cafedra_kz or cafedra_ru)):
        title = _text(job, lang)
        if dean_of:
            faculty_ru, faculty_kz = dean_of
            result.append(f"Декан {_faculty_genitive_ru(faculty_ru)}" if lang == "ru" else f"{_faculty_genitive_kz(faculty_kz or faculty_ru)} деканы")
            continue
        if head_of:
            head_ru, head_kz = _fix_lookalikes(head_of[0]), _fix_lookalikes(head_of[1] or head_of[0])
            result.append(f"Заведующий кафедрой «{head_ru}»" if lang == "ru" else f"«{head_kz}» кафедрасының меңгерушісі")
            continue
        if _HEAD_OF_CAFEDRA.search(_text(job, "ru")):
            title = ""
        if title and _STANDALONE_JOB.search(_text(job, "ru")):
            head = title
        elif cafedra:
            if lang == "ru":
                head = f"{title[:1].upper()}{title[1:]} кафедры «{cafedra}»" if title else f"ППС кафедры «{cafedra}»"
            else:
                head = f"«{cafedra}» кафедрасының {_lower_first(title) if title else 'ПОҚ'}"
        else:
            head = title or ("ППС" if lang == "ru" else "ПОҚ")
        extras = [_lower_first(_text(degree, lang)), _lower_first(_text(status, lang))]
        result.append(", ".join([head, *[e for e in extras if e]]))
    return result[0], result[1]


def short_title(job, degree, status, dean: bool = False, head: bool = False) -> str:
    """Должность и степень без кафедры — для графика взаимопосещения: «старший преподаватель, кандидат наук».
    Декан и заведующий — по назначению в Platonus (faculties.facultyDean, cafedras.cafedraManager)."""
    title = "декан" if dean else "заведующий кафедрой" if head else _lower_first(_text(job, "ru"))
    if not dean and not head and _HEAD_OF_CAFEDRA.search(title):
        title = ""  # «Зав.каф» без назначения в Platonus устарел
    parts = [title, _lower_first(_text(degree, "ru")), _lower_first(_text(status, "ru"))]
    return ", ".join(dict.fromkeys(part for part in parts if part))


# Уровень преподавателя для распределения проверок: проверяющий — не ниже проверяемого
# (профессор проверяет всех, ассоциированный профессор — всех, кроме профессоров)
RANK_PROFESSOR, RANK_ASSOCIATE, RANK_DEGREE, RANK_TEACHER = 4, 3, 2, 1


def academic_rank(job, degree, status) -> int:
    """Профессор или доктор наук → 4; ассоциированный профессор, доцент (и и.о.) → 3; кандидат наук, PhD → 2;
    остальные → 1. Звание, должность и степень — из карточки Platonus с правками КРК."""
    titles = f"{_text(status, 'ru')} {_text(job, 'ru')}".lower()
    degree = _text(degree, "ru").lower()
    if ("профессор" in titles and "ассоциир" not in titles) or degree == "доктор наук":
        return RANK_PROFESSOR
    if "доцент" in titles or "ассоциир" in titles or "доцент" in degree:
        return RANK_ASSOCIATE
    if "кандидат" in degree or "phd" in degree or "доктор" in degree:
        return RANK_DEGREE
    return RANK_TEACHER


def tutor_people(db: Session, tutor_ids: Optional[Iterable[int]] = None, with_title: bool = False) -> dict[int, dict]:
    """ФИО «Фамилия И.О.» и должность (ru/kz) преподавателей по карточке: Platonus + правки КРК.
    with_title — ещё title: должность и степень без кафедры (short_title) и rank (academic_rank)."""
    ids = None if tutor_ids is None else sorted({int(i) for i in tutor_ids})
    if ids == []:
        return {}
    where = "" if ids is None else "WHERE t.tutor_id IN :ids"
    params = {} if ids is None else {"ids": ids}
    query = text(f"""
        SELECT t.tutor_id, t.full_name, t.login, c.cafedraNameRU AS cafedra_ru, c.cafedraNameKZ AS cafedra_kz, p.data,
               f.facultyNameRU AS dean_of_ru, f.facultyNameKZ AS dean_of_kz,
               mc.cafedraNameRU AS head_of_ru, mc.cafedraNameKZ AS head_of_kz
        FROM tutors t
        LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        LEFT JOIN faculties f ON f.dean_tutor_id = t.tutor_id
        LEFT JOIN cafedras mc ON mc.manager_tutor_id = t.tutor_id
        LEFT JOIN people_profiles p ON p.kind = '{KIND_TUTOR}' AND p.person_id = t.tutor_id
        {where}
    """)
    if ids is not None:
        query = query.bindparams(bindparam("ids", expanding=True))
    rows = db.execute(query, params).mappings().all()
    overrides: dict[int, dict] = {}
    override_query = text("SELECT person_id, field, value FROM people_overrides WHERE kind = :kind AND field IN :fields"
                          + ("" if ids is None else " AND person_id IN :ids"))
    override_query = override_query.bindparams(bindparam("fields", expanding=True))
    if ids is not None:
        override_query = override_query.bindparams(bindparam("ids", expanding=True))
    for row in db.execute(override_query, {"kind": KIND_TUTOR, "fields": list(PERSON_FIELDS), **params}).mappings():
        overrides.setdefault(row["person_id"], {})[row["field"]] = row["value"]

    people = {}
    for row in rows:
        profile = row["data"] if isinstance(row["data"], dict) else json.loads(row["data"] or "{}")
        profile = {**profile, **overrides.get(row["tutor_id"], {})}
        dean_of = (row["dean_of_ru"], row["dean_of_kz"]) if row["dean_of_ru"] else None
        head_of = (row["head_of_ru"], row["head_of_kz"]) if row["head_of_ru"] else None
        position_ru, position_kz = compose_position(profile.get("job_title"), profile.get("scientific_degree"),
                                                    profile.get("academic_status"), row["cafedra_ru"], row["cafedra_kz"], dean_of, head_of)
        people[row["tutor_id"]] = {
            "name": short_name(_text(profile.get("full_name"), "ru") or row["full_name"]),
            "position_ru": position_ru,
            "position_kz": position_kz,
        }
        if with_title:
            people[row["tutor_id"]]["title"] = short_title(profile.get("job_title"), profile.get("scientific_degree"),
                                                           profile.get("academic_status"), bool(dean_of), bool(head_of))
            people[row["tutor_id"]]["rank"] = academic_rank(profile.get("job_title"), profile.get("scientific_degree"),
                                                            profile.get("academic_status"))
    return people


def _person(db: Session, tutor_id: int) -> dict:
    person = tutor_people(db, [tutor_id]).get(tutor_id)
    if not person:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Преподаватель не найден в справочнике")
    return person


def match_tutor(matcher: TutorMatcher, name: str) -> Optional[int]:
    """Преподаватель по ФИО из приказа (импорт). Кроме правил TutorMatcher — фамилия и инициал имени,
    если в Platonus нет отчества («Серимбетов Б.А.» → «Серимбетов Булат»)."""
    tutor = matcher.match(name)
    if tutor:
        return tutor["tutor_id"]
    words = fold_name(name).split()
    if len(words) < 2 or len(words[1]) != 1:
        return None
    ids = set(matcher.initials.get(f"{words[0]} {words[1]}", []))
    return ids.pop() if len(ids) == 1 else None


def rector_tutor_id(db: Session) -> Optional[int]:
    """Ректор из Platonus (university.rectorID, сохраняется при синхронизации справочников)."""
    try:
        value = db.execute(text("SELECT value_text FROM system_settings WHERE `key` = :key"), {"key": RECTOR_SETTING_KEY}).scalar()
    except Exception:
        db.rollback()
        return None
    return int(value) if value and value.isdigit() else None


# --- Приказы ---

def get_order(db: Session, order_id: int) -> CommitteeOrder:
    order = db.get(CommitteeOrder, order_id)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Приказ не найден")
    return order


def get_member(db: Session, member_id: int) -> CommitteeMember:
    member = db.get(CommitteeMember, member_id)
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Член комитета не найден")
    return member


def _check_academic_year(db: Session, name: str, order_id: Optional[int] = None) -> None:
    """Учебный год — из справочника учебных годов (academic_years); на год — один состав комитета."""
    if not db.execute(text("SELECT 1 FROM academic_years WHERE name = :name"), {"name": name}).first():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Учебного года нет в справочнике")
    query = db.query(CommitteeOrder.id).filter(CommitteeOrder.academic_year == name)
    if order_id:
        query = query.filter(CommitteeOrder.id != order_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Состав комитета на {name} учебный год уже есть")


def _check_number(db: Session, number: Optional[str], order_id: Optional[int] = None) -> None:
    if not number:
        return
    query = db.query(CommitteeOrder.id).filter(CommitteeOrder.number == number)
    if order_id:
        query = query.filter(CommitteeOrder.id != order_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ с таким номером уже есть")


def _commit(db: Session, order: CommitteeOrder) -> None:
    db.commit()
    # Состав действующего приказа определяет, кто проводит проверки
    if order.is_active:
        sync_auto_roles()


def order_summary(db: Session, order: CommitteeOrder) -> dict:
    members = db.query(func.count(CommitteeMember.id)).filter(CommitteeMember.order_id == order.id).scalar()
    return {
        "id": order.id,
        "number": order.number,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "academic_year": order.academic_year,
        "title_ru": order.title_ru,
        "title_kz": order.title_kz,
        "is_active": bool(order.is_active),
        "status": order_status(order),
        # Можно сделать действующим: подписан ЭЦП или на бумаге (внесены номер и дата)
        "is_signed": order_status(order) in ("signed", "registered"),
        "members_count": int(members or 0),
    }


def order_status(order: CommitteeOrder) -> str:
    """draft — проект; on_signing — отправлен на подпись ЭЦП; signed — подписан ЭЦП;
    registered — подписан на бумаге (номер и дата внесены вручную)."""
    if order.signed_at:
        return "signed"
    if order.sent_at:
        return "on_signing"
    return "registered" if order.number and order.order_date else "draft"


def _ensure_editable(order: CommitteeOrder) -> None:
    """Отправленный на подпись и подписанный ЭЦП документ не меняется: подпись относится к его содержимому."""
    if order.signed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ подписан ЭЦП — изменения запрещены")
    if order.sent_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ на подписи — сначала отзовите его")


def list_orders(db: Session) -> list[dict]:
    orders = db.query(CommitteeOrder).order_by(CommitteeOrder.academic_year.desc(), CommitteeOrder.id.desc()).all()
    return [order_summary(db, order) for order in orders]


def order_detail(db: Session, order: CommitteeOrder) -> dict:
    rows = db.execute(text("""
        SELECT m.id, m.position, m.name, m.position_ru, m.position_kz, m.tutor_id,
               t.full_name AS tutor_name, t.login,
               c.cafedraNameRU AS cafedra_name_ru, c.cafedraNameKZ AS cafedra_name_kz, c.cafedraNameEN AS cafedra_name_en
        FROM committee_members m
        LEFT JOIN tutors t ON t.tutor_id = m.tutor_id
        LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        WHERE m.order_id = :order_id
        ORDER BY m.position, m.id
    """), {"order_id": order.id}).mappings().all()
    members = attach_accounts(db, [dict(row) for row in rows])
    for member in members:
        # Преподаватель мог пропасть из справочника после синхронизации — тогда привязка недействительна
        member["linked"] = member["tutor_name"] is not None
    return {
        **order_summary(db, order),
        "purpose_ru": order.purpose_ru,
        "purpose_kz": order.purpose_kz,
        "basis_ru": order.basis_ru,
        "basis_kz": order.basis_kz,
        "signed_by": order.signed_by,
        "signer_tutor_id": order.signer_tutor_id,
        "signer_position": order.signer_position,
        "signer_full_name": _tutor_full_name(db, order.signer_tutor_id),
        "sent_at": order.sent_at.isoformat() if order.sent_at else None,
        "signed_at": order.signed_at.isoformat() if order.signed_at else None,
        "signature": order.signature_info,
        "verify_token": order.verify_token,
        "document_hash": order.document_hash,
        "has_file": bool(order.file_name),
        "members": members,
        "removed_after_signing": removed_after_signing(db, order),
    }


def _tutor_full_name(db: Session, tutor_id: Optional[int]) -> Optional[str]:
    if not tutor_id:
        return None
    return db.execute(text("SELECT full_name FROM tutors WHERE tutor_id = :id"), {"id": tutor_id}).scalar()


def _signer_initials(full_name: str) -> str:
    """«Байболова Ляззат Кемербековна» → «Л. Байболова» (подпись в приказе)."""
    words = (full_name or "").split()
    return " ".join(([f"{words[1][0]}."] if len(words) > 1 else []) + words[:1])


def _apply_signer(db: Session, order: CommitteeOrder) -> None:
    """Подпись в приказе — из должности и ФИО выбранного сотрудника Platonus."""
    if order.signer_tutor_id is None:
        order.signed_by = order.signer_position or None
        return
    full_name = _tutor_full_name(db, order.signer_tutor_id)
    if not full_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Подписант не найден в справочнике")
    order.signed_by = " ".join(filter(None, [order.signer_position, _signer_initials(full_name)]))


def create_order(db: Session, data: dict, created_by: str, copy_from: Optional[CommitteeOrder] = None) -> CommitteeOrder:
    """Состав на учебный год (проект приказа, не действует до активации); состав можно скопировать
    из другого года — ФИО и должности при этом обновляются из Platonus."""
    _check_academic_year(db, data["academic_year"])
    _check_number(db, data.get("number"))
    order = CommitteeOrder(**{key: data.get(key) for key in ORDER_FIELDS}, is_active=False, created_by=created_by)
    if data.get("signed_by") and order.signer_tutor_id is None:
        # Импорт подписанного на бумаге приказа: подпись — как в скане
        order.signed_by = data["signed_by"]
    else:
        _apply_signer(db, order)
    db.add(order)
    db.flush()
    if copy_from:
        source = db.query(CommitteeMember).filter(CommitteeMember.order_id == copy_from.id).order_by(CommitteeMember.position).all()
        people = tutor_people(db, [m.tutor_id for m in source if m.tutor_id])
        for member in source:
            person = people.get(member.tutor_id) or {"name": member.name, "position_ru": member.position_ru, "position_kz": member.position_kz}
            db.add(CommitteeMember(order_id=order.id, position=member.position, tutor_id=member.tutor_id if member.tutor_id in people else None, **person))
    db.commit()
    return order


def import_order(db: Session, data: dict, created_by: str, activate: bool = True) -> tuple[CommitteeOrder, list[str]]:
    """Импорт подписанного приказа из JSON (data/krk_committee_*.json): ФИО и должности — как в приказе,
    члены сопоставляются с преподавателями по ФИО. Возвращает приказ и ФИО, которые не удалось сопоставить."""
    fields = dict(data["order"])
    fields["order_date"] = date.fromisoformat(fields["order_date"])
    order = create_order(db, fields, created_by)
    matcher = TutorMatcher(db)
    unmatched = []
    for index, row in enumerate(data["members"], start=1):
        tutor_id = match_tutor(matcher, row["name"])
        if tutor_id is None:
            unmatched.append(row["name"])
        db.add(CommitteeMember(order_id=order.id, position=index, name=row["name"].strip(),
                               position_ru=row.get("position_ru", "").strip(),
                               position_kz=(row.get("position_kz") or "").strip() or None, tutor_id=tutor_id))
    db.commit()
    if activate:
        activate_order(db, order)
    return order, unmatched


def update_order(db: Session, order: CommitteeOrder, data: dict) -> CommitteeOrder:
    _ensure_editable(order)
    if "academic_year" in data:
        _check_academic_year(db, data["academic_year"], order.id)
    if "number" in data:
        _check_number(db, data["number"], order.id)
    if order.is_active and (("number" in data and not data["number"]) or ("order_date" in data and not data["order_date"])):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="У действующего приказа должны быть номер и дата")
    for key, value in data.items():
        setattr(order, key, value)
    if {"signer_tutor_id", "signer_position"} & set(data):
        _apply_signer(db, order)
    db.commit()
    return order


def activate_order(db: Session, order: CommitteeOrder) -> CommitteeOrder:
    """Подписанный приказ становится действующим, прежний — нет; роли членов обоих составов пересчитываются."""
    if not (order.number and order.order_date):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Сначала внесите номер и дату подписанного приказа")
    db.query(CommitteeOrder).filter(CommitteeOrder.id != order.id).update({CommitteeOrder.is_active: False})
    order.is_active = True
    _commit(db, order)
    return order


def deactivate_order(db: Session, order: CommitteeOrder) -> CommitteeOrder:
    """Действующий приказ перестаёт действовать: члены его состава теряют роль «Член комитета КРК»."""
    if not order.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ и так не действует")
    order.is_active = False
    db.commit()
    sync_auto_roles()
    return order


def delete_order(db: Session, order: CommitteeOrder) -> None:
    if order.is_active:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Действующий приказ удалить нельзя — сначала сделайте действующим другой")
    if order.signed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Подписанный ЭЦП приказ удалить нельзя")
    file_name = order.file_name
    db.query(CommitteeMember).filter(CommitteeMember.order_id == order.id).delete()
    db.delete(order)
    db.commit()
    if file_name:
        _remove_quietly(os.path.join(files_dir(), file_name))


# --- Члены комитета ---

def _check_duplicate(db: Session, order_id: int, tutor_id: int, member_id: Optional[int] = None) -> None:
    query = db.query(CommitteeMember.id).filter(CommitteeMember.order_id == order_id, CommitteeMember.tutor_id == tutor_id)
    if member_id:
        query = query.filter(CommitteeMember.id != member_id)
    if query.first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Этот преподаватель уже есть в составе")


def add_member(db: Session, order: CommitteeOrder, tutor_id: int, position: Optional[int] = None) -> CommitteeMember:
    """Член комитета — преподаватель Platonus; ФИО и должность — из его карточки."""
    _ensure_editable(order)
    _check_duplicate(db, order.id, tutor_id)
    person = _person(db, tutor_id)
    if not position:
        last = db.query(func.max(CommitteeMember.position)).filter(CommitteeMember.order_id == order.id).scalar()
        position = int(last or 0) + 1
    member = CommitteeMember(order_id=order.id, position=position, tutor_id=tutor_id, **person)
    db.add(member)
    _commit(db, order)
    return member


def update_member(db: Session, member: CommitteeMember, data: dict) -> CommitteeMember:
    """Смена преподавателя — ФИО и должность заново из его карточки; порядковый номер — как задан."""
    _ensure_editable(get_order(db, member.order_id))
    if data.get("tutor_id") is not None and data["tutor_id"] != member.tutor_id:
        _check_duplicate(db, member.order_id, data["tutor_id"], member.id)
        member.tutor_id = data["tutor_id"]
        for key, value in _person(db, member.tutor_id).items():
            setattr(member, key, value)
    if data.get("position"):
        member.position = data["position"]
    _commit(db, get_order(db, member.order_id))
    return member


def refresh_members(db: Session, order: CommitteeOrder) -> int:
    """ФИО и должности сопоставленных членов — заново из карточек преподавателей. Возвращает число изменённых."""
    _ensure_editable(order)
    members = db.query(CommitteeMember).filter(CommitteeMember.order_id == order.id, CommitteeMember.tutor_id.isnot(None)).all()
    people = tutor_people(db, [m.tutor_id for m in members])
    changed = 0
    for member in members:
        person = people.get(member.tutor_id)
        if person and any(getattr(member, key) != value for key, value in person.items()):
            for key, value in person.items():
                setattr(member, key, value)
            changed += 1
    db.commit()
    return changed


def ensure_member_deletable(order: CommitteeOrder, after_signing: bool = False) -> None:
    """after_signing — суперадмин: из подписанного ЭЦП приказа удалить можно (подписанный состав сохраняется)."""
    if not (after_signing and order.signed_at):
        _ensure_editable(order)


def delete_member(db: Session, member: CommitteeMember, after_signing: bool = False) -> None:
    order = get_order(db, member.order_id)
    ensure_member_deletable(order, after_signing)
    if order.signed_at and order.signed_members is None:
        # Первое изменение после подписи: запоминаем подписанный состав — проверка подписи и PDF остаются по нему
        order.signed_members = _member_rows(db, order)
    db.delete(member)
    _commit(db, order)


def removed_after_signing(db: Session, order: CommitteeOrder) -> list[dict]:
    """Члены подписанного состава, удалённые из действующего после подписания."""
    if order.signed_members is None:
        return []
    current = {(m.tutor_id, m.name) for m in db.query(CommitteeMember).filter(CommitteeMember.order_id == order.id)}
    return [{"position": row[0], "tutor_id": row[1], "name": row[2], "position_ru": row[3], "position_kz": row[4]}
            for row in order.signed_members if (row[1], row[2]) not in current]


# --- Подписание ЭЦП ---

def _member_rows(db: Session, order: CommitteeOrder) -> list[list]:
    """Состав подписываемого документа: подписанный (signed_members), если после подписания он менялся, иначе текущий."""
    if order.signed_members is not None:
        return order.signed_members
    members = db.query(CommitteeMember).filter(CommitteeMember.order_id == order.id).order_by(CommitteeMember.position, CommitteeMember.id).all()
    return [[m.position, m.tutor_id, m.name, m.position_ru, m.position_kz] for m in members]


def _document_hash(db: Session, order: CommitteeOrder) -> str:
    """SHA-256 содержимого приказа: тексты, подписант и состав. Подпись ставится на этот отпечаток."""
    payload = {
        "id": order.id,
        "number": order.number,
        "academic_year": order.academic_year,
        **{key: getattr(order, key) for key in ("title_ru", "title_kz", "purpose_ru", "purpose_kz", "basis_ru", "basis_kz")},
        "signer": [order.signer_tutor_id, order.signed_by],
        "members": _member_rows(db, order),
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def sign_data(order: CommitteeOrder) -> str:
    """Подписываемые данные: адрес проверки и отпечаток содержимого приказа."""
    return f"krk-committee-order:{order.verify_token}:{order.document_hash}"


def _signer_logins(db: Session, tutor_id: Optional[int]) -> list[str]:
    login = db.execute(text("SELECT login FROM tutors WHERE tutor_id = :id"), {"id": tutor_id}).scalar() if tutor_id else None
    return [login.strip().lower()] if login and login.strip() else []


def is_signer(db: Session, order: CommitteeOrder, username: str) -> bool:
    """Текущий пользователь — выбранный подписант (логин Platonus с доменом и без)."""
    return bool(set(_signer_logins(db, order.signer_tutor_id)) & set(login_aliases(username)))


def send_for_signing(db: Session, order: CommitteeOrder) -> CommitteeOrder:
    """Проект → на подпись: содержимое фиксируется (отпечаток), подписанту — уведомление."""
    _ensure_editable(order)
    if not order.number:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Укажите номер приказа")
    if not order.signer_tutor_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Выберите подписанта")
    signer = db.execute(text("SELECT full_name, login, iin FROM tutors WHERE tutor_id = :id"), {"id": order.signer_tutor_id}).mappings().first()
    if not signer or not signer["iin"] or not (signer["login"] or "").strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="У подписанта нет ИИН или логина в Platonus — подписать ЭЦП в КРК он не сможет")
    if not db.query(CommitteeMember.id).filter(CommitteeMember.order_id == order.id).first():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="В составе нет членов комитета")
    _apply_signer(db, order)
    order.verify_token = order.verify_token or uuid.uuid4().hex
    order.document_hash = _document_hash(db, order)
    order.sent_at = datetime.utcnow()
    notify(db, signer["login"], "committee_signing", f"Приказ № {order.number} на подпись",
           f"Приказ о составе комитета ректорского контроля на {order.academic_year} учебный год", link=f"/signing/{order.id}")
    db.commit()
    return order


def recall_from_signing(db: Session, order: CommitteeOrder) -> CommitteeOrder:
    """На подписи → проект (для правок); подписанный ЭЦП не отзывается."""
    if order.signed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ уже подписан ЭЦП")
    order.sent_at = None
    order.document_hash = None
    db.commit()
    return order


def pending_for(db: Session, username: str) -> list[dict]:
    """Приказы, ожидающие подписи текущего пользователя."""
    logins = login_aliases(username)
    if not logins:
        return []
    tutor_ids = [row[0] for row in db.execute(
        text("SELECT tutor_id FROM tutors WHERE login IN :logins").bindparams(bindparam("logins", expanding=True)),
        {"logins": logins},
    )]
    if not tutor_ids:
        return []
    orders = (db.query(CommitteeOrder)
              .filter(CommitteeOrder.signer_tutor_id.in_(tutor_ids), CommitteeOrder.sent_at.isnot(None), CommitteeOrder.signed_at.is_(None))
              .order_by(CommitteeOrder.sent_at).all())
    return [{**order_summary(db, order), "sent_at": order.sent_at.isoformat()} for order in orders]


def sign_order(db: Session, order: CommitteeOrder, username: str, cms: str) -> CommitteeOrder:
    """Подпись приказа ЭЦП подписанта: проверка CMS (Kalkan + OCSP), подписанных данных и ИИН сертификата.
    Подписанный приказ становится действующим."""
    if order.signed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ уже подписан")
    if not order.sent_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Приказ не отправлен на подпись")
    if not is_signer(db, order, username):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Подписать может только выбранный подписант")
    if _document_hash(db, order) != order.document_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Содержимое приказа изменилось после отправки на подпись")
    signature = verify_signature(db, cms, sign_data(order), order.signer_tutor_id)

    now = datetime.utcnow()
    order.signed_at = now
    order.order_date = order.order_date or (now + UTC_PLUS_5).date()
    order.signature_cms = cms
    order.signature_info = signature
    db.commit()
    activate_order(db, order)
    if order.created_by and order.created_by != "import":
        notify(db, order.created_by, "committee_signed", f"Приказ № {order.number} подписан",
               f"Подписал: {order.signed_by}", link="/committee")
        db.commit()
    return order


def pdf_bytes(db: Session, order: CommitteeOrder, base_url: str, languages: tuple[str, ...]) -> bytes:
    """PDF приказа (services/committee_pdf.py); у подписанного ЭЦП — с QR-кодами на base_url/verify/<token>."""
    from services.committee_pdf import render_order_pdf

    detail = order_detail(db, order)
    detail.update(order_date=order.order_date, signed_at=order.signed_at)
    if order.signed_at and order.signed_members is not None:
        # Документ с QR подписи — в подписанной редакции, без изменений состава после подписания
        detail["members"] = [{"name": row[2], "position_ru": row[3], "position_kz": row[4]} for row in order.signed_members]
    verify_url = f"{base_url.rstrip('/')}/verify/{order.verify_token}" if order.signed_at and order.verify_token else None
    return render_order_pdf(detail, verify_url, languages)


def verification(db: Session, token: str) -> dict:
    """Проверка подлинности по QR-коду (открытая страница): реквизиты, подписант, сертификат и целостность.
    Состав комитета не раскрывается."""
    order = db.query(CommitteeOrder).filter(CommitteeOrder.verify_token == token).first()
    if not order or not order.signed_at:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Документ не найден")
    return {
        "title_ru": order.title_ru,
        "title_kz": order.title_kz,
        "number": order.number,
        "order_date": order.order_date.isoformat() if order.order_date else None,
        "academic_year": order.academic_year,
        "signed_by": order.signed_by,
        "signer_full_name": _tutor_full_name(db, order.signer_tutor_id),
        "signed_at": order.signed_at.isoformat(),
        "signature": order.signature_info,
        "document_hash": order.document_hash,
        "intact": _document_hash(db, order) == order.document_hash,
        "is_active": bool(order.is_active),
    }


# --- Скан приказа ---

def save_file(db: Session, order: CommitteeOrder, content: bytes) -> None:
    root = files_dir()
    os.makedirs(root, mode=0o750, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}.pdf"
    path = os.path.join(root, file_name)
    with open(path, "wb") as target:
        target.write(content)
    previous = order.file_name
    order.file_name = file_name
    try:
        db.commit()
    except Exception:
        db.rollback()
        _remove_quietly(path)
        raise
    if previous:
        _remove_quietly(os.path.join(root, previous))


def file_path(order: CommitteeOrder) -> str:
    path = os.path.join(files_dir(), os.path.basename(order.file_name or ""))
    if not order.file_name or not os.path.isfile(path):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Скан приказа не загружен")
    return path


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass
