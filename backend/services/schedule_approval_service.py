"""Утверждение графика взаимопосещения ЭЦП: маршрут подписания по этапам.

Этап 1 — заведующие кафедрами (заведующий кафедры из справочника Platonus), этап 2 — согласующие (декан
факультета из Platonus, руководители УОП и МО), этап 3 — утверждающий (проректор по АВ). Подписанты — сотрудники
Platonus. Внутри этапа порядок не важен; следующий этап получает документ, когда подписали все на текущем.
После подписи утверждающего график утверждён. Содержимое (строки графика и подписанты) фиксируется отпечатком
при отправке: изменённый после отправки график подписать нельзя, а строки графика на подписи не правятся.
"""
import hashlib
import json
import uuid
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.peer_visit_schedule import PeerVisitSchedule
from models.schedule_approval import ScheduleApproval, ScheduleApprovalSigner
from services.ecp_signing import check_signer_ready, tutor_ids_for, tutor_login, verify_signature
from services.notification_service import notify

STAGES = {1: "Заведующие кафедрами", 2: "Согласование", 3: "Утверждение"}
# Значения по умолчанию — из утверждённых графиков 2026-2027
TITLE_BY_FACULTY = {
    1: "технологического факультета",
    3: "факультета «Экономика и бизнес»",
    5: "факультета «Инжиниринга и информационных технологий»",
}
DEAN_LABEL_BY_FACULTY = {1: "Декан ТФ", 3: "Декан ФЭиБ", 5: "Декан ФИиИТ"}
# Подписанты вне справочника кафедр/факультетов: последние выбранные, иначе — как в утверждённых графиках
FIXED_ROLES = (
    ("uop", 2, "Руководитель УОП", "Баядилова"),
    ("mo", 2, "Руководитель МО", "Саду"),
    ("approver", 3, "Проректор по АВ", "Аскарбеков"),
)


def initials_name(full_name: Optional[str]) -> str:
    """«Машанова Нурбиби Советовна» → «Н.С. Машанова» (как в подписях графика)."""
    words = (full_name or "").split()
    if not words:
        return ""
    return f"{''.join(w[0] + '.' for w in words[1:3])} {words[0]}".strip()


def _full_name(db: Session, tutor_id: Optional[int]) -> Optional[str]:
    return db.execute(text("SELECT full_name FROM tutors WHERE tutor_id = :id"), {"id": tutor_id}).scalar() if tutor_id else None


def schedule_rows(db: Session, academic_year: str, period: int, faculty_id: int) -> list[PeerVisitSchedule]:
    # Порядок — как внесены в график (как в бумажном оригинале)
    return (db.query(PeerVisitSchedule)
            .filter(PeerVisitSchedule.academic_year == academic_year, PeerVisitSchedule.period == period,
                    PeerVisitSchedule.faculty_id == faculty_id)
            .order_by(PeerVisitSchedule.id).all())


def _cafedras(rows: list[PeerVisitSchedule]) -> list[tuple]:
    """Кафедры графика в порядке строк: (ключ, cafedra_id, название)."""
    seen = {}
    for row in rows:
        key = row.cafedra_id if row.cafedra_id is not None else row.cafedra_name
        seen.setdefault(key, (key, row.cafedra_id, row.cafedra_name))
    return list(seen.values())


def get(db: Session, approval_id: int) -> ScheduleApproval:
    approval = db.get(ScheduleApproval, approval_id)
    if not approval:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Утверждение графика не найдено")
    return approval


def find(db: Session, academic_year: str, period: int, faculty_id: int) -> Optional[ScheduleApproval]:
    return db.query(ScheduleApproval).filter_by(academic_year=academic_year, period=period, faculty_id=faculty_id).first()


def ensure_schedule_editable(db: Session, academic_year: str, period: int, faculty_id: int) -> None:
    """Строки графика на подписи и утверждённого графика не меняются — сначала отзовите его с подписи."""
    approval = find(db, academic_year, period, faculty_id)
    if approval and approval.status == "on_signing":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График на подписи — сначала отзовите его, чтобы изменить")
    if approval and approval.status == "approved":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График утверждён ЭЦП — изменения запрещены")


