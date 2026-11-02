from datetime import date, datetime, timezone

import hashlib
import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import and_, bindparam, or_, text
from sqlalchemy.orm import Session

from database import get_db
from models.violation import Violation, ViolationResponse
from models.violation_evidence import ViolationEvidence
from services import ROLE_ADMIN, ROLE_COMMITTEE, ROLE_DEAN, ROLE_SUPERADMIN, get_current_user_context, require_roles
from services.faculty_scope import dean_faculty_id, forbid_other_faculty, teacher_faculty_id
from services.audit_log import audit_event
from services.committee_service import tutor_people
from services.ecp_signing import tutor_ids_for, verify_signature
from services.notification_service import login_aliases, notify
from services.request_meta import public_base_url
from services import video_checklist as checklist_rules
from services.situational_monitoring import (
    RESPONSE_KINDS, RESPONSE_METHODS, act_dir, bind_teacher, checklist_pdf_bytes, document_hash, evidence_dir, notify_teacher,
    response_sign_data, responses_dir, save_checklist_pdf, sign_data,
)

router = APIRouter(prefix="/violations", tags=["violations"])

HHMM = r"^([01]\d|2[0-3]):[0-5]\d$"
MAX_RESPONSE_FILE = 20 * 1024 * 1024
# Скан или справка: PDF или фото (сигнатура файла проверяется, а не только расширение)
RESPONSE_FILE_TYPES = {b"%PDF-": "application/pdf", b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}
# Преподаватель видит подписанные ЭЦП нарушения (и снятые по пояснению) и подписанные «соответствует»
TEACHER_STATUSES = ("confirmed", "justified")


class ReportFields(BaseModel):
    """Раздел «Отчетность» формы 16-02 (кроме статуса и комментария)."""
    schedule_check: str = Field(default="", max_length=5000)
    # Дата и время повторного наблюдения (по Астане); None — не требуется
    repeat_observation_at: datetime | None = None
    # Пусто — очная верификация не требуется
    onsite_verification: str = Field(default="", max_length=255)
    tech_ticket: str = Field(default="", max_length=100)


class ViolationCreate(ReportFields):
    """Наблюдение по чек-листу Ф. ДСР-9.1.3-2026-16-02 (services/video_checklist.py)."""
    lesson_ref: str = Field(min_length=1, max_length=100)
    teacher: str = Field(min_length=1, max_length=255)
    room: str = Field(default="", max_length=255)
    subject: str = Field(default="", max_length=255)
    group_name: str = Field(default="", max_length=500)
    camera: str = Field(default="", max_length=255)
    scheduled_time: str = Field(default="", max_length=50)
    observed_from: str = Field(default="", pattern=f"{HHMM}|^$")
    observed_to: str = Field(default="", pattern=f"{HHMM}|^$")
    violation_date: date
    checklist: dict[str, str]
    # Итог: compliant | clarification | violation (дальше — подпись ЭЦП) | technical
    status: str
    description: str = Field(default="", max_length=10000)
    evidence_ids: list[int] = Field(default_factory=list, max_length=20)


class EvidenceSummary(BaseModel):
    id: int
    media_type: str
    url: str


class ResponseOut(BaseModel):
    """Пояснение преподавателя: объяснительная или справка, ЭЦП или скан."""
    id: int
    kind: str
    method: str
    text: str | None = None
    original_name: str | None = None
    file_url: str | None = None
    signer: str | None = None
    created_by: str
    created_at: datetime


