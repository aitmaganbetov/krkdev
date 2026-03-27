from fastapi import APIRouter, Depends, Query
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
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STAFF)),
):
    return record_service.create_record(db, body, submitted_by=current_user["username"])


@router.get("/{record_id}", response_model=RecordOut)
def get_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(get_current_user_context),
):
    record = record_service.get_record_by_id(db, record_id)
    if current_user["role"] == ROLE_STAFF and not _is_owner(record.submitted_by, current_user["username"]):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только к своим записям")
    if (
        current_user["role"] == ROLE_INSPECTOR
        and record.status == "draft"
        and not _is_owner(record.submitted_by, current_user["username"])
    ):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inspector cannot access draft records of other users")
    return record


@router.patch("/{record_id}", response_model=RecordOut)
def update_record(
    record_id: int,
    body: RecordUpdate,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STAFF)),
):
    return record_service.update_record(
        db, record_id, body, 
        updated_by=current_user["username"],
        user_role=current_user["role"]
    )


@router.delete("/{record_id}", status_code=204)
def delete_record(
    record_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    record_service.delete_record(db, record_id)


@router.post("/{record_id}/submit", response_model=RecordOut)
def submit_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_STAFF)),
):
    """Staff submits their record"""
    from datetime import datetime
    record = record_service.get_record_by_id(db, record_id)
    
    # Only owner can submit (if already assigned) or self-submit (if not assigned)
    if record.submitted_by and not _is_owner(record.submitted_by, current_user["username"]):
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only submit your own records")
    
    # Only draft or rework records can be submitted
    if record.status not in ["draft", "rework"]:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only draft or rework records can be submitted")
    
    # Set submitted_by on first submission
    if not record.submitted_by:
        record.submitted_by = current_user["username"]
    
    record.status = "submitted"
    record.submitted_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return record


@router.post("/{record_id}/send-to-rework", response_model=RecordOut)
def send_to_rework(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    """Admin/Inspector sends record back to rework"""
    from datetime import datetime
    record = record_service.get_record_by_id(db, record_id)
    
    # Can only send submitted records to rework
    if record.status != "submitted":
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only submitted records can be sent to rework")
    
    record.status = "rework"
    record.reviewed_by = current_user["username"]
    record.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return record


@router.post("/{record_id}/accept", response_model=RecordOut)
def accept_record(
    record_id: int,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    """Admin/Inspector accepts record"""
    from datetime import datetime
    record = record_service.get_record_by_id(db, record_id)
    
    # Can only accept submitted or rework records
    if record.status not in ["submitted", "rework"]:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only submitted or rework records can be accepted")
    
    record.status = "accepted"
    record.reviewed_by = current_user["username"]
    record.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(record)
    return record