def _signers(db: Session, approval: ScheduleApproval) -> list[ScheduleApprovalSigner]:
    return (db.query(ScheduleApprovalSigner).filter_by(approval_id=approval.id)
            .order_by(ScheduleApprovalSigner.stage, ScheduleApprovalSigner.position, ScheduleApprovalSigner.id).all())


def default_signers(db: Session, academic_year: str, period: int, faculty_id: int) -> list[dict]:
    """Подписанты по умолчанию: заведующие кафедрами и декан — из Platonus; УОП, МО и проректор — последние выбранные."""
    result = []
    managers = dict(db.execute(text("SELECT cafedraID, manager_tutor_id FROM cafedras")).all())
    for index, (_, cafedra_id, name) in enumerate(_cafedras(schedule_rows(db, academic_year, period, faculty_id))):
        result.append({"stage": 1, "role": f"cafedra:{cafedra_id or name}", "position": index,
                       "label": f"Заведующий кафедрой «{name}»", "tutor_id": managers.get(cafedra_id)})
    dean = db.execute(text("SELECT dean_tutor_id FROM faculties WHERE FacultyID = :id"), {"id": faculty_id}).scalar()
    result.append({"stage": 2, "role": "dean", "position": 0, "label": DEAN_LABEL_BY_FACULTY.get(faculty_id, "Декан факультета"), "tutor_id": dean})
    for index, (role, stage, label, surname) in enumerate(FIXED_ROLES, start=1):
        last = (db.query(ScheduleApprovalSigner).filter(ScheduleApprovalSigner.role == role, ScheduleApprovalSigner.tutor_id.isnot(None))
                .order_by(ScheduleApprovalSigner.id.desc()).first())
        tutor_id = last.tutor_id if last else db.execute(
            text("SELECT tutor_id FROM tutors WHERE full_name LIKE :name ORDER BY tutor_id LIMIT 1"), {"name": f"{surname} %"}).scalar()
        result.append({"stage": stage, "role": role, "position": index, "label": last.label if last else label, "tutor_id": tutor_id})
    return result


def _signer_view(db: Session, signer: ScheduleApprovalSigner, approval: ScheduleApproval) -> dict:
    if signer.signed_at:
        state = "signed"
    elif approval.status == "on_signing" and signer.stage == approval.stage:
        state = "current"
    else:
        state = "waiting"
    return {
        "id": signer.id, "stage": signer.stage, "role": signer.role, "label": signer.label,
        "tutor_id": signer.tutor_id, "tutor_name": _full_name(db, signer.tutor_id), "name": signer.name,
        "state": state, "signed_at": signer.signed_at.isoformat() if signer.signed_at else None,
        "signature": signer.signature_info,
    }


def detail(db: Session, approval: Optional[ScheduleApproval], academic_year: str, period: int, faculty_id: int) -> dict:
    """Утверждение графика; если его ещё нет — предложение (id = null) с подписантами по умолчанию."""
    rows_count = len(schedule_rows(db, academic_year, period, faculty_id))
    if approval is None:
        signers = []
        for item in default_signers(db, academic_year, period, faculty_id):
            full_name = _full_name(db, item["tutor_id"])
            signers.append({**item, "id": None, "tutor_name": full_name, "name": initials_name(full_name),
                            "state": "waiting", "signed_at": None, "signature": None})
        return {"id": None, "academic_year": academic_year, "period": period, "faculty_id": faculty_id,
                "title": TITLE_BY_FACULTY.get(faculty_id, ""), "status": "draft", "stage": None, "rows_count": rows_count,
                "signers": signers, "verify_token": None}
    return {
        "id": approval.id, "academic_year": approval.academic_year, "period": approval.period, "faculty_id": approval.faculty_id,
        "title": approval.title, "status": approval.status, "stage": approval.stage, "rows_count": rows_count,
        "sent_at": approval.sent_at.isoformat() if approval.sent_at else None,
        "approved_at": approval.approved_at.isoformat() if approval.approved_at else None,
        "verify_token": approval.verify_token if approval.status != "draft" else None,
        "signers": [_signer_view(db, signer, approval) for signer in _signers(db, approval)],
    }