class ViolationOut(BaseModel):
    id: int
    lesson_ref: str
    teacher: str
    room: str
    subject: str
    violation_type: str
    violation_date: date
    description: str
    status: str
    created_by: str
    # ФИО наблюдателя из учётной записи (пусто — показывается логин)
    created_by_name: str = ""
    created_at: datetime
    reviewed_by: str | None = None
    reviewed_by_name: str = ""
    reviewed_at: datetime | None = None
    review_comment: str = ""
    act_url: str | None = None
    teacher_login: str | None = None
    # Только в ответах на изменение: ушло ли уведомление преподавателю
    teacher_notified: bool | None = None
    act_uploaded_by: str | None = None
    act_uploaded_at: datetime | None = None
    evidence_ids: list[int] = Field(default_factory=list)
    evidence: list[EvidenceSummary] = Field(default_factory=list)
    # Чек-лист 16-02 (у записей до формы — None)
    checklist: dict[str, str] | None = None
    camera: str = ""
    scheduled_time: str = ""
    observed_from: str = ""
    observed_to: str = ""
    group_name: str = ""
    schedule_check: str | None = None
    repeat_observation_at: datetime | None = None
    onsite_verification: str = ""
    tech_ticket: str = ""
    # Подпись ЭЦП: sign_data — что подписать (пока статус violation), signature_info — сведения о подписи
    sign_data: str | None = None
    signed_at: datetime | None = None
    signature_info: dict | None = None
    responses: list[ResponseOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ViolationReview(ReportFields):
    """Отчетность по наблюдению: итог и действия по п. 4.5; comment — пояснение проверяющего."""
    status: str
    comment: str = Field(default="", max_length=5000)


class SignIn(BaseModel):
    cms: str = Field(min_length=100, max_length=200_000)


class JustifyIn(BaseModel):
    comment: str = Field(min_length=3, max_length=5000)


def _ensure_violation_faculty(context: dict, violation: Violation) -> None:
    """Деканат работает только с нарушениями преподавателей своего факультета."""
    faculty_id = dean_faculty_id(context)
    if faculty_id is not None and violation.faculty_id != faculty_id:
        raise forbid_other_faculty("Доступ только к нарушениям своего факультета")


def _is_reviewer(context: dict, violation: Violation) -> bool:
    return context["role"] in (ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_COMMITTEE) or (
        context["role"] == ROLE_DEAN and violation.faculty_id == dean_faculty_id(context))


def _sent_to_teacher(violation: Violation) -> bool:
    return violation.status in TEACHER_STATUSES or (violation.status == "compliant" and violation.signed_at is not None)


def _is_teacher(context: dict, violation: Violation) -> bool:
    return bool(_sent_to_teacher(violation) and violation.teacher_login
                and violation.teacher_login in login_aliases(context["username"]))


def _signer(violation: Violation) -> str | None:
    """Чек-лист подписывает наблюдатель; нарушение после уточнения — тот, кто его зафиксировал в отчетности."""
    return violation.reviewed_by if violation.status == "violation" else violation.created_by


def _display_names(db: Session, usernames) -> dict[str, str]:
    """ФИО учётных записей по логинам (одним запросом на список)."""
    logins = sorted({name for name in usernames if name})
    if not logins:
        return {}
    rows = db.execute(
        text("SELECT username, display_name FROM users WHERE username IN :logins").bindparams(bindparam("logins", expanding=True)),
        {"logins": logins},
    ).all()
    return {username: name for username, name in rows if name and name != username}


def _out(db: Session, violation: Violation, evidence: list | None = None, responses: list | None = None,
         names: dict[str, str] | None = None) -> ViolationOut:
    item = ViolationOut.model_validate(violation)
    if names is None:
        names = _display_names(db, [violation.created_by, violation.reviewed_by])
    item.created_by_name = names.get(violation.created_by, "")
    item.reviewed_by_name = names.get(violation.reviewed_by or "", "")
    if evidence is None:
        evidence = db.query(ViolationEvidence).filter(ViolationEvidence.violation_id == violation.id).all()
    if responses is None:
        responses = db.query(ViolationResponse).filter(ViolationResponse.violation_id == violation.id).order_by(ViolationResponse.id).all()
    item.evidence_ids = [row.id for row in evidence]
    item.evidence = [EvidenceSummary(id=row.id, media_type=row.media_type, url=f"/api/violations/evidence/{row.id}") for row in evidence]
    item.responses = [
        ResponseOut(id=row.id, kind=row.kind, method=row.method, text=row.text, original_name=row.original_name,
                    file_url=f"/api/violations/responses/{row.id}/file" if row.file_name else None,
                    signer=(row.signature_info or {}).get("subject"), created_by=row.created_by, created_at=row.created_at)
        for row in responses
    ]
    if violation.act_filename:
        item.act_url = f"/api/violations/{violation.id}/act"
    if violation.status in checklist_rules.SIGNABLE_STATUSES and not violation.signed_at and violation.document_hash:
        item.sign_data = sign_data(violation)
    return item


def _remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass


def _verify_own_signature(db: Session, context: dict, cms: str, data: str) -> tuple[dict, int]:
    """Подпись текущего пользователя: ИИН сертификата — его сотрудника Platonus (по логину).
    Возвращает сведения о подписи и tutor_id подписанта."""
    tutor_ids = tutor_ids_for(db, context["username"])
    if not tutor_ids:
        raise HTTPException(status_code=422, detail="Учётная запись не связана с сотрудником Platonus (ИИН) — подписать ЭЦП нельзя")
    last_error = None
    for tutor_id in tutor_ids:
        try:
            return verify_signature(db, cms, data, tutor_id), tutor_id
        except HTTPException as exc:
            if exc.status_code != 403:
                raise
            last_error = exc
    raise last_error


@router.get("", response_model=list[ViolationOut])
def list_violations(
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN, ROLE_COMMITTEE)),
):
    query = db.query(Violation)
    if dean_faculty_id(context) is not None:
        query = query.filter(Violation.faculty_id == dean_faculty_id(context))
    violations = query.order_by(Violation.created_at.desc()).limit(500).all()
    if not violations:
        return []
    # Наблюдения, сохранённые до подписи ЭЦП любого итога, получают отпечаток для подписи
    unsigned = [v for v in violations if v.checklist is not None and not v.signed_at and not v.document_hash
                and v.status in checklist_rules.SIGNABLE_STATUSES]
    for violation in unsigned:
        violation.document_hash = document_hash(db, violation)
    if unsigned:
        db.commit()
    ids = [item.id for item in violations]
    evidence_by_violation: dict[int, list] = {}
    for row in db.query(ViolationEvidence).filter(ViolationEvidence.violation_id.in_(ids)).all():
        evidence_by_violation.setdefault(row.violation_id, []).append(row)
    responses_by_violation: dict[int, list] = {}
    for row in db.query(ViolationResponse).filter(ViolationResponse.violation_id.in_(ids)).order_by(ViolationResponse.id).all():
        responses_by_violation.setdefault(row.violation_id, []).append(row)
    names = _display_names(db, [login for violation in violations for login in (violation.created_by, violation.reviewed_by)])
    return [_out(db, violation, evidence_by_violation.get(violation.id, []), responses_by_violation.get(violation.id, []), names)
            for violation in violations]


