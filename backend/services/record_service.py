from sqlalchemy.orm import Session
from sqlalchemy import text
from sqlalchemy import case, func
from models.record import Record
from schemas.record import RecordCreate, RecordUpdate, DashboardStats
from fastapi import HTTPException, status
from typing import Optional
from datetime import datetime


def _compute_score(ratings: dict) -> float:
    if not ratings:
        return 0.0
    return round(sum(ratings.values()) / len(ratings), 2)


def _compute_attendance(students_plan: int, students_fact: int) -> float:
    if students_plan == 0:
        return 0.0
    return round((students_fact / students_plan) * 100, 1)


def _username_aliases(username: Optional[str]) -> list[str]:
    raw = (username or "").strip().lower()
    if not raw:
        return []

    aliases = {raw}
    if "\\" in raw:
        aliases.add(raw.split("\\", 1)[1])
    if "@" in raw:
        aliases.add(raw.split("@", 1)[0])
    return list(aliases)


def _is_owner(submitted_by: Optional[str], username: Optional[str]) -> bool:
    owner = (submitted_by or "").strip().lower()
    if not owner:
        return False
    return owner in _username_aliases(username)


def _normalize_login(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def _get_user_display_map(db: Session, usernames: list[str]) -> dict[str, str]:
    normalized = [name for name in {_normalize_login(username) for username in usernames if _normalize_login(username)}]
    if not normalized:
        return {}

    placeholders = ", ".join([f":u{i}" for i in range(len(normalized))])
    params = {f"u{i}": username for i, username in enumerate(normalized)}
    rows = db.execute(
        text(
            f"SELECT LOWER(username) AS username, COALESCE(NULLIF(TRIM(display_name), ''), username) AS display_name FROM users WHERE LOWER(username) IN ({placeholders})"
        ),
        params,
    ).mappings().all()
    return {row["username"]: row["display_name"] for row in rows}


def enrich_record_display_names(db: Session, records):
    if records is None:
        return records

    is_single = not isinstance(records, list)
    record_list = [records] if is_single else records
    usernames: list[str] = []
    for record in record_list:
        if getattr(record, "submitted_by", None):
            usernames.append(record.submitted_by)
        if getattr(record, "reviewed_by", None):
            usernames.append(record.reviewed_by)

    display_map = _get_user_display_map(db, usernames)
    for record in record_list:
        submitted_by = _normalize_login(getattr(record, "submitted_by", None))
        reviewed_by = _normalize_login(getattr(record, "reviewed_by", None))
        setattr(record, "submitted_by_display", display_map.get(submitted_by, getattr(record, "submitted_by", None)))
        setattr(record, "reviewed_by_display", display_map.get(reviewed_by, getattr(record, "reviewed_by", None)))

    return record_list[0] if is_single else record_list


def get_records(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    faculty: Optional[str] = None,
    teacher: Optional[str] = None,
    subject: Optional[str] = None,
    op: Optional[str] = None,
    group_name: Optional[str] = None,
    academic_year: Optional[str] = None,
    search: Optional[str] = None,
    submitted_by: Optional[str] = None,
    submitted_by_aliases: Optional[list[str]] = None,
    inspector_review_view: bool = False,
) -> tuple[int, list[Record]]:
    query = db.query(Record)

    if submitted_by_aliases:
        query = query.filter(Record.submitted_by.in_(submitted_by_aliases))
    elif submitted_by:
        query = query.filter(Record.submitted_by == submitted_by)

    if inspector_review_view:
        query = query.filter(Record.status.in_(["submitted", "accepted"]))

    if faculty:
        query = query.filter(Record.faculty == faculty)
    if teacher:
        query = query.filter(Record.teacher.ilike(f"%{teacher}%"))
    if subject:
        query = query.filter(Record.subject.ilike(f"%{subject}%"))
    if op:
        query = query.filter(Record.op.ilike(f"%{op}%"))
    if group_name:
        query = query.filter(Record.group_name.ilike(f"%{group_name}%"))
    if academic_year:
        query = query.filter(Record.academic_year == academic_year)
    if search:
        pattern = f"%{search}%"
        # Subquery: find logins whose display_name matches
        matched_users = db.execute(
            text("SELECT username FROM users WHERE display_name LIKE :p"),
            {"p": pattern},
        ).scalars().all()
        conditions = (
            Record.teacher.ilike(pattern)
            | Record.subject.ilike(pattern)
            | Record.group_name.ilike(pattern)
            | Record.op.ilike(pattern)
            | Record.submitted_by.ilike(pattern)
        )
        if matched_users:
            conditions = conditions | Record.submitted_by.in_(matched_users)
        query = query.filter(conditions)

    total = query.count()
    if inspector_review_view:
        accepted_last = case((Record.status == "accepted", 1), else_=0)
        items = query.order_by(accepted_last.asc(), Record.datetime.desc()).offset(skip).limit(limit).all()
    else:
        items = query.order_by(Record.datetime.desc()).offset(skip).limit(limit).all()
    items = enrich_record_display_names(db, items)
    return total, items


def get_record_by_id(db: Session, record_id: int) -> Record:
    record = db.query(Record).filter(Record.id == record_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Record not found")
    return enrich_record_display_names(db, record)


def create_record(db: Session, data: RecordCreate, submitted_by: str) -> Record:
    score = _compute_score(data.ratings)
    attendance = _compute_attendance(data.students_plan, data.students_fact)

    record = Record(
        **data.model_dump(),
        score=score,
        attendance=attendance,
        submitted_by=submitted_by,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return enrich_record_display_names(db, record)


def update_record(
    db: Session,
    record_id: int,
    data: RecordUpdate,
    updated_by: Optional[str] = None,
    user_role: Optional[str] = None,
) -> Record:
    record = get_record_by_id(db, record_id)
    
    # Cannot edit accepted records (for anyone)
    if record.status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot edit accepted records"
        )
    
    # Access control: Staff can only edit their own draft/rework records
    if user_role and user_role.lower() == "staff":
        if not _is_owner(record.submitted_by, updated_by):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Staff can only edit their own records"
            )
        if record.status not in ["draft", "rework"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Staff can only edit draft or rework records"
            )
    
    # Admin and Inspector can change status and edit records
    # Extract status change separately to track review
    updates = data.model_dump(exclude_unset=True)
    status_change = updates.pop("status", None) if "status" in updates else None
    
    # Update regular fields
    for field, value in updates.items():
        setattr(record, field, value)

    # Recompute derived fields if inputs changed
    if "ratings" in updates:
        record.score = _compute_score(record.ratings)
    if "students_plan" in updates or "students_fact" in updates:
        record.attendance = _compute_attendance(record.students_plan, record.students_fact)

    # Handle status transitions
    if status_change:
        # Only admin/inspector can change status
        if user_role and user_role.lower() == "staff":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Staff cannot change record status"
            )
        
        record.status = status_change
        record.reviewed_by = updated_by
        record.reviewed_at = datetime.utcnow()
        
        # First time transition from draft to submitted
        if record.status == "submitted" and not record.submitted_at:
            record.submitted_at = datetime.utcnow()
            if not record.submitted_by:
                record.submitted_by = updated_by

    # For draft records being edited by staff, set submitted_by
    if updated_by and record.status == "draft":
        if not record.submitted_by:
            record.submitted_by = updated_by

    db.commit()
    db.refresh(record)
    return enrich_record_display_names(db, record)


