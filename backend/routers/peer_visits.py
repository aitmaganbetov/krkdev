from contextlib import contextmanager
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from database import get_db
from schemas.peer_visit import PeerVisitCreate, PeerVisitListOut, PeerVisitOut, PeerVisitUpdate
from services.faculty_scope import dean_faculty_id
from services import ROLE_ADMIN, ROLE_COMMITTEE, ROLE_DEAN, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_TEACHER, ROLE_USER, require_roles
from services import peer_visit_service as service
from services.audit_log import audit_event
from services.record_service import _username_aliases
from services.request_meta import get_client_ip

# Взаимопосещение занятий: отдельный модуль, правила доступа и статусы как у записей КРК
router = APIRouter(prefix="/peer-visits", tags=["peer-visits"])

# «Пользователь» и «Преподаватель» — только отзывы по своим строкам графика; деканат — только своего факультета
# (проверки в peer_visit_service)
ALL_ROLES = (ROLE_ADMIN, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_COMMITTEE, ROLE_USER, ROLE_TEACHER, ROLE_DEAN)
# Чтение и проверка отзывов: деканат — только своего факультета (см. peer_visit_service)
READ_ROLES = (ROLE_ADMIN, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_COMMITTEE, ROLE_USER, ROLE_TEACHER, ROLE_DEAN)
REVIEW_ROLES = (ROLE_ADMIN, ROLE_PEER_INSPECTOR, ROLE_DEAN)


def _summary(visit) -> dict:
    return {
        "peer_visit_id": visit.id,
        "teacher": visit.teacher,
        "visitor": visit.visitor_name,
        "status": visit.status,
    }


@contextmanager
def _audited(action: str, request: Request, db: Session, actor: str, details: dict):
    """Пишет в журнал аудита результат действия; details дополняется внутри блока."""
    try:
        yield details
    except Exception as e:
        error = e.detail if isinstance(e, HTTPException) else str(e)
        audit_event(action=action, outcome="failure", actor=actor, details={**details, "error": error},
                    db=db, ip_address=get_client_ip(request))
        raise
    audit_event(action=action, outcome="success", actor=actor, details=details,
                db=db, ip_address=get_client_ip(request))


@router.get("", response_model=PeerVisitListOut)
def list_peer_visits(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None),
    faculty: Optional[str] = Query(None),
    academic_year: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*READ_ROLES)),
):
    role = current_user["role"]
    total, items = service.get_visits(
        db, skip=skip, limit=limit, status=status, faculty=faculty,
        academic_year=academic_year, search=search,
        submitted_by_aliases=_username_aliases(current_user["username"]) if role in (ROLE_STAFF, ROLE_COMMITTEE, ROLE_USER, ROLE_TEACHER) else None,
        inspector_review_view=role == ROLE_PEER_INSPECTOR,
        dean_faculty_id=dean_faculty_id(current_user),
        dean_aliases=_username_aliases(current_user["username"]) if role == ROLE_DEAN else None,
    )
    return PeerVisitListOut(total=total, items=items)


@router.post("", response_model=PeerVisitOut, status_code=201)
def create_peer_visit(
    body: PeerVisitCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*ALL_ROLES)),
):
    actor = current_user["username"]
    with _audited("peer_visit.create", request, db, actor, {"teacher": body.teacher}) as details:
        visit = service.create_visit(db, body, submitted_by=actor, role=current_user["role"],
                                     faculty_id=current_user.get("faculty_id"))
        details.update(_summary(visit))
    return visit


@router.get("/dashboard")
def peer_visits_dashboard(
    academic_year: Optional[str] = Query(None),
    faculty: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*REVIEW_ROLES)),
):
    """Дашборд модуля: отзывы по статусам и уровням, выполнение графика. Деканат — только свой факультет."""
    from services.dashboard_service import peer_visits_dashboard as build

    dean_faculty = dean_faculty_id(current_user)
    if dean_faculty is not None:
        faculty = service.FACULTY_CODE_BY_ID.get(dean_faculty, "")
    return build(db, academic_year=academic_year, faculty_code=faculty or None)


@router.get("/{visit_id}", response_model=PeerVisitOut)
def get_peer_visit(
    visit_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*READ_ROLES)),
):
    visit = service.get_visit_by_id(db, visit_id)
    service.ensure_can_read(visit, current_user["username"], current_user["role"], current_user.get("faculty_id"))
    return visit


@router.patch("/{visit_id}", response_model=PeerVisitOut)
def update_peer_visit(
    visit_id: int,
    body: PeerVisitUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*ALL_ROLES)),
):
    actor = current_user["username"]
    details = {"peer_visit_id": visit_id, "changed_fields": list(body.model_dump(exclude_unset=True).keys())}
    with _audited("peer_visit.update", request, db, actor, details):
        visit = service.update_visit(db, visit_id, body, username=actor, role=current_user["role"],
                                     faculty_id=current_user.get("faculty_id"))
        details.update(_summary(visit))
    return visit


@router.delete("/{visit_id}", status_code=204)
def delete_peer_visit(
    visit_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_PEER_INSPECTOR, ROLE_DEAN)),
):
    if current_user["role"] == ROLE_DEAN:
        service.ensure_dean_faculty(service.get_visit_by_id(db, visit_id), current_user.get("faculty_id"), current_user["username"])
    with _audited("peer_visit.delete", request, db, current_user["username"], {"peer_visit_id": visit_id}):
        service.delete_visit(db, visit_id)


@router.post("/{visit_id}/submit", response_model=PeerVisitOut)
def submit_peer_visit(
    visit_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_STAFF, ROLE_COMMITTEE, ROLE_USER, ROLE_TEACHER)),
):
    actor = current_user["username"]
    with _audited("peer_visit.submit", request, db, actor, {"peer_visit_id": visit_id}) as details:
        visit = service.submit_visit(db, visit_id, username=actor)
        details.update(_summary(visit))
    return visit


@router.post("/{visit_id}/send-to-rework", response_model=PeerVisitOut)
def send_peer_visit_to_rework(
    visit_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*REVIEW_ROLES)),
):
    actor = current_user["username"]
    with _audited("peer_visit.send-to-rework", request, db, actor, {"peer_visit_id": visit_id}) as details:
        visit = service.review_visit(db, visit_id, username=actor, new_status="rework",
                                     dean_faculty_id=dean_faculty_id(current_user))
        details.update(_summary(visit))
    return visit


@router.post("/{visit_id}/accept", response_model=PeerVisitOut)
def accept_peer_visit(
    visit_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(*REVIEW_ROLES)),
):
    actor = current_user["username"]
    with _audited("peer_visit.accept", request, db, actor, {"peer_visit_id": visit_id}) as details:
        visit = service.review_visit(db, visit_id, username=actor, new_status="accepted",
                                     dean_faculty_id=dean_faculty_id(current_user))
        details.update(_summary(visit))
    return visit
