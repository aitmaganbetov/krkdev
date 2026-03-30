from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session
from typing import Optional

from database import get_db
from schemas.record import RecordCreate, RecordUpdate, RecordOut, RecordListOut, DashboardStats
from services import (
    ROLE_ADMIN,
    ROLE_INSPECTOR,
    ROLE_STAFF,
    get_current_user_context,
    record_service,
    require_roles,
)
from services.audit_log import audit_event

router = APIRouter(prefix="/records", tags=["records"])


def _username_aliases(username: str) -> list[str]:
    raw = (username or "").strip().lower()
    if not raw:
        return []
    aliases = {raw}
    if "\\" in raw:
        aliases.add(raw.split("\\", 1)[1])
    if "@" in raw:
        aliases.add(raw.split("@", 1)[0])
    return list(aliases)


def _is_owner(submitted_by: Optional[str], username: str) -> bool:
    owner = (submitted_by or "").strip().lower()
    return bool(owner and owner in _username_aliases(username))


@router.get("/filter-options")
def get_record_filter_options(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    return record_service.get_record_filter_options(db)


@router.get("/dashboard/faculty-comparison")
def get_faculty_comparison(
    faculty: Optional[str] = Query(None),
    op: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    return record_service.get_faculty_comparison(db, faculty=faculty, op=op)


@router.get("/dashboard", response_model=DashboardStats)
def dashboard(
    faculty: Optional[str] = Query(None),
    op: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    return record_service.get_dashboard_stats(db, faculty=faculty, op=op)


@router.get("", response_model=RecordListOut)
def list_records(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    faculty: Optional[str] = Query(None),
    teacher: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    op: Optional[str] = Query(None),
    group_name: Optional[str] = Query(None),
    academic_year: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(get_current_user_context),
):
    submitted_by = None
    submitted_by_aliases = None
    inspector_review_view = current_user["role"] == ROLE_INSPECTOR
    if current_user["role"] == ROLE_STAFF:
        submitted_by_aliases = _username_aliases(current_user["username"])
        submitted_by = current_user["username"]

    total, items = record_service.get_records(
        db, skip=skip, limit=limit,
        faculty=faculty, teacher=teacher, subject=subject, op=op,
        group_name=group_name, academic_year=academic_year, search=search,
        submitted_by=submitted_by,
        submitted_by_aliases=submitted_by_aliases,
        inspector_review_view=inspector_review_view,
    )
    return RecordListOut(total=total, items=items)


@router.post("", response_model=RecordOut, status_code=201)
def create_record(
    body: RecordCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STAFF)),
):
    try:
        record = record_service.create_record(db, body, submitted_by=current_user["username"])
        audit_event(
            action="record.create",
            outcome="success",
            actor=current_user["username"],
            details={
                "record_id": record.id,
                "teacher": record.teacher,
                "subject": record.subject,
                "group": record.group_name,
                "status": record.status,
            },
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        return record
    except Exception as e:
        audit_event(
            action="record.create",
            outcome="failure",
            actor=current_user["username"],
            details={"error": str(e), "teacher": getattr(body, 'teacher', None)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise


@router.get("/{record_id}", response_model=RecordOut)
def get_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(get_current_user_context),
):
    record = record_service.get_record_by_id(db, record_id)
    if current_user["role"] == ROLE_STAFF and not _is_owner(record.submitted_by, current_user["username"]):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только к своим записям")
    if (
        current_user["role"] == ROLE_INSPECTOR
        and record.status == "draft"
        and not _is_owner(record.submitted_by, current_user["username"])
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inspector cannot access draft records of other users")
    return record


@router.patch("/{record_id}", response_model=RecordOut)
def update_record(
    record_id: int,
    body: RecordUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STAFF)),
):
    try:
        result = record_service.update_record(
            db, record_id, body, 
            updated_by=current_user["username"],
            user_role=current_user["role"]
        )
        audit_event(
            action="record.update",
            outcome="success",
            actor=current_user["username"],
            details={
                "record_id": record_id,
                "teacher": result.teacher,
                "subject": result.subject,
                "status": result.status,
                "changed_fields": list(body.dict(exclude_unset=True).keys()),
            },
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        return result
    except Exception as e:
        audit_event(
            action="record.update",
            outcome="failure",
            actor=current_user["username"],
            details={"record_id": record_id, "error": str(e)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise


@router.delete("/{record_id}", status_code=204)
def delete_record(
    record_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    try:
        record_service.delete_record(db, record_id)
        audit_event(
            action="record.delete",
            outcome="success",
            actor=current_user["username"],
            details={"record_id": record_id},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
    except Exception as e:
        audit_event(
            action="record.delete",
            outcome="failure",
            actor=current_user["username"],
            details={"record_id": record_id, "error": str(e)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise


@router.post("/{record_id}/submit", response_model=RecordOut)
def submit_record(
    record_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_STAFF)),
):
    """Staff submits their record"""
    try:
        record = record_service.get_record_by_id(db, record_id)
        
        # Only owner can submit (if already assigned) or self-submit (if not assigned)
        if record.submitted_by and not _is_owner(record.submitted_by, current_user["username"]):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only submit your own records")
        
        # Only draft or rework records can be submitted
        if record.status not in ["draft", "rework"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only draft or rework records can be submitted")
        
        # Set submitted_by on first submission
        if not record.submitted_by:
            record.submitted_by = current_user["username"]
        
        record.status = "submitted"
        record.submitted_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        
        audit_event(
            action="record.submit",
            outcome="success",
            actor=current_user["username"],
            details={
                "record_id": record_id,
                "teacher": record.teacher,
                "subject": record.subject,
                "status": record.status,
            },
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        return record
    except HTTPException:
        raise
    except Exception as e:
        audit_event(
            action="record.submit",
            outcome="failure",
            actor=current_user["username"],
            details={"record_id": record_id, "error": str(e)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise


@router.post("/{record_id}/send-to-rework", response_model=RecordOut)
def send_to_rework(
    record_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    """Admin/Inspector sends record back to rework"""
    try:
        record = record_service.get_record_by_id(db, record_id)
        
        # Can only send submitted records to rework
        if record.status != "submitted":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only submitted records can be sent to rework")
        
        record.status = "rework"
        record.reviewed_by = current_user["username"]
        record.reviewed_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        
        audit_event(
            action="record.send-to-rework",
            outcome="success",
            actor=current_user["username"],
            details={
                "record_id": record_id,
                "submitted_by": record.submitted_by,
                "teacher": record.teacher,
                "subject": record.subject,
            },
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        return record
    except HTTPException:
        raise
    except Exception as e:
        audit_event(
            action="record.send-to-rework",
            outcome="failure",
            actor=current_user["username"],
            details={"record_id": record_id, "error": str(e)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise


@router.post("/{record_id}/accept", response_model=RecordOut)
def accept_record(
    record_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    """Admin/Inspector accepts record"""
    try:
        record = record_service.get_record_by_id(db, record_id)
        
        # Can only accept submitted or rework records
        if record.status not in ["submitted", "rework"]:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only submitted or rework records can be accepted")
        
        record.status = "accepted"
        record.reviewed_by = current_user["username"]
        record.reviewed_at = datetime.utcnow()
        db.commit()
        db.refresh(record)
        
        audit_event(
            action="record.accept",
            outcome="success",
            actor=current_user["username"],
            details={
                "record_id": record_id,
                "submitted_by": record.submitted_by,
                "teacher": record.teacher,
                "subject": record.subject,
                "status": record.status,
            },
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        return record
    except HTTPException:
        raise
    except Exception as e:
        audit_event(
            action="record.accept",
            outcome="failure",
            actor=current_user["username"],
            details={"record_id": record_id, "error": str(e)},
            db=db,
            ip_address=request.client.host if request.client else None,
        )
        raise