def delete_record(db: Session, record_id: int) -> None:
    record = get_record_by_id(db, record_id)
    
    # Cannot delete accepted records
    if record.status == "accepted":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot delete accepted records"
        )
    
    db.delete(record)
    db.commit()


def get_dashboard_stats(
    db: Session,
    faculty: Optional[str] = None,
    op: Optional[str] = None,
) -> DashboardStats:
    base = db.query(Record)
    if faculty:
        base = base.filter(Record.faculty == faculty)
    if op:
        base = base.filter(Record.op == op)

    total = base.with_entities(func.count(Record.id)).scalar() or 0
    avg_score = base.with_entities(func.avg(Record.score)).scalar() or 0.0
    avg_attendance = base.with_entities(func.avg(Record.attendance)).scalar() or 0.0
    problem_records = base.filter(Record.score < 5).with_entities(func.count(Record.id)).scalar() or 0

    return DashboardStats(
        total_records=total,
        avg_score=round(float(avg_score), 2),
        avg_attendance=round(float(avg_attendance), 1),
        problem_records=problem_records,
    )


def get_dashboard_stats_for_user(db: Session, submitted_by: str) -> DashboardStats:
    scoped = db.query(Record).filter(Record.submitted_by == submitted_by)
    total = scoped.with_entities(func.count(Record.id)).scalar() or 0
    avg_score = scoped.with_entities(func.avg(Record.score)).scalar() or 0.0
    avg_attendance = scoped.with_entities(func.avg(Record.attendance)).scalar() or 0.0
    problem_records = scoped.filter(Record.score < 5).with_entities(func.count(Record.id)).scalar() or 0

    return DashboardStats(
        total_records=total,
        avg_score=round(float(avg_score), 2),
        avg_attendance=round(float(avg_attendance), 1),
        problem_records=problem_records,
    )


