"""Карточки преподавателей и студентов: профиль из Platonus (снимок) и правки КРК поверх него.

Профиль — только поля из белого списка (рабочие данные и контакты); коды справочников Platonus
сразу заменяются названиями на трёх языках. Снимок (people_profiles) перезаписывается синхронизацией,
правки КРК (people_overrides) хранятся отдельно и синхронизацией не затрагиваются.
Логин, ИИН, кафедра и группа не редактируются: на них завязаны учётная запись, вход по ЭЦП и фильтры.
"""
import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

import pymysql
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from database import engine
from migrations import ACTIVE_TUTORS_WHERE, _compose_tutor_name, get_remote_config

KIND_TUTOR = "tutor"
KIND_STUDENT = "student"

# (ключ, тип, раздел карточки). Все поля редактируются; тип задаёт проверку значения
FIELDS = {
    KIND_TUTOR: [
        ("full_name", "text", "names"),
        ("full_name_kz", "text", "names"),
        ("full_name_en", "text", "names"),
        ("job_title", "text", "work"),
        ("scientific_degree", "text", "work"),
        ("academic_status", "text", "work"),
        ("rate", "number", "work"),
        ("work_status", "text", "work"),
        ("hired_on", "date", "work"),
        ("teaching_since", "date", "work"),
        ("scopus_id", "text", "work"),
        ("wos_id", "text", "work"),
        ("phone", "text", "contacts"),
        ("mobile_phone", "text", "contacts"),
        ("email", "email", "contacts"),
    ],
    KIND_STUDENT: [
        ("full_name", "text", "names"),
        ("full_name_en", "text", "names"),
        ("course", "number", "study"),
        ("study_form", "text", "study"),
        ("study_language", "text", "study"),
        ("payment_form", "text", "study"),
        ("gpa", "number", "study"),
        ("phone", "text", "contacts"),
        ("mobile_phone", "text", "contacts"),
        ("email", "email", "contacts"),
    ],
}
FIELD_TYPES = {kind: {key: field_type for key, field_type, _ in fields} for kind, fields in FIELDS.items()}
MAX_VALUE_LENGTH = 500
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_people_tables(engine_=engine) -> None:
    with engine_.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS people_profiles (
                kind VARCHAR(16) NOT NULL,
                person_id INT NOT NULL,
                data JSON NOT NULL,
                synced_at DATETIME NOT NULL,
                PRIMARY KEY (kind, person_id)
            ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS people_overrides (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                kind VARCHAR(16) NOT NULL,
                person_id INT NOT NULL,
                field VARCHAR(64) NOT NULL,
                value TEXT NULL,
                updated_by VARCHAR(255) NOT NULL,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_people_override (kind, person_id, field)
            ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))


# --- Синхронизация с Platonus ---

def _clean(value):
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()[:10]
    if isinstance(value, (Decimal, float)):
        return round(float(value), 2)
    if isinstance(value, str):
        value = value.strip()
        # «--------» и «—» — пустые значения справочников Platonus
        return value if value.strip("-–— ") else None
    return value


def _join(*parts) -> Optional[str]:
    return _clean(" ".join(p.strip() for p in parts if p and p.strip()))


def _label(row: dict, prefix: str) -> Optional[dict]:
    """Название из справочника Platonus на трёх языках (пустые подставляются русским)."""
    ru = _clean(row.get(f"{prefix}_ru"))
    if not ru:
        return None
    return {"ru": ru, "kz": _clean(row.get(f"{prefix}_kz")) or ru, "en": _clean(row.get(f"{prefix}_en")) or ru}