def save_draft(db: Session, academic_year: str, period: int, faculty_id: int, title: str, signers: list[dict], user: str) -> ScheduleApproval:
    """Сохраняет проект: заголовок и подписантов (роль, сотрудник Platonus, подпись в документе)."""
    approval = find(db, academic_year, period, faculty_id)
    if approval and approval.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График уже отправлен на подпись — сначала отзовите его")
    if approval is None:
        approval = ScheduleApproval(academic_year=academic_year, period=period, faculty_id=faculty_id, created_by=user)
        db.add(approval)
        db.flush()
    approval.title = title.strip()
    defaults = {item["role"]: item for item in default_signers(db, academic_year, period, faculty_id)}
    db.query(ScheduleApprovalSigner).filter_by(approval_id=approval.id).delete()
    for item in signers:
        base = defaults.get(item["role"])
        if base is None:
            continue  # кафедра без строк в графике
        tutor_id = item.get("tutor_id")
        if tutor_id is not None and not _full_name(db, tutor_id):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Сотрудник не найден в справочнике")
        db.add(ScheduleApprovalSigner(approval_id=approval.id, stage=base["stage"], role=base["role"], position=base["position"],
                                      label=(item.get("label") or base["label"]).strip(), tutor_id=tutor_id,
                                      name=initials_name(_full_name(db, tutor_id))))
    db.commit()
    return approval


def _document_hash(db: Session, approval: ScheduleApproval) -> str:
    """SHA-256 содержимого: строки графика и подписанты. Подписи ставятся на этот отпечаток."""
    rows = schedule_rows(db, approval.academic_year, approval.period, approval.faculty_id)
    payload = {
        "id": approval.id, "title": approval.title, "year": approval.academic_year, "period": approval.period, "faculty": approval.faculty_id,
        "rows": [[r.id, r.cafedra_id, r.cafedra_name, r.visited_tutor_id, r.visited_name, r.visited_position,
                  r.visitor_tutor_id, r.visitor_name, r.visitor_position, r.month] for r in rows],
        "signers": [[s.stage, s.role, s.label, s.tutor_id, s.name] for s in _signers(db, approval)],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def sign_data(approval: ScheduleApproval) -> str:
    return f"krk-peer-visit-schedule:{approval.verify_token}:{approval.document_hash}"


def _notify_stage(db: Session, approval: ScheduleApproval) -> None:
    for signer in _signers(db, approval):
        if signer.stage == approval.stage and not signer.signed_at:
            login = tutor_login(db, signer.tutor_id)
            if login:
                notify(db, login, "schedule_signing", "График взаимопосещения на подпись",
                       f"{approval.title}, {approval.academic_year}: {STAGES[approval.stage].lower()}", link=f"/signing/schedule/{approval.id}")


def send(db: Session, approval: ScheduleApproval) -> ScheduleApproval:
    """Проект → на подпись: содержимое фиксируется, подписанты первого этапа получают уведомление."""
    if approval.status != "draft":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График уже отправлен на подпись")
    if not schedule_rows(db, approval.academic_year, approval.period, approval.faculty_id):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="В графике нет строк")
    signers = _signers(db, approval)
    if not any(s.stage == 3 for s in signers):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Выберите утверждающего")
    for signer in signers:
        check_signer_ready(db, signer.tutor_id, signer.label)
    approval.verify_token = approval.verify_token or uuid.uuid4().hex
    approval.document_hash = _document_hash(db, approval)
    approval.status = "on_signing"
    approval.stage = min(s.stage for s in signers)
    approval.sent_at = datetime.utcnow()
    _notify_stage(db, approval)
    db.commit()
    return approval


def recall(db: Session, approval: ScheduleApproval) -> ScheduleApproval:
    """На подписи → проект: собранные подписи снимаются (они относятся к отправленному содержимому)."""
    if approval.status == "approved":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График уже утверждён")
    for signer in _signers(db, approval):
        signer.signed_at = None
        signer.signature_cms = None
        signer.signature_info = None
    approval.status, approval.stage, approval.sent_at, approval.document_hash = "draft", None, None, None
    db.commit()
    return approval


