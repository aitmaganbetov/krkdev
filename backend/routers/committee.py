from datetime import date
from urllib.parse import quote
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from services import ROLE_ADMIN, ROLE_COMMITTEE, ROLE_DEAN, ROLE_INSPECTOR, ROLE_SUPERADMIN, get_current_user_context, require_roles
from services import committee_assignments as assignments
from services import committee_service as service
from services.audit_log import audit_event
from services.request_meta import get_client_ip, public_base_url

# Комитет ректорского контроля: составы по учебным годам (приказы) и члены комитета.
# Ведёт администратор; смотрят инспекторы, деканаты и сами члены комитета.
router = APIRouter(prefix="/committee", tags=["committee"])

VIEW_ROLES = (ROLE_ADMIN, ROLE_INSPECTOR, ROLE_DEAN, ROLE_COMMITTEE)
# Распределение проверок по преподавателям: кто кого проверяет, видят только организаторы КРК (п. 3.6, 3.9.9 ДП —
# кафедры и деканаты проверяющих не согласуют); член комитета видит свои назначения в «Моих показателях»
ASSIGN_ROLES = (ROLE_ADMIN, ROLE_INSPECTOR)


class OrderPatch(BaseModel):
    number: Optional[str] = Field(None, min_length=1, max_length=50)
    order_date: Optional[date] = None
    academic_year: Optional[str] = Field(None, pattern=r"^\d{4}-\d{4}$")
    title_ru: Optional[str] = Field(None, min_length=1, max_length=500)
    title_kz: Optional[str] = Field(None, max_length=500)
    purpose_ru: Optional[str] = Field(None, max_length=4000)
    purpose_kz: Optional[str] = Field(None, max_length=4000)
    basis_ru: Optional[str] = Field(None, max_length=4000)
    basis_kz: Optional[str] = Field(None, max_length=4000)
    # Подписант — сотрудник Platonus; подпись в приказе («Ректор Л. Байболова») собирается на сервере
    signer_tutor_id: Optional[int] = None
    signer_position: Optional[str] = Field(None, max_length=255)


class OrderIn(OrderPatch):
    # Номер и дата — после подписания; до этого состав — проект приказа
    academic_year: str = Field(pattern=r"^\d{4}-\d{4}$")
    title_ru: str = Field(min_length=1, max_length=500)
    # Скопировать состав из другого года (ФИО и должности обновятся из Platonus)
    copy_members_from: Optional[int] = None


class SignIn(BaseModel):
    # CMS из NCALayer (base64 или PEM)
    cms: str = Field(min_length=1, max_length=65536)


class MemberIn(BaseModel):
    # ФИО и должность — из карточки преподавателя Platonus
    tutor_id: int
    position: Optional[int] = Field(None, ge=1, le=1000)


class AssignmentIn(BaseModel):
    term: int = Field(ge=1, le=2)
    teacher_tutor_id: int
    # None — снять назначение
    inspector_tutor_id: Optional[int] = None


class ExclusionIn(BaseModel):
    excluded: bool


class MemberPatch(BaseModel):
    tutor_id: Optional[int] = None
    position: Optional[int] = Field(None, ge=1, le=1000)


def _audit(action: str, context: dict, details: dict, db: Session, request: Request) -> None:
    audit_event(action=action, outcome="success", actor=context["username"], details=details,
                db=db, ip_address=get_client_ip(request))


@router.get("")
def committee_overview(db: Session = Depends(get_db), _: dict = Depends(require_roles(*VIEW_ROLES))):
    """Список приказов, действующий приказ с составом и ректор из Platonus (подписант по умолчанию)."""
    orders = service.list_orders(db)
    active = next((order for order in orders if order["is_active"]), None)
    return {
        "orders": orders,
        "active": service.order_detail(db, service.get_order(db, active["id"])) if active else None,
        "rector_tutor_id": service.rector_tutor_id(db),
    }


