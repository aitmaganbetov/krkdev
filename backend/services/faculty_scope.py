"""Деканат: права администратора в рабочей области и на дашборде, но только по своему факультету
(users.faculty_id → faculties.FacultyID).

Факультет данных:
- запись КРК — records.faculty (название факультета группы, как в форме записи);
- отзыв о взаимопосещении — peer_visits.faculty (код, peer_visit_service.FACULTY_CODE_BY_ID);
- нарушение — факультет преподавателя (violations.faculty_id: логин → tutors → кафедра, иначе по ФИО);
- занятие расписания — факультет группы или кафедры преподавателя.
"""
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from services.auth_service import ROLE_DEAN


def dean_faculty_id(context: dict) -> Optional[int]:
    """FacultyID деканата или None для остальных ролей (у деканата без факультета роль — user)."""
    return context.get("faculty_id") if context.get("role") == ROLE_DEAN else None


def faculty_name(db: Session, faculty_id: int) -> str:
    name = db.execute(
        text("SELECT facultyNameRU FROM faculties WHERE FacultyID = :id LIMIT 1"), {"id": faculty_id},
    ).scalar()
    return (name or "").strip()


def dean_faculty_name(db: Session, context: dict) -> Optional[str]:
    """Название факультета деканата (как records.faculty) или None для остальных ролей."""
    faculty_id = dean_faculty_id(context)
    if faculty_id is None:
        return None
    name = faculty_name(db, faculty_id)
    if not name:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Факультет деканата не найден в справочнике")
    return name


def forbid_other_faculty(detail: str = "Доступ только к данным своего факультета") -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def backfill_violation_faculties(db: Session) -> int:
    """Стартовая миграция: факультет преподавателя у нарушений, где он ещё не определён."""
    from models.violation import Violation

    from services.peer_visit_schedule_service import TutorMatcher

    filled, matcher = 0, None
    for violation in db.query(Violation).filter(Violation.faculty_id.is_(None)).all():
        matcher = matcher or TutorMatcher(db)
        faculty_id = teacher_faculty_id(db, violation.teacher_login, violation.teacher, matcher)
        if faculty_id is not None:
            violation.faculty_id = faculty_id
            filled += 1
    db.commit()
    return filled


def teacher_faculty_id(db: Session, teacher_login: Optional[str], teacher_name: Optional[str], matcher=None) -> Optional[int]:
    """Факультет преподавателя по кафедре из справочника Platonus: по логину, иначе по ФИО."""
    login = (teacher_login or "").strip().lower()
    if login:
        faculty_id = db.execute(text("""
            SELECT c.FacultyID FROM tutors t JOIN cafedras c ON c.cafedraID = t.cafedra_id
            WHERE t.login = :login LIMIT 1
        """), {"login": login}).scalar()
        if faculty_id is not None:
            return int(faculty_id)
    if teacher_name:
        # TutorMatcher: полное ФИО → фамилия+имя → фамилия+инициалы (как дашборд нарушений)
        from services.peer_visit_schedule_service import TutorMatcher

        tutor = (matcher or TutorMatcher(db)).match(teacher_name)
        if tutor and tutor.get("faculty_id") is not None:
            return int(tutor["faculty_id"])
    return None