TUTORS_SQL = f"""
    SELECT t.TutorID AS id, t.lastname_ru, t.firstname_ru, t.patronymic_ru, t.lastname, t.firstname, t.patronymic,
           t.lastname_en, t.firstname_en, t.patronymic_en,
           t.job_title, tp.NameRU AS position_ru, tp.NameKZ AS position_kz, tp.NameEN AS position_en,
           sd.NAMERU AS degree_ru, sd.NAMEKZ AS degree_kz, sd.NAMEEN AS degree_en,
           ac.nameru AS status_ru, ac.namekz AS status_kz, ac.nameen AS status_en,
           ws.NameRU AS work_ru, ws.NameKZ AS work_kz, ws.NameEN AS work_en,
           t.RATE AS rate, t.work_start_date AS hired_on, t.teaching_experience_start_date AS teaching_since,
           t.scopusID AS scopus_id, t.webOfScienceID AS wos_id, t.phone, t.mobilePhone AS mobile_phone, t.mail AS email
    FROM tutors t
    LEFT JOIN tutor_positions tp ON tp.ID = t.job_title_int
    LEFT JOIN scientificdegree sd ON sd.ID = t.ScientificDegreeID
    LEFT JOIN academicstatus ac ON ac.id = t.AcademicStatusID
    LEFT JOIN workstatus ws ON ws.id = t.work_status
    WHERE {ACTIVE_TUTORS_WHERE.replace('has_access', 't.has_access').replace('deleted', 't.deleted')}
"""

STUDENTS_SQL = """
    SELECT s.StudentID AS id, s.lastname, s.firstname, s.patronymic, s.lastname_en, s.firstname_en, s.patronymic_en,
           s.CourseNumber AS course, s.GPA AS gpa, s.phone, s.mobilePhone AS mobile_phone, s.mail AS email,
           sf.NameRu AS form_ru, sf.NameKz AS form_kz, sf.NameEn AS form_en,
           sl.NameRU AS lang_ru, sl.NameKZ AS lang_kz, sl.NameEN AS lang_en,
           pf.NameRU AS pay_ru, pf.NameKZ AS pay_kz, pf.NameEN AS pay_en
    FROM students s
    LEFT JOIN studyforms sf ON sf.Id = s.StudyFormID
    LEFT JOIN studylanguages sl ON sl.Id = s.StudyLanguageID
    LEFT JOIN paymentforms pf ON pf.ID = s.PaymentFormID
    WHERE s.isStudent = 1
"""


def _tutor_profile(row: dict) -> dict:
    return {
        "full_name": _compose_tutor_name({**row, "tutor_id": row["id"]}),
        "full_name_kz": _join(row["lastname"], row["firstname"], row["patronymic"]),
        "full_name_en": _join(row["lastname_en"], row["firstname_en"], row["patronymic_en"]),
        # Должность в Platonus — текстом; ссылка на справочник должностей заполнена не у всех
        "job_title": _clean(row["job_title"]) or _label(row, "position"),
        "scientific_degree": _label(row, "degree"),
        "academic_status": _label(row, "status"),
        "rate": _clean(row["rate"]),
        "work_status": _label(row, "work"),
        "hired_on": _clean(row["hired_on"]),
        "teaching_since": _clean(row["teaching_since"]),
        "scopus_id": _clean(row["scopus_id"]),
        "wos_id": _clean(row["wos_id"]),
        "phone": _clean(row["phone"]),
        "mobile_phone": _clean(row["mobile_phone"]),
        "email": _clean(row["email"]),
    }


def _student_profile(row: dict) -> dict:
    return {
        # Как в platonus_students (синхронизация расписания)
        "full_name": _join(row["lastname"], row["firstname"], row["patronymic"]),
        "full_name_en": _join(row["lastname_en"], row["firstname_en"], row["patronymic_en"]),
        "course": _clean(row["course"]),
        "study_form": _label(row, "form"),
        "study_language": _label(row, "lang"),
        "payment_form": _label(row, "pay"),
        "gpa": _clean(row["gpa"]),
        "phone": _clean(row["phone"]),
        "mobile_phone": _clean(row["mobile_phone"]),
        "email": _clean(row["email"]),
    }


def sync_people_profiles() -> dict:
    """Перезаписывает снимок профилей из Platonus. Правки КРК не трогает."""
    remote = pymysql.connect(**get_remote_config(), connect_timeout=5, read_timeout=60,
                             cursorclass=pymysql.cursors.DictCursor)
    try:
        with remote.cursor() as cursor:
            cursor.execute(TUTORS_SQL)
            tutors = [(row["id"], _tutor_profile(row)) for row in cursor.fetchall()]
            cursor.execute(STUDENTS_SQL)
            students = [(row["id"], _student_profile(row)) for row in cursor.fetchall()]
    finally:
        remote.close()

    now = datetime.utcnow().replace(microsecond=0)
    with engine.begin() as conn:
        for kind, rows in ((KIND_TUTOR, tutors), (KIND_STUDENT, students)):
            conn.execute(text("DELETE FROM people_profiles WHERE kind = :kind"), {"kind": kind})
            if rows:
                conn.execute(
                    text("INSERT INTO people_profiles (kind, person_id, data, synced_at) VALUES (:kind, :id, :data, :now)"),
                    [{"kind": kind, "id": pid, "data": json.dumps(data, ensure_ascii=False), "now": now} for pid, data in rows],
                )
    return {"tutors": len(tutors), "students": len(students)}