@router.post("", response_model=ViolationOut, status_code=status.HTTP_201_CREATED)
def create_violation(
    body: ViolationCreate,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    """Наблюдение по чек-листу. Чек-лист подписывается ЭЦП наблюдателя (POST /{id}/sign): до подписи
    преподаватель ничего не получает."""
    actor = context.get("username") or "unknown"
    checklist_rules.validate_new(body.checklist, body.status, body.description)
    payload = body.model_dump(exclude={"evidence_ids"})
    payload["violation_type"] = checklist_rules.summary_type(body.checklist, body.status)
    violation = Violation(**payload, created_by=actor)
    if body.status == "violation":
        # Подписывает тот, кто зафиксировал нарушение
        violation.reviewed_by, violation.reviewed_at = actor, datetime.now(timezone.utc)
    db.add(violation)
    # Наблюдение, привязка доказательств, отпечаток и PDF формы 16-02 — одна транзакция
    db.flush()
    if body.evidence_ids:
        db.query(ViolationEvidence).filter(
            ViolationEvidence.id.in_(body.evidence_ids),
            ViolationEvidence.violation_id.is_(None),
            ViolationEvidence.created_by == actor,
        ).update({"violation_id": violation.id}, synchronize_session=False)
    act_path = None
    try:
        bind_teacher(db, violation)
        # По логину преподавателя точнее найти кафедру
        violation.faculty_id = teacher_faculty_id(db, violation.teacher_login, violation.teacher)
        _ensure_violation_faculty(context, violation)
        violation.document_hash = document_hash(db, violation)
        act_path = save_checklist_pdf(db, violation)
        db.commit()
    except Exception:
        db.rollback()
        if act_path:
            _remove_quietly(act_path)
        raise
    db.refresh(violation)
    audit_event(
        "monitoring.violation.create",
        actor=actor,
        details={
            "violation_id": violation.id,
            "lesson_ref": body.lesson_ref,
            "type": violation.violation_type,
            "status": violation.status,
            "deviations": checklist_rules.deviations(body.checklist),
        },
        db=db,
    )
    result = _out(db, violation)
    result.teacher_notified = False
    return result


@router.patch("/{violation_id}/review", response_model=ViolationOut)
def review_violation(
    violation_id: int,
    body: ViolationReview,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    """Отчетность по наблюдению: сверка расписания и замен, повторное наблюдение, очная верификация,
    техническая заявка и итог. «Нарушение» после уточнения — только после этих шагов (п. 4.5); затем подпись ЭЦП."""
    actor = context.get("username") or "unknown"
    decision = body.status.strip().lower()
    if decision not in checklist_rules.REPORT_OUTCOMES:
        raise HTTPException(status_code=400, detail="Неизвестный статус наблюдения")
    # Блокировка строки: два одновременных решения не должны оба пройти проверку статуса
    violation = db.get(Violation, violation_id, with_for_update=True)
    if not violation:
        raise HTTPException(status_code=404, detail="Наблюдение не найдено")
    _ensure_violation_faculty(context, violation)
    if checklist_rules.is_locked(violation.status, violation.signed_at is not None):
        raise HTTPException(status_code=409, detail="Решение по наблюдению уже принято и не может быть изменено")
    if decision == "compliant" and violation.checklist is not None and violation.checklist.get("quality") == "no":
        raise HTTPException(status_code=422, detail="Видеосигнал недостаточного качества: статус — «технически невозможно оценить»")
    if decision == "violation" and violation.status != "violation":
        checklist_rules.ensure_can_confirm(violation.checklist, body.schedule_check,
                                           body.repeat_observation_at is not None, body.onsite_verification)
    violation.status = decision
    violation.schedule_check = body.schedule_check.strip()
    violation.repeat_observation_at = body.repeat_observation_at
    violation.onsite_verification = body.onsite_verification.strip()
    violation.tech_ticket = body.tech_ticket.strip()
    violation.reviewed_by = actor
    violation.reviewed_at = datetime.now(timezone.utc)
    violation.review_comment = body.comment.strip()
    # Содержимое изменилось — прежняя подпись (например, «требуется уточнение») к нему больше не относится
    violation.document_hash = document_hash(db, violation)
    violation.signed_at = violation.signature_cms = violation.signature_info = None
    if violation.checklist is not None:
        save_checklist_pdf(db, violation)
    db.commit()
    db.refresh(violation)
    audit_event("admin.violation.review", actor=actor, details={"violation_id": violation.id, "decision": decision}, db=db)
    return _out(db, violation)


@router.post("/{violation_id}/sign", response_model=ViolationOut)
def sign_violation(
    violation_id: int,
    body: SignIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    """Подпись чек-листа ЭЦП наблюдателем (нарушения после уточнения — тем, кто его зафиксировал). После подписи
    «соответствует» и нарушение отправляются преподавателю; «требуется уточнение» и технический сбой — нет."""
    violation = db.get(Violation, violation_id, with_for_update=True)
    if not violation:
        raise HTTPException(status_code=404, detail="Наблюдение не найдено")
    _ensure_violation_faculty(context, violation)
    if violation.status not in checklist_rules.SIGNABLE_STATUSES or violation.signed_at or not violation.document_hash:
        raise HTTPException(status_code=409, detail="Чек-лист не ожидает подписи")
    if (_signer(violation) or "").lower() not in login_aliases(context["username"]):
        raise HTTPException(status_code=403, detail="Подписать может только наблюдатель, заполнивший чек-лист")
    if document_hash(db, violation) != violation.document_hash:
        raise HTTPException(status_code=409, detail="Содержимое чек-листа изменилось — обновите страницу и подпишите снова")
    info, tutor_id = _verify_own_signature(db, context, body.cms, sign_data(violation))
    # В строке подписи PDF — должность (без учёной степени) и «Фамилия И.О.» по карточке сотрудника;
    # verify_token — код в QR-коде открытой страницы проверки подлинности (/verify/<код>)
    person = tutor_people(db, [tutor_id]).get(tutor_id) or {}
    violation.verify_token = uuid.uuid4().hex
    info.update(signer_name=person.get("name"), signer_position=(person.get("position_ru") or "").split(",")[0].strip())
    violation.signature_info = info
    violation.signature_cms = body.cms
    violation.signed_at = datetime.now(timezone.utc)
    sent = violation.status in checklist_rules.SENT_TO_TEACHER
    if violation.status == "violation":
        violation.status = "confirmed"
    save_checklist_pdf(db, violation)
    notified = notify_teacher(db, violation) if sent else False
    db.commit()
    db.refresh(violation)
    audit_event("monitoring.violation.sign", actor=context.get("username"),
                details={"violation_id": violation.id, "status": violation.status, "sent": sent,
                         "certificate_serial": violation.signature_info.get("certificate_serial"), "teacher_notified": notified}, db=db)
    result = _out(db, violation)
    result.teacher_notified = notified
    return result


@router.post("/{violation_id}/responses", response_model=ViolationOut, status_code=status.HTTP_201_CREATED)
def add_violation_response(
    violation_id: int,
    kind: str = Form(...),
    method: str = Form(...),
    text: str = Form(default="", max_length=10000),
    cms: str = Form(default="", max_length=200_000),
    file: UploadFile | None = File(default=None),
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    """Пояснение преподавателя к подписанному нарушению: объяснительная или оправдательная справка.
    ecp — подписывается в NCALayer строка response_sign_data (SHA-256 текста и файла), scan — скан бумажного документа."""
    violation = db.get(Violation, violation_id)
    if not violation or violation.teacher_login not in login_aliases(context["username"]):
        raise HTTPException(status_code=404, detail="Нарушение не найдено")
    if violation.status != "confirmed":
        raise HTTPException(status_code=409, detail="Пояснение прикладывается к подписанному нарушению")
    if kind not in RESPONSE_KINDS or method not in RESPONSE_METHODS:
        raise HTTPException(status_code=422, detail="Неизвестный вид пояснения")
    content = file.file.read(MAX_RESPONSE_FILE + 1) if file else b""
    if len(content) > MAX_RESPONSE_FILE:
        raise HTTPException(status_code=413, detail="Файл больше 20 МБ")
    file_type = next((mime for magic, mime in RESPONSE_FILE_TYPES.items() if content.startswith(magic)), None)
    if content and not file_type:
        raise HTTPException(status_code=422, detail="Можно приложить PDF, JPG или PNG")
    # multipart/form-data переводит строки текста в CRLF, а подписывается текст из поля ввода (LF)
    text = text.replace("\r\n", "\n").strip()
    if method == "scan" and not content:
        raise HTTPException(status_code=422, detail="Приложите скан подписанного документа")
    if method == "ecp" and not (text or content):
        raise HTTPException(status_code=422, detail="Напишите объяснение или приложите файл")

    digest = hashlib.sha256(text.encode("utf-8") + content).hexdigest()
    signature_info = None
    if method == "ecp":
        if not cms:
            raise HTTPException(status_code=422, detail="Подпишите пояснение ЭЦП")
        signature_info, _ = _verify_own_signature(db, context, cms, response_sign_data(violation.id, kind, digest))

    file_name = path = None
    if content:
        os.makedirs(responses_dir(), mode=0o750, exist_ok=True)
        file_name = f"{uuid.uuid4().hex}{'.pdf' if file_type == 'application/pdf' else '.jpg' if file_type == 'image/jpeg' else '.png'}"
        path = os.path.join(responses_dir(), file_name)
        with open(path, "wb") as target:
            target.write(content)
    response = ViolationResponse(
        violation_id=violation.id, kind=kind, method=method, text=text or None,
        file_name=file_name, file_type=file_type, original_name=(file.filename or "")[:255] if file else None,
        document_hash=digest, signature_cms=cms or None, signature_info=signature_info,
        created_by=context["username"],
    )
    try:
        db.add(response)
        db.flush()
        save_checklist_pdf(db, violation)
        # Наблюдателю и тому, кто подписал, — чтобы рассмотрели пояснение
        for login in {violation.created_by, violation.reviewed_by} - {None}:
            notify(db, login, "violation.response",
                   title=f"Пояснение преподавателя по нарушению № {violation.id}",
                   body=f"{violation.teacher}: {RESPONSE_KINDS[kind]} ({RESPONSE_METHODS[method]}).",
                   link="/monitoring")
        db.commit()
    except Exception:
        db.rollback()
        if path:
            _remove_quietly(path)
        raise
    audit_event("monitoring.violation.response", actor=context["username"],
                details={"violation_id": violation.id, "response_id": response.id, "kind": kind, "method": method}, db=db)
    return _out(db, violation)


@router.patch("/{violation_id}/justify", response_model=ViolationOut)
def justify_violation(
    violation_id: int,
    body: JustifyIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    """Снять нарушение по пояснению преподавателя (объяснительная или оправдательная справка)."""
    violation = db.get(Violation, violation_id, with_for_update=True)
    if not violation:
        raise HTTPException(status_code=404, detail="Наблюдение не найдено")
    _ensure_violation_faculty(context, violation)
    if violation.status != "confirmed":
        raise HTTPException(status_code=409, detail="Снять можно только подписанное нарушение")
    if not db.query(ViolationResponse.id).filter(ViolationResponse.violation_id == violation.id).first():
        raise HTTPException(status_code=409, detail="Преподаватель ещё не приложил пояснение")
    violation.status = "justified"
    violation.reviewed_by = context.get("username") or "unknown"
    violation.reviewed_at = datetime.now(timezone.utc)
    violation.review_comment = body.comment.strip()
    save_checklist_pdf(db, violation)
    if violation.teacher_login:
        notify(db, violation.teacher_login, "violation.justified",
               title=f"Нарушение № {violation.id} снято",
               body=f"Пояснение принято: {violation.review_comment}", link="/my-violations")
    db.commit()
    db.refresh(violation)
    audit_event("monitoring.violation.justify", actor=context.get("username"), details={"violation_id": violation.id}, db=db)
    return _out(db, violation)


@router.get("/dashboard")
def violations_dashboard(
    academic_year: str | None = None,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN, ROLE_COMMITTEE)),
):
    """Дашборд ситуационного мониторинга за учебный год (по дате нарушения). Деканат — свой факультет."""
    from services.dashboard_service import violations_dashboard as build

    return build(db, academic_year=academic_year, faculty_id=dean_faculty_id(context))


@router.get("/my", response_model=list[ViolationOut])
def list_my_violations(
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    """Чек-листы занятий текущего пользователя как преподавателя (по логину Platonus), отправленные ему после
    подписи ЭЦП: нарушения (и снятые по пояснению) и наблюдения без замечаний."""
    violations = (
        db.query(Violation)
        .filter(Violation.teacher_login.in_(login_aliases(context["username"])),
                or_(Violation.status.in_(TEACHER_STATUSES), and_(Violation.status == "compliant", Violation.signed_at.isnot(None))))
        .order_by(Violation.violation_date.desc(), Violation.id.desc())
        .limit(500)
        .all()
    )
    # Пояснения — одним запросом на весь список, а не по запросу на каждое нарушение
    responses_by_violation: dict[int, list] = {}
    if violations:
        rows = (db.query(ViolationResponse)
                .filter(ViolationResponse.violation_id.in_([item.id for item in violations]))
                .order_by(ViolationResponse.id).all())
        for row in rows:
            responses_by_violation.setdefault(row.violation_id, []).append(row)
    names = _display_names(db, [login for violation in violations for login in (violation.created_by, violation.reviewed_by)])
    return [_out(db, violation, evidence=[], responses=responses_by_violation.get(violation.id, []), names=names)
            for violation in violations]


@router.get("/{violation_id}/act")
def get_violation_act(
    violation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    """PDF формы 16-02 (у записей до формы — акт): админ, члены комитета КРК, деканат своего факультета
    и сам преподаватель — после подписи нарушения."""
    violation = db.get(Violation, violation_id)
    if violation and not (_is_reviewer(context, violation) or _is_teacher(context, violation)):
        raise HTTPException(status_code=403, detail="Недостаточно прав")
    if violation and violation.signed_at and violation.verify_token:
        # Подписанный чек-лист — с QR-кодами подписанта и проверки по адресу сайта, с которого открыт
        return Response(checklist_pdf_bytes(db, violation, public_base_url(request)), media_type="application/pdf",
                        headers={"Content-Disposition": f'inline; filename="checklist-{violation.id}.pdf"',
                                 "Cache-Control": "private, no-store"})
    if not violation or not violation.act_filename:
        raise HTTPException(status_code=404, detail="АКТ не найден")
    path = os.path.join(act_dir(), os.path.basename(violation.act_filename))
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл АКТа не найден")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"act-violation-{violation.id}.pdf",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/responses/{response_id}/file")
def get_response_file(
    response_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    """Файл пояснения: те же, кто видит форму нарушения."""
    response = db.get(ViolationResponse, response_id)
    violation = db.get(Violation, response.violation_id) if response else None
    if not violation or not (_is_reviewer(context, violation) or _is_teacher(context, violation)):
        raise HTTPException(status_code=404, detail="Файл не найден")
    path = os.path.join(responses_dir(), os.path.basename(response.file_name or ""))
    if not response.file_name or not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл не найден")
    return FileResponse(path, media_type=response.file_type or "application/octet-stream",
                        content_disposition_type="inline", headers={"Cache-Control": "private, no-store"})


@router.get("/evidence/{evidence_id}")
def get_violation_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN, ROLE_COMMITTEE)),
):
    evidence = db.get(ViolationEvidence, evidence_id)
    if not evidence:
        raise HTTPException(status_code=404, detail="Медиафайл не найден")
    if dean_faculty_id(context) is not None:
        # Деканат: доказательства нарушений своего факультета и свои ещё не привязанные снимки
        violation = db.get(Violation, evidence.violation_id) if evidence.violation_id else None
        if violation:
            _ensure_violation_faculty(context, violation)
        elif evidence.created_by != context.get("username"):
            raise forbid_other_faculty()
    path = os.path.join(evidence_dir(), evidence.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл доказательства не найден")
    media_type = "image/jpeg" if evidence.media_type == "photo" else "video/mp4"
    return FileResponse(path, media_type=media_type, filename=evidence.filename)
