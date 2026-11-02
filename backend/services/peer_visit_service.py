from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import case, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.peer_visit import PeerVisit
from schemas.peer_visit import LEVEL_CRITERIA, PeerVisitCreate, PeerVisitUpdate
from services.record_service import (
    _compute_attendance,
    _get_user_display_map,
    _is_owner,
    _normalize_login,
)

# Роли, которые видят и правят только свои отзывы
PERSONAL_ROLES = ("staff", "committee", "user", "teacher")

# Код факультета в форме отзыва → FacultyID справочника Platonus (факультет деканата — users.faculty_id)
FACULTY_ID_BY_CODE = {"tf": 1, "eb": 3, "iit": 5}
FACULTY_CODE_BY_ID = {faculty_id: code for code, faculty_id in FACULTY_ID_BY_CODE.items()}

# Уровень критерия → баллы для среднего (шкала 1–5)
LEVEL_POINTS = {"high": 5, "medium": 4, "satisfactory": 3, "low": 2, "fail": 1}
PROBLEM_LEVELS = {"low", "fail"}


def compute_score(ratings: dict) -> float:
    points = [LEVEL_POINTS[ratings[code]] for code in LEVEL_CRITERIA if ratings.get(code) in LEVEL_POINTS]
    if not points:
        return 0.0
    return round(sum(points) / len(points), 2)


def compute_is_problem(syllabus_compliant: bool, ratings: dict) -> bool:
    return (not syllabus_compliant) or any(level in PROBLEM_LEVELS for level in (ratings or {}).values())


def enrich_display_names(db: Session, visits):
    if visits is None:
        return visits
    is_single = not isinstance(visits, list)
    visit_list = [visits] if is_single else visits
    usernames = [u for v in visit_list for u in (v.submitted_by, v.reviewed_by) if u]
    display_map = _get_user_display_map(db, usernames)
    for visit in visit_list:
        visit.submitted_by_display = display_map.get(_normalize_login(visit.submitted_by), visit.submitted_by)
        visit.reviewed_by_display = display_map.get(_normalize_login(visit.reviewed_by), visit.reviewed_by)
    return visit_list[0] if is_single else visit_list


def get_visits(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    status: Optional[str] = None,
    faculty: Optional[str] = None,
    academic_year: Optional[str] = None,
    search: Optional[str] = None,
    submitted_by_aliases: Optional[list[str]] = None,
    inspector_review_view: bool = False,
    dean_faculty_id: Optional[int] = None,
    dean_aliases: Optional[list[str]] = None,
) -> tuple[int, list[PeerVisit]]:
    query = db.query(PeerVisit)

    if dean_faculty_id is not None:
        # Деканат: отзывы своего факультета; черновики — только свои
        query = query.filter(
            PeerVisit.faculty == FACULTY_CODE_BY_ID.get(dean_faculty_id, ""),
            or_(PeerVisit.status != "draft", PeerVisit.submitted_by.in_(dean_aliases or [])),
        )

    if submitted_by_aliases is not None:
        query = query.filter(PeerVisit.submitted_by.in_(submitted_by_aliases))
    if inspector_review_view:
        query = query.filter(PeerVisit.status.in_(["submitted", "accepted"]))
    if status:
        query = query.filter(PeerVisit.status == status)
    if faculty:
        query = query.filter(PeerVisit.faculty == faculty)
    if academic_year:
        query = query.filter(PeerVisit.academic_year == academic_year)
    if search:
        pattern = f"%{search}%"
        matched_users = db.execute(
            text("SELECT username FROM users WHERE display_name LIKE :p"),
            {"p": pattern},
        ).scalars().all()
        conditions = (
            PeerVisit.teacher.ilike(pattern)
            | PeerVisit.visitor_name.ilike(pattern)
            | PeerVisit.subject.ilike(pattern)
            | PeerVisit.department.ilike(pattern)
            | PeerVisit.group_name.ilike(pattern)
            | PeerVisit.submitted_by.ilike(pattern)
        )
        if matched_users:
            conditions = conditions | PeerVisit.submitted_by.in_(matched_users)
        query = query.filter(conditions)

    total = query.count()
    order = [PeerVisit.datetime.desc()]
    if inspector_review_view:
        order.insert(0, case((PeerVisit.status == "accepted", 1), else_=0).asc())
    items = query.order_by(*order).offset(skip).limit(limit).all()
    return total, enrich_display_names(db, items)