@router.get("/tutors")
def committee_tutors(db: Session = Depends(get_db), _: dict = Depends(require_roles(ROLE_ADMIN))):
    """Преподаватели Platonus для состава комитета — с ФИО и должностью, какими они войдут в приказ."""
    rows = db.execute(text("""
        SELECT t.tutor_id AS id, t.full_name, t.login, c.cafedraNameRU AS cafedra
        FROM tutors t LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        WHERE COALESCE(t.full_name, '') <> ''
        ORDER BY t.full_name
    """)).mappings().all()
    people = service.tutor_people(db)
    return [{**dict(row), **people.get(row["id"], {})} for row in rows]


@router.get("/orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), _: dict = Depends(require_roles(*VIEW_ROLES))):
    return service.order_detail(db, service.get_order(db, order_id))


@router.post("/orders", status_code=201)
def create_order(body: OrderIn, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    data = body.model_dump(exclude={"copy_members_from"})
    source = service.get_order(db, body.copy_members_from) if body.copy_members_from else None
    order = service.create_order(db, data, context["username"], copy_from=source)
    _audit("committee.order.create", context, {"order_id": order.id, "number": order.number, "copied_from": body.copy_members_from}, db, request)
    return service.order_detail(db, order)


@router.patch("/orders/{order_id}")
def update_order(order_id: int, body: OrderPatch, request: Request, db: Session = Depends(get_db),
                 context: dict = Depends(require_roles(ROLE_ADMIN))):
    data = body.model_dump(exclude_unset=True)
    for key in ("academic_year", "title_ru"):
        if key in data and data[key] is None:
            raise HTTPException(status_code=422, detail="Учебный год и название приказа обязательны")
    if data.get("number") is not None:
        data["number"] = data["number"].strip() or None
    order = service.update_order(db, service.get_order(db, order_id), data)
    _audit("committee.order.update", context, {"order_id": order.id, "changed_fields": sorted(data)}, db, request)
    return service.order_detail(db, order)


@router.post("/orders/{order_id}/activate")
def activate_order(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.activate_order(db, service.get_order(db, order_id))
    _audit("committee.order.activate", context, {"order_id": order.id, "number": order.number}, db, request)
    return service.order_detail(db, order)


@router.post("/orders/{order_id}/deactivate")
def deactivate_order(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.deactivate_order(db, service.get_order(db, order_id))
    _audit("committee.order.deactivate", context, {"order_id": order.id, "number": order.number}, db, request)
    return service.order_detail(db, order)


@router.delete("/orders/{order_id}", status_code=204)
def delete_order(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.get_order(db, order_id)
    number = order.number
    service.delete_order(db, order)
    _audit("committee.order.delete", context, {"order_id": order_id, "number": number}, db, request)


@router.post("/orders/{order_id}/file")
def upload_order_file(order_id: int, request: Request, file: UploadFile = File(...), db: Session = Depends(get_db),
                      context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.get_order(db, order_id)
    if not (file.filename or "").lower().endswith(".pdf") or file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Можно прикрепить только PDF-файл")
    content = file.file.read(service.MAX_FILE_SIZE + 1)
    if len(content) > service.MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="Размер PDF не должен превышать 20 МБ")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Файл не является корректным PDF")
    service.save_file(db, order, content)
    _audit("committee.order.file", context, {"order_id": order.id, "size": len(content)}, db, request)
    return service.order_detail(db, order)


@router.get("/orders/{order_id}/file")
def download_order_file(order_id: int, db: Session = Depends(get_db), _: dict = Depends(require_roles(*VIEW_ROLES))):
    order = service.get_order(db, order_id)
    return FileResponse(
        service.file_path(order),
        media_type="application/pdf",
        filename=f"committee-order-{order.id}.pdf",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.post("/orders/{order_id}/refresh")
def refresh_members(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    """ФИО и должности членов — заново из карточек преподавателей (Platonus + правки КРК)."""
    order = service.get_order(db, order_id)
    changed = service.refresh_members(db, order)
    _audit("committee.members.refresh", context, {"order_id": order.id, "changed": changed}, db, request)
    return {**service.order_detail(db, order), "refreshed": changed}


def _pdf_response(db: Session, order, request: Request, languages: str) -> Response:
    langs = tuple(lang for lang in languages.split(",") if lang in ("ru", "kz")) or ("ru",)
    if not db.query(service.CommitteeMember.id).filter(service.CommitteeMember.order_id == order.id).first():
        raise HTTPException(status_code=422, detail="В составе нет членов комитета")
    content = service.pdf_bytes(db, order, public_base_url(request), langs)
    name = f"Приказ_{order.number or order.academic_year}.pdf"
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=order.pdf; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, no-store",
    })


@router.get("/orders/{order_id}/pdf")
def order_pdf(order_id: int, request: Request, languages: str = "ru", db: Session = Depends(get_db),
              _: dict = Depends(require_roles(*VIEW_ROLES))):
    """PDF приказа: на каждый язык — документ до двух страниц; подписанный ЭЦП — с QR-кодами подписанта и проверки."""
    return _pdf_response(db, service.get_order(db, order_id), request, languages)


@router.get("/orders/{order_id}/assignments")
def get_assignments(order_id: int, term: int = 1, db: Session = Depends(get_db), _: dict = Depends(require_roles(*ASSIGN_ROLES))):
    """Распределение проверок семестра: преподаватели, назначенные члены комитета и их нагрузка."""
    return assignments.overview(db, service.get_order(db, order_id), term)


@router.post("/orders/{order_id}/assignments/distribute")
def distribute_assignments(order_id: int, request: Request, term: int = 1, db: Session = Depends(get_db),
                           context: dict = Depends(require_roles(*ASSIGN_ROLES))):
    """Распределить проверки семестра заново (назначенные вручную сохраняются)."""
    result = assignments.distribute(db, service.get_order(db, order_id), term, context["username"])
    _audit("committee.assignments.distribute", context, {"order_id": order_id, "term": term, **result["summary"]}, db, request)
    return result


@router.put("/orders/{order_id}/assignments")
def set_assignment(order_id: int, body: AssignmentIn, request: Request, db: Session = Depends(get_db),
                   context: dict = Depends(require_roles(*ASSIGN_ROLES))):
    result = assignments.assign(db, service.get_order(db, order_id), body.term, body.teacher_tutor_id,
                                body.inspector_tutor_id, context["username"])
    _audit("committee.assignments.set", context, {"order_id": order_id, **body.model_dump()}, db, request)
    return result


@router.put("/orders/{order_id}/assignments/inspectors/{tutor_id}")
def set_inspector_excluded(order_id: int, tutor_id: int, body: ExclusionIn, request: Request, term: int = 1,
                           db: Session = Depends(get_db), context: dict = Depends(require_roles(*ASSIGN_ROLES))):
    """Исключить члена состава из проверок или вернуть. Подписанный приказ не меняется; непроведённые проверки
    исключённого передаются остальным членам (moved)."""
    order = service.get_order(db, order_id)
    moved = assignments.set_excluded(db, order, tutor_id, body.excluded, context["username"])
    _audit("committee.assignments.exclude", context, {"order_id": order_id, "tutor_id": tutor_id, "excluded": body.excluded, "moved": moved}, db, request)
    return {**assignments.overview(db, order, term), "moved": moved}


@router.delete("/orders/{order_id}/assignments")
def clear_assignments(order_id: int, request: Request, term: int = 1, db: Session = Depends(get_db),
                      context: dict = Depends(require_roles(*ASSIGN_ROLES))):
    order = service.get_order(db, order_id)
    removed = assignments.clear(db, order, term)
    _audit("committee.assignments.clear", context, {"order_id": order_id, "term": term, "removed": removed}, db, request)
    return assignments.overview(db, order, term)


@router.post("/orders/{order_id}/members", status_code=201)
def add_member(order_id: int, body: MemberIn, request: Request, db: Session = Depends(get_db),
               context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.get_order(db, order_id)
    member = service.add_member(db, order, body.tutor_id, body.position)
    _audit("committee.member.add", context, {"order_id": order.id, "member_id": member.id, "tutor_id": member.tutor_id}, db, request)
    return service.order_detail(db, order)


@router.patch("/members/{member_id}")
def update_member(member_id: int, body: MemberPatch, request: Request, db: Session = Depends(get_db),
                  context: dict = Depends(require_roles(ROLE_ADMIN))):
    data = body.model_dump(exclude_unset=True)
    member = service.update_member(db, service.get_member(db, member_id), data)
    _audit("committee.member.update", context, {"member_id": member.id, "changed_fields": sorted(data)}, db, request)
    return service.order_detail(db, service.get_order(db, member.order_id))


@router.delete("/members/{member_id}")
def delete_member(member_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    """Удалить члена состава. Из подписанного ЭЦП приказа — только суперадмин: подписанный состав сохраняется
    для проверки подписи и PDF, непроведённые проверки удалённого передаются остальным членам (moved)."""
    member = service.get_member(db, member_id)
    order = service.get_order(db, member.order_id)
    after_signing = context.get("role") == ROLE_SUPERADMIN and bool(order.signed_at)
    service.ensure_member_deletable(order, after_signing)
    moved = 0
    if member.tutor_id:
        moved = assignments.hand_over(db, order, member.tutor_id, context["username"])
        assignments.forget_member(db, order, member.tutor_id)
    service.delete_member(db, member, after_signing)
    _audit("committee.member.delete", context, {"order_id": order.id, "member_id": member_id, "tutor_id": member.tutor_id,
                                                "after_signing": after_signing, "moved": moved}, db, request)
    return {**service.order_detail(db, order), "moved": moved}


# --- Подписание ЭЦП ---

@router.post("/orders/{order_id}/send")
def send_for_signing(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    """Проект → на подпись выбранному подписанту (содержимое фиксируется)."""
    order = service.send_for_signing(db, service.get_order(db, order_id))
    _audit("committee.order.send", context, {"order_id": order.id, "number": order.number, "signer_tutor_id": order.signer_tutor_id}, db, request)
    return service.order_detail(db, order)


@router.post("/orders/{order_id}/recall")
def recall_from_signing(order_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(ROLE_ADMIN))):
    order = service.recall_from_signing(db, service.get_order(db, order_id))
    _audit("committee.order.recall", context, {"order_id": order.id}, db, request)
    return service.order_detail(db, order)


def _signer_order(db: Session, order_id: int, context: dict):
    order = service.get_order(db, order_id)
    if not service.is_signer(db, order, context["username"]):
        raise HTTPException(status_code=403, detail="Документ адресован другому подписанту")
    return order


@router.get("/signing/{order_id}")
def signing_document(order_id: int, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    """Документ для подписанта и данные, которые он подписывает в NCALayer."""
    order = _signer_order(db, order_id, context)
    detail = service.order_detail(db, order)
    detail["sign_data"] = service.sign_data(order) if order.sent_at and not order.signed_at else None
    return detail


@router.post("/signing/{order_id}")
def sign_document(order_id: int, body: SignIn, request: Request, db: Session = Depends(get_db),
                  context: dict = Depends(get_current_user_context)):
    order = _signer_order(db, order_id, context)
    try:
        order = service.sign_order(db, order, context["username"], body.cms)
    except HTTPException as exc:
        audit_event(action="committee.order.sign", outcome="failure", actor=context["username"],
                    details={"order_id": order_id, "reason": exc.detail}, db=db, ip_address=get_client_ip(request))
        raise
    _audit("committee.order.sign", context, {"order_id": order.id, "number": order.number,
                                             "certificate_serial": (order.signature_info or {}).get("certificate_serial")}, db, request)
    return service.order_detail(db, order)


@router.get("/signing/{order_id}/pdf")
def signing_pdf(order_id: int, request: Request, languages: str = "ru", db: Session = Depends(get_db),
                context: dict = Depends(get_current_user_context)):
    return _pdf_response(db, _signer_order(db, order_id, context), request, languages)