def get_record_filter_options(db: Session) -> dict:
    rows = db.query(Record.faculty, Record.op).filter(Record.faculty.isnot(None), Record.op.isnot(None)).all()

    by_faculty: dict[str, set[str]] = {}
    for faculty, op in rows:
        faculty_name = (faculty or '').strip()
        op_name = (op or '').strip()
        if not faculty_name or not op_name:
            continue
        if faculty_name not in by_faculty:
            by_faculty[faculty_name] = set()
        by_faculty[faculty_name].add(op_name)

    faculties = [
        {
            'name': faculty,
            'ops': sorted(list(ops)),
        }
        for faculty, ops in sorted(by_faculty.items(), key=lambda item: item[0].lower())
    ]

    all_ops = sorted({op for ops in by_faculty.values() for op in ops}, key=lambda value: value.lower())
    return {
        'faculties': faculties,
        'ops': all_ops,
    }


def get_faculty_comparison(
    db: Session,
    faculty: Optional[str] = None,
    op: Optional[str] = None,
) -> list[dict]:
    # Comparison level:
    # - no filters: by faculty
    # - faculty selected: by OP
    # - OP selected: by group
    if op:
        label_column = Record.group_name.label("label")
        query = db.query(
            label_column,
            func.count(Record.id).label("total_records"),
            func.avg(Record.score).label("avg_score"),
            func.avg(Record.attendance).label("avg_attendance"),
            func.sum(case((Record.score < 5, 1), else_=0)).label("problem_records"),
        ).filter(Record.group_name.isnot(None), Record.group_name != "", Record.op == op)
        if faculty:
            query = query.filter(Record.faculty == faculty)
        rows = query.group_by(Record.group_name).all()
    elif faculty:
        label_column = Record.op.label("label")
        query = db.query(
            label_column,
            func.count(Record.id).label("total_records"),
            func.avg(Record.score).label("avg_score"),
            func.avg(Record.attendance).label("avg_attendance"),
            func.sum(case((Record.score < 5, 1), else_=0)).label("problem_records"),
        ).filter(Record.op.isnot(None), Record.op != "", Record.faculty == faculty)
        rows = query.group_by(Record.op).all()
    else:
        label_column = Record.faculty.label("label")
        query = db.query(
            label_column,
            func.count(Record.id).label("total_records"),
            func.avg(Record.score).label("avg_score"),
            func.avg(Record.attendance).label("avg_attendance"),
            func.sum(case((Record.score < 5, 1), else_=0)).label("problem_records"),
        ).filter(Record.faculty.isnot(None), Record.faculty != "")
        rows = query.group_by(Record.faculty).all()

    result = []
    for row in rows:
        result.append({
            "label": row.label,
            "total_records": int(row.total_records or 0),
            "avg_score": round(float(row.avg_score or 0.0), 2),
            "avg_attendance": round(float(row.avg_attendance or 0.0), 1),
            "problem_records": int(row.problem_records or 0),
        })

    return sorted(result, key=lambda item: (item["label"] or "").lower())