# --- Учётные записи КРК ---

def attach_accounts(db: Session, items: list[dict]) -> list[dict]:
    """Добавляет к строкам учётную запись КРК: логин Platonus совпадает с username с доменом или без
    (LDAP хранит user@domain). Ищется только для переданных строк."""
    logins = sorted({(row.get("login") or "").strip().lower() for row in items} - {""})
    accounts: dict[str, dict] = {}
    if logins:
        rows = db.execute(
            text("""
                SELECT u.username, r.name AS role, u.last_login_at, u.is_blocked,
                       SUBSTRING_INDEX(LOWER(u.username), '@', 1) AS short_login
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                WHERE LOWER(u.username) IN :logins OR SUBSTRING_INDEX(LOWER(u.username), '@', 1) IN :logins
                ORDER BY u.is_ldap, u.last_login_at
            """).bindparams(bindparam("logins", expanding=True)),
            {"logins": logins},
        ).mappings().all()
        # Последней записывается LDAP-запись с самым свежим входом — она и остаётся
        for row in rows:
            accounts[row["short_login"]] = {
                "username": row["username"],
                "role": row["role"],
                "last_login_at": row["last_login_at"].isoformat() if row["last_login_at"] else None,
                "blocked": bool(row["is_blocked"]),
            }
    for item in items:
        item["account"] = accounts.get((item.get("login") or "").strip().lower())
    return items


# --- Карточка ---

TUTOR_BASE_SQL = """
    SELECT t.tutor_id AS id, t.full_name, t.login, t.email, (t.iin IS NOT NULL) AS has_iin,
           c.cafedraNameRU AS cafedra_name_ru, c.cafedraNameKZ AS cafedra_name_kz, c.cafedraNameEN AS cafedra_name_en,
           f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en
    FROM tutors t
    LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
    LEFT JOIN faculties f ON f.FacultyID = c.FacultyID
    WHERE t.tutor_id = :id
"""

# Группа связана со студентом только по названию; ОП показывается, только если у групп с таким названием она одна
STUDENT_BASE_SQL = """
    SELECT s.student_id AS id, s.full_name, s.login, (s.iin IS NOT NULL) AS has_iin, s.group_name,
           gx.specialization_code, gx.specialization_name_ru, gx.specialization_name_kz, gx.specialization_name_en,
           f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en
    FROM platonus_students s
    LEFT JOIN (
        SELECT g.name,
               CASE WHEN COUNT(DISTINCT sp.id) = 1 THEN MIN(sp.specializationCode) END AS specialization_code,
               CASE WHEN COUNT(DISTINCT sp.id) = 1 THEN MIN(sp.nameru) END AS specialization_name_ru,
               CASE WHEN COUNT(DISTINCT sp.id) = 1 THEN MIN(sp.namekz) END AS specialization_name_kz,
               CASE WHEN COUNT(DISTINCT sp.id) = 1 THEN MIN(sp.nameen) END AS specialization_name_en,
               MIN(sp.faculty_id) AS faculty_id
        FROM `groups` g
        LEFT JOIN specializations sp ON sp.id = g.specializationID
        WHERE g.name = (SELECT group_name FROM platonus_students WHERE student_id = :id) COLLATE utf8mb4_unicode_ci
        GROUP BY g.name
    ) gx ON gx.name = s.group_name COLLATE utf8mb4_unicode_ci
    LEFT JOIN faculties f ON f.FacultyID = gx.faculty_id
    WHERE s.student_id = :id
"""