def my_signer(db: Session, approval: ScheduleApproval, username: str) -> Optional[ScheduleApprovalSigner]:
    """Строка подписанта текущего пользователя (неподписанная на текущем этапе — в первую очередь)."""
    ids = set(tutor_ids_for(db, username))
    mine = [s for s in _signers(db, approval) if s.tutor_id in ids]
    return next((s for s in mine if not s.signed_at and s.stage == approval.stage), None) or (mine[0] if mine else None)


def sign(db: Session, approval: ScheduleApproval, username: str, cms: str) -> ScheduleApproval:
    if approval.status != "on_signing":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График не на подписи")
    signer = my_signer(db, approval, username)
    if not signer:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Вы не подписант этого графика")
    if signer.signed_at:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Вы уже подписали этот график")
    if signer.stage != approval.stage:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Сейчас подписывает этап «{STAGES[approval.stage]}»")
    if _document_hash(db, approval) != approval.document_hash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="График изменился после отправки на подпись — его нужно отправить заново")
    signer.signature_info = verify_signature(db, cms, sign_data(approval), signer.tutor_id)
    signer.signature_cms = cms
    signer.signed_at = datetime.utcnow()
    db.flush()
    remaining = [s for s in _signers(db, approval) if not s.signed_at]
    if not remaining:
        approval.status, approval.stage, approval.approved_at = "approved", None, datetime.utcnow()
        if approval.created_by:
            notify(db, approval.created_by, "schedule_approved", "График взаимопосещения утверждён",
                   f"{approval.title}, {approval.academic_year}", link="/peer-visits/schedule")
    elif all(s.stage != approval.stage for s in remaining):
        approval.stage = min(s.stage for s in remaining)
        _notify_stage(db, approval)
    db.commit()
    return approval


def pending_for(db: Session, username: str) -> list[dict]:
    ids = tutor_ids_for(db, username)
    if not ids:
        return []
    rows = (db.query(ScheduleApproval, ScheduleApprovalSigner)
            .join(ScheduleApprovalSigner, ScheduleApprovalSigner.approval_id == ScheduleApproval.id)
            .filter(ScheduleApproval.status == "on_signing", ScheduleApprovalSigner.tutor_id.in_(ids),
                    ScheduleApprovalSigner.signed_at.is_(None), ScheduleApprovalSigner.stage == ScheduleApproval.stage)
            .order_by(ScheduleApproval.sent_at).all())
    return [{"kind": "schedule", "id": approval.id, "title": f"График взаимопосещения занятий ППС {approval.title}",
             "subtitle": f"{approval.academic_year}, {approval.period}-й период · {signer.label}",
             "sent_at": approval.sent_at.isoformat()} for approval, signer in rows]


def pdf_bytes(db: Session, approval: ScheduleApproval, base_url: str) -> bytes:
    from services.schedule_pdf import render_schedule_pdf

    rows = schedule_rows(db, approval.academic_year, approval.period, approval.faculty_id)
    verify_url = f"{base_url.rstrip('/')}/verify/{approval.verify_token}" if approval.status != "draft" and approval.verify_token else None
    return render_schedule_pdf(approval, rows, _signers(db, approval), verify_url)


def verification(db: Session, token: str) -> Optional[dict]:
    approval = db.query(ScheduleApproval).filter(ScheduleApproval.verify_token == token).first()
    if not approval or approval.status == "draft":
        return None
    return {
        "kind": "schedule",
        "title": f"График взаимопосещения занятий ППС {approval.title}",
        "subtitle": f"{approval.academic_year} учебный год, {approval.period}-й академический период",
        "status": approval.status,
        "approved_at": approval.approved_at.isoformat() if approval.approved_at else None,
        "document_hash": approval.document_hash,
        "intact": _document_hash(db, approval) == approval.document_hash,
        "signers": [{"label": s.label, "name": s.name, "signed_at": s.signed_at.isoformat() if s.signed_at else None,
                     "signature": s.signature_info} for s in _signers(db, approval)],
    }
