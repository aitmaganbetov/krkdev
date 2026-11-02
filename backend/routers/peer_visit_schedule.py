from typing import Literal, Optional

from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from models.peer_visit_schedule import PeerVisitSchedule
from services.faculty_scope import dean_faculty_id
from services import ROLE_ADMIN, ROLE_DEAN, ROLE_PEER_INSPECTOR, get_current_user_context, require_roles
from services import peer_visit_schedule_service as service
from services import schedule_approval_service as approvals
from services.committee_service import tutor_people
from services.audit_log import audit_event
from services.request_meta import get_client_ip, public_base_url

# График взаимопосещения: просмотр выполнения — админ, инспектор, деканат (свой факультет);
# составление — админ и деканат; свой план посещений — любой пользователь (GET /my)
router = APIRouter(prefix="/peer-visit-schedule", tags=["peer-visit-schedule"])

VIEW_ROLES = (ROLE_ADMIN, ROLE_PEER_INSPECTOR, ROLE_DEAN)
EDIT_ROLES = (ROLE_ADMIN, ROLE_DEAN)
Status = Literal["done", "in_progress", "overdue", "planned"]


class ScheduleRowPatch(BaseModel):
    academic_year: Optional[str] = Field(None, min_length=4, max_length=20)
    period: Optional[int] = Field(None, ge=1, le=2)
    faculty_id: Optional[int] = None
    cafedra_id: Optional[int] = None
    cafedra_name: Optional[str] = Field(None, max_length=255)
    visited_tutor_id: Optional[int] = None
    visited_name: Optional[str] = Field(None, max_length=255)
    visited_position: Optional[str] = Field(None, max_length=255)
    visitor_tutor_id: Optional[int] = None
    visitor_name: Optional[str] = Field(None, max_length=255)
    visitor_position: Optional[str] = Field(None, max_length=255)
    month: Optional[int] = Field(None, ge=1, le=12)
    note: Optional[str] = Field(None, max_length=2000)


class ScheduleRowIn(ScheduleRowPatch):
    academic_year: str = Field(min_length=4, max_length=20)
    period: int = Field(1, ge=1, le=2)
    month: int = Field(ge=1, le=12)


def _filters(context: dict, academic_year, period, faculty_id, cafedra_id, month, search) -> dict:
    # Деканат видит только свой факультет, независимо от параметра faculty_id
    dean_faculty = dean_faculty_id(context)
    return {
        "academic_year": academic_year, "period": period,
        "faculty_id": dean_faculty if dean_faculty is not None else faculty_id,
        "cafedra_id": cafedra_id, "month": month, "search": search,
    }


def _audit(action: str, context: dict, details: dict, db: Session, request: Request) -> None:
    audit_event(action=action, outcome="success", actor=context["username"], details=details,
                db=db, ip_address=get_client_ip(request))


@router.get("")
def list_schedule(
    academic_year: Optional[str] = Query(None),
    period: Optional[int] = Query(None, ge=1, le=2),
    faculty_id: Optional[int] = Query(None),
    cafedra_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    status: Optional[Status] = Query(None),
    unmatched: bool = Query(False),
    search: Optional[str] = Query(None, max_length=100),
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*VIEW_ROLES)),
):
    filters = _filters(context, academic_year, period, faculty_id, cafedra_id, month, search)
    items = service.list_rows(db, status_filter=status, unmatched_only=unmatched, **filters)
    return {"total": len(items), "items": items}


@router.get("/summary")
def schedule_summary(
    academic_year: Optional[str] = Query(None),
    period: Optional[int] = Query(None, ge=1, le=2),
    faculty_id: Optional[int] = Query(None),
    month: Optional[int] = Query(None, ge=1, le=12),
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*VIEW_ROLES)),
):
    """Итоги выполнения по кафедрам и в целом."""
    items = service.list_rows(db, **_filters(context, academic_year, period, faculty_id, None, month, None))
    totals = service.summary([{**item, "faculty_id": 0, "cafedra_id": None, "cafedra_name": ""} for item in items])
    return {"cafedras": service.summary(items), "total": totals[0] if totals else None}


@router.get("/my")
def my_schedule(
    db: Session = Depends(get_db),
    context: dict = Depends(get_current_user_context),
):
    """План посещений текущего пользователя (он — посещающий в строках графика)."""
    return service.my_rows(db, context["username"])


@router.get("/tutors")
def schedule_tutors(
    faculty_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*EDIT_ROLES)),
):
    """Преподаватели для составления графика (сначала — своего факультета); position — должность и степень
    из карточки преподавателя (Platonus + правки КРК) для подстановки в строку графика."""
    faculty = dean_faculty_id(context) or faculty_id
    rows = db.execute(text("""
        SELECT t.tutor_id AS id, t.full_name, c.cafedraNameRU AS cafedra, c.FacultyID AS faculty_id
        FROM tutors t LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        WHERE COALESCE(t.full_name, '') <> ''
        ORDER BY (c.FacultyID = :faculty) DESC, t.full_name
    """), {"faculty": faculty or 0}).mappings().all()
    people = tutor_people(db, with_title=True)
    return [{**dict(row), "position": people.get(row["id"], {}).get("title", "")} for row in rows]