def get_card(db: Session, kind: str, person_id: int) -> Optional[dict]:
    base = db.execute(text(TUTOR_BASE_SQL if kind == KIND_TUTOR else STUDENT_BASE_SQL), {"id": person_id}).mappings().first()
    if not base:
        return None
    card = dict(base)
    card["has_iin"] = bool(card["has_iin"])
    attach_accounts(db, [card])

    profile_row = db.execute(
        text("SELECT data, synced_at FROM people_profiles WHERE kind = :kind AND person_id = :id"),
        {"kind": kind, "id": person_id},
    ).mappings().first()
    profile = json.loads(profile_row["data"]) if profile_row else {}
    # Без снимка профиля (до первой синхронизации) ФИО и почта — из списка
    profile.setdefault("full_name", card.get("full_name"))
    if kind == KIND_TUTOR:
        profile.setdefault("email", card.get("email"))

    overrides = {
        row["field"]: row for row in db.execute(
            text("SELECT field, value, updated_by, updated_at FROM people_overrides WHERE kind = :kind AND person_id = :id"),
            {"kind": kind, "id": person_id},
        ).mappings().all()
    }
    card["synced_at"] = profile_row["synced_at"].isoformat() if profile_row else None
    card["fields"] = []
    for key, field_type, section in FIELDS[kind]:
        override = overrides.get(key)
        card["fields"].append({
            "key": key,
            "type": field_type,
            "section": section,
            "platonus": profile.get(key),
            "value": override["value"] if override else profile.get(key),
            "overridden": override is not None,
            "updated_by": override["updated_by"] if override else None,
            "updated_at": override["updated_at"].isoformat() if override else None,
        })
    return card


def _platonus_text(value) -> str:
    if isinstance(value, dict):
        return value.get("ru") or ""
    return "" if value is None else str(value)


def _same_as_platonus(field_type: str, value: str, platonus) -> bool:
    if field_type == "number" and value and platonus is not None:
        try:
            return float(value) == float(platonus)
        except (TypeError, ValueError):
            return False
    return value == _platonus_text(platonus)


def _validate(field_type: str, value: str) -> str:
    if field_type == "number":
        value = value.replace(",", ".")
        try:
            float(value)
        except ValueError:
            raise ValueError("number") from None
        return value
    if field_type == "date":
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            raise ValueError("date") from None
    if field_type == "email" and not EMAIL_RE.match(value):
        raise ValueError("email")
    return value


def update_fields(db: Session, kind: str, person_id: int, changes: dict, actor: str) -> list[str]:
    """Сохраняет правки КРК. None или значение, равное Platonus, — возврат к Platonus (правка удаляется).
    Возвращает ключи изменённых полей; ValueError("ключ: причина") — неизвестное поле или неверное значение."""
    types = FIELD_TYPES[kind]
    profile_row = db.execute(
        text("SELECT data FROM people_profiles WHERE kind = :kind AND person_id = :id"),
        {"kind": kind, "id": person_id},
    ).first()
    profile = json.loads(profile_row[0]) if profile_row else {}

    prepared = {}
    for key, raw in changes.items():
        if key not in types:
            raise ValueError(f"{key}: unknown")
        value = None if raw is None else str(raw).strip()
        if value:
            if len(value) > MAX_VALUE_LENGTH:
                raise ValueError(f"{key}: too_long")
            try:
                value = _validate(types[key], value)
            except ValueError as exc:
                raise ValueError(f"{key}: {exc}") from None
        # Пустая строка — тоже правка (поле очищено в КРК), если в Platonus значение есть
        prepared[key] = None if raw is None or _same_as_platonus(types[key], value, profile.get(key)) else value

    changed = []
    for key, value in prepared.items():
        params = {"kind": kind, "id": person_id, "field": key}
        if value is None:
            result = db.execute(
                text("DELETE FROM people_overrides WHERE kind = :kind AND person_id = :id AND field = :field"), params)
            if result.rowcount:
                changed.append(key)
            continue
        current = db.execute(
            text("SELECT value FROM people_overrides WHERE kind = :kind AND person_id = :id AND field = :field"), params,
        ).first()
        if current and current[0] == value:
            continue
        db.execute(
            text("""
                INSERT INTO people_overrides (kind, person_id, field, value, updated_by, updated_at)
                VALUES (:kind, :id, :field, :value, :actor, UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE value = VALUES(value), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)
            """),
            {**params, "value": value, "actor": actor},
        )
        changed.append(key)
    db.commit()
    return changed