def get_visit_by_id(db: Session, visit_id: int, for_update: bool = False) -> PeerVisit:
    query = db.query(PeerVisit).filter(PeerVisit.id == visit_id)
    if for_update:
        # Блокировка строки до commit: смены статуса и правки идут по очереди
        query = query.with_for_update()
    visit = query.first()
    if not visit:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Отзыв не найден")
    return enrich_display_names(db, visit)


def ensure_dean_faculty(visit: PeerVisit, faculty_id: Optional[int], username: Optional[str] = None) -> None:
    """Деканат: отзывы своего факультета; чужие черновики не видны."""
    if visit.faculty != FACULTY_CODE_BY_ID.get(faculty_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только к отзывам своего факультета")
    if visit.status == "draft" and not (username and _is_owner(visit.submitted_by, username)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Черновики других пользователей недоступны")


def ensure_dean_faculty_code(faculty_code: Optional[str], faculty_id: Optional[int]) -> None:
    """Деканат создаёт и правит отзывы только своего факультета."""
    if faculty_code != FACULTY_CODE_BY_ID.get(faculty_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Отзыв можно оформить только по своему факультету")


def ensure_can_read(visit: PeerVisit, username: str, role: str, faculty_id: Optional[int] = None) -> None:
    """Те же правила, что у записей КРК: staff — только свои, инспектор — без чужих черновиков;
    деканат — отзывы своего факультета без черновиков."""
    if role == "dean":
        ensure_dean_faculty(visit, faculty_id, username)
        return
    if role not in ("superadmin", "admin", "peer_inspector", *PERSONAL_ROLES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
    is_owner = _is_owner(visit.submitted_by, username)
    if role in PERSONAL_ROLES and not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только к своим отзывам")
    if role == "peer_inspector" and visit.status == "draft" and not is_owner:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Черновики других пользователей недоступны")


def _check_schedule_row(db: Session, schedule_id: int, username: str, role: str) -> None:
    from models.peer_visit_schedule import PeerVisitSchedule
    from services.notification_service import login_aliases

    row = db.get(PeerVisitSchedule, schedule_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Строка графика не найдена")
    # Сотрудник заполняет отзыв только по своей строке (он — посещающий); админ и инспектор — по любой
    if role in PERSONAL_ROLES and (row.visitor_login or "") not in login_aliases(username):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Это посещение назначено другому преподавателю")
    if db.query(PeerVisit).filter(PeerVisit.schedule_id == schedule_id).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="По этой строке графика отзыв уже создан")
    return row


def create_visit(db: Session, data: PeerVisitCreate, submitted_by: str, role: str = "staff",
                 faculty_id: Optional[int] = None) -> PeerVisit:
    values = data.model_dump()
    if role in ("user", "teacher") and not data.schedule_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Отзыв заполняется по строке своего графика взаимопосещения")
    if data.schedule_id:
        row = _check_schedule_row(db, data.schedule_id, submitted_by, role)
        # Факультет и посещаемый — из графика: по факультету отзыв видит и принимает деканат
        values["faculty"] = FACULTY_CODE_BY_ID.get(row.faculty_id, values["faculty"])
        values["teacher"] = row.visited_name
    if role == "dean":
        ensure_dean_faculty_code(values["faculty"], faculty_id)
    visit = PeerVisit(
        **values,
        status="draft",
        attendance=_compute_attendance(data.students_plan, data.students_fact),
        score=compute_score(data.ratings),
        is_problem=compute_is_problem(data.syllabus_compliant, data.ratings),
        submitted_by=submitted_by,
    )
    db.add(visit)
    try:
        db.commit()
    except IntegrityError:
        # Уникальный индекс peer_visits.schedule_id: параллельный отзыв по той же строке графика
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="По этой строке графика отзыв уже создан")
    db.refresh(visit)
    return enrich_display_names(db, visit)


def update_visit(db: Session, visit_id: int, data: PeerVisitUpdate, username: str, role: str,
                 faculty_id: Optional[int] = None) -> PeerVisit:
    visit = get_visit_by_id(db, visit_id, for_update=True)
    if visit.status == "accepted":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Принятый отзыв нельзя изменить")
    ensure_can_read(visit, username, role, faculty_id)
    if role in PERSONAL_ROLES and visit.status not in ("draft", "rework"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Изменять можно только черновик или отзыв на доработке")

    # Статус через PATCH не меняется: только /submit, /send-to-rework, /accept
    updates = data.model_dump(exclude_unset=True)
    if visit.schedule_id:
        # У отзыва по графику факультет и посещаемый задаются строкой графика
        updates.pop("faculty", None)
        updates.pop("teacher", None)
    if role == "dean" and "faculty" in updates:
        ensure_dean_faculty_code(updates["faculty"], faculty_id)
    # Обязательные поля нельзя очистить через null
    nulls = [field for field, value in updates.items() if value is None and not PeerVisit.__table__.c[field].nullable]
    if nulls:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Обязательные поля: {', '.join(nulls)}")

    # Инвариант проверяется по итоговым значениям: PATCH может прислать одно из полей
    plan = updates.get("students_plan", visit.students_plan)
    fact = updates.get("students_fact", visit.students_fact)
    if fact > plan:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Присутствовало больше, чем обучающихся по списку",
        )

    for field, value in updates.items():
        setattr(visit, field, value)

    visit.attendance = _compute_attendance(visit.students_plan, visit.students_fact)
    visit.score = compute_score(visit.ratings)
    visit.is_problem = compute_is_problem(visit.syllabus_compliant, visit.ratings)

    db.commit()
    db.refresh(visit)
    return enrich_display_names(db, visit)


def delete_visit(db: Session, visit_id: int) -> None:
    visit = get_visit_by_id(db, visit_id, for_update=True)
    if visit.status == "accepted":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Принятый отзыв нельзя удалить")
    db.delete(visit)
    db.commit()


def submit_visit(db: Session, visit_id: int, username: str) -> PeerVisit:
    visit = get_visit_by_id(db, visit_id, for_update=True)
    if visit.submitted_by and not _is_owner(visit.submitted_by, username):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Отправить можно только свой отзыв")
    if visit.status not in ("draft", "rework"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Отправить можно только черновик или отзыв на доработке")
    if not visit.submitted_by:
        visit.submitted_by = username
    visit.status = "submitted"
    visit.submitted_at = datetime.utcnow()
    db.commit()
    db.refresh(visit)
    return enrich_display_names(db, visit)


def review_visit(db: Session, visit_id: int, username: str, new_status: str,
                 dean_faculty_id: Optional[int] = None) -> PeerVisit:
    """Инспектор/админ/деканат: на доработку (из submitted) или принять (из submitted/rework)."""
    allowed_from = {"rework": ("submitted",), "accepted": ("submitted", "rework")}[new_status]
    visit = get_visit_by_id(db, visit_id, for_update=True)
    if dean_faculty_id is not None:
        ensure_dean_faculty(visit, dean_faculty_id)
    if visit.status not in allowed_from:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Действие недоступно для текущего статуса отзыва")
    visit.status = new_status
    visit.reviewed_by = username
    visit.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(visit)
    return enrich_display_names(db, visit)