@router.post("", status_code=201)
def create_schedule_row(
    body: ScheduleRowIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*EDIT_ROLES)),
):
    data = body.model_dump(exclude_unset=True)
    dean_faculty = dean_faculty_id(context)
    if dean_faculty is not None:
        data["faculty_id"] = dean_faculty
    if not data.get("faculty_id"):
        raise HTTPException(status_code=422, detail="Укажите факультет")
    approvals.ensure_schedule_editable(db, data["academic_year"], data.get("period", 1), data["faculty_id"])
    row = service.save_row(db, PeerVisitSchedule(created_by=context["username"]), data)
    _audit("peer_visit_schedule.create", context, {"schedule_id": row.id, "faculty_id": row.faculty_id}, db, request)
    return service.row_with_status(db, row)


@router.patch("/{row_id}")
def update_schedule_row(
    row_id: int,
    body: ScheduleRowPatch,
    request: Request,
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*EDIT_ROLES)),
):
    row = service.get_row(db, row_id)
    dean_faculty = dean_faculty_id(context)
    service.ensure_faculty_scope(row.faculty_id, dean_faculty)
    data = body.model_dump(exclude_unset=True)
    if dean_faculty is not None:
        data.pop("faculty_id", None)
    approvals.ensure_schedule_editable(db, row.academic_year, row.period, row.faculty_id)
    if {"academic_year", "period", "faculty_id"} & set(data):
        approvals.ensure_schedule_editable(db, data.get("academic_year", row.academic_year), data.get("period", row.period),
                                           data.get("faculty_id", row.faculty_id))
    row = service.save_row(db, row, data)
    _audit("peer_visit_schedule.update", context, {"schedule_id": row.id, "changed_fields": sorted(data.keys())}, db, request)
    return service.row_with_status(db, row)


@router.delete("/{row_id}", status_code=204)
def delete_schedule_row(
    row_id: int,
    request: Request,
    db: Session = Depends(get_db),
    context: dict = Depends(require_roles(*EDIT_ROLES)),
):
    row = service.get_row(db, row_id)
    service.ensure_faculty_scope(row.faculty_id, dean_faculty_id(context))
    approvals.ensure_schedule_editable(db, row.academic_year, row.period, row.faculty_id)
    service.delete_row(db, row)
    _audit("peer_visit_schedule.delete", context, {"schedule_id": row_id}, db, request)


# --- Утверждение графика ЭЦП: заведующие кафедрами → согласующие → утверждающий ---

class ApprovalSignerIn(BaseModel):
    role: str = Field(min_length=1, max_length=40)
    tutor_id: Optional[int] = None
    label: Optional[str] = Field(None, max_length=500)


class ApprovalIn(BaseModel):
    academic_year: str = Field(min_length=4, max_length=20)
    period: int = Field(ge=1, le=2)
    faculty_id: Optional[int] = None
    title: str = Field("", max_length=255)
    signers: list[ApprovalSignerIn] = Field(default_factory=list, max_length=60)


def _approval_scope(context: dict, faculty_id: Optional[int]) -> int:
    faculty = dean_faculty_id(context) or faculty_id
    if not faculty:
        raise HTTPException(status_code=422, detail="Укажите факультет")
    return faculty


def _approval_for(db: Session, approval_id: int, context: dict):
    approval = approvals.get(db, approval_id)
    service.ensure_faculty_scope(approval.faculty_id, dean_faculty_id(context))
    return approval


@router.get("/approval")
def get_approval(academic_year: str = Query(...), period: int = Query(1, ge=1, le=2), faculty_id: Optional[int] = Query(None),
                 db: Session = Depends(get_db), context: dict = Depends(require_roles(*VIEW_ROLES))):
    """Маршрут утверждения графика факультета; если его нет — подписанты по умолчанию из Platonus."""
    faculty = _approval_scope(context, faculty_id)
    return approvals.detail(db, approvals.find(db, academic_year, period, faculty), academic_year, period, faculty)


@router.put("/approval")
def save_approval(body: ApprovalIn, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(*EDIT_ROLES))):
    faculty = _approval_scope(context, body.faculty_id)
    approval = approvals.save_draft(db, body.academic_year, body.period, faculty, body.title,
                                    [s.model_dump() for s in body.signers], context["username"])
    _audit("peer_visit_schedule.approval.save", context, {"approval_id": approval.id, "faculty_id": faculty}, db, request)
    return approvals.detail(db, approval, approval.academic_year, approval.period, approval.faculty_id)


@router.post("/approval/{approval_id}/send")
def send_approval(approval_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(*EDIT_ROLES))):
    approval = approvals.send(db, _approval_for(db, approval_id, context))
    _audit("peer_visit_schedule.approval.send", context, {"approval_id": approval.id}, db, request)
    return approvals.detail(db, approval, approval.academic_year, approval.period, approval.faculty_id)


@router.post("/approval/{approval_id}/recall")
def recall_approval(approval_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(*EDIT_ROLES))):
    approval = approvals.recall(db, _approval_for(db, approval_id, context))
    _audit("peer_visit_schedule.approval.recall", context, {"approval_id": approval.id}, db, request)
    return approvals.detail(db, approval, approval.academic_year, approval.period, approval.faculty_id)


def schedule_pdf_response(db: Session, approval, request: Request) -> Response:
    content = approvals.pdf_bytes(db, approval, public_base_url(request))
    name = f"График_взаимопосещения_{approval.academic_year}_{approval.period}.pdf"
    return Response(content, media_type="application/pdf", headers={
        "Content-Disposition": f"attachment; filename=schedule.pdf; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, no-store",
    })


@router.get("/approval/{approval_id}/pdf")
def approval_pdf(approval_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(require_roles(*VIEW_ROLES))):
    return schedule_pdf_response(db, _approval_for(db, approval_id, context), request)
