"""Личный дашборд («Мои показатели»): только данные, которые касаются самого пользователя.

Разделы зависят от роли и от того, есть ли у пользователя такие данные:
records — мои проверки КРК (сотрудник, член комитета); plan — мой план взаимопосещений (строки графика, где я
посещающий); reviews — мои отзывы о взаимопосещении; violations — нарушения на моих занятиях;
signing — документы на подпись; committee — мой комитет; assignments — кого я проверяю по распределению
комитета; attendance — моя посещаемость (студент).
"""
from collections import Counter
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models.attendance import LessonAttendance, PlatonusStudent
from models.peer_visit import PeerVisit
from models.record import Record
from models.violation import Violation
from services import committee_service
from services.committee_assignments import my_assignments
from services import schedule_approval_service as approvals
from services.auth_service import RECORD_AUTHOR_ROLES, ROLE_COMMITTEE, ROLE_STUDENT
from services.dashboard_service import academic_year_range
from services.notification_service import login_aliases
from services.peer_visit_schedule_service import my_rows

RECORD_STATUSES = ("draft", "submitted", "rework", "accepted")


def _statuses(rows) -> dict:
    counts = Counter(status for (status,) in rows)
    return {status: counts.get(status, 0) for status in RECORD_STATUSES}


def personal_dashboard(db: Session, username: str, role: str, academic_year: Optional[str]) -> dict:
    aliases = sorted(set(login_aliases(username)) | {username})
    period = academic_year_range(academic_year)
    result: dict = {}

    if role == ROLE_STUDENT:
        student = db.query(PlatonusStudent).filter(PlatonusStudent.login.in_(aliases)).first()
        if student:
            marks = db.query(LessonAttendance).filter(LessonAttendance.student_id == student.student_id, LessonAttendance.removed_at.is_(None))
            if period:
                marks = marks.filter(LessonAttendance.lesson_date.between(*period))
            last = marks.with_entities(func.max(LessonAttendance.lesson_date)).scalar()
            result["attendance"] = {
                "marks": marks.count(),
                "days": marks.with_entities(func.count(func.distinct(LessonAttendance.lesson_date))).scalar() or 0,
                "last": last.isoformat() if last else None,
                "group": student.group_name,
            }
        return result

    if role in RECORD_AUTHOR_ROLES:
        records = db.query(Record).filter(Record.submitted_by.in_(aliases))
        if academic_year:
            records = records.filter(Record.academic_year == academic_year)
        accepted = records.filter(Record.status == "accepted")
        result["records"] = {
            "statuses": _statuses(records.with_entities(Record.status).all()),
            "avg_score": round(float(accepted.with_entities(func.avg(Record.score)).scalar() or 0), 2),
            "problem": accepted.filter(Record.is_problem.is_(True)).count(),
        }

    plan = [row for row in my_rows(db, username) if not academic_year or row["academic_year"] == academic_year]
    if plan:
        counts = Counter(row["status"] for row in plan)
        upcoming = [row for row in plan if row["status"] in ("planned", "overdue")][:5]
        result["plan"] = {
            "total": len(plan),
            "statuses": {status: counts.get(status, 0) for status in ("done", "in_progress", "overdue", "planned")},
            "upcoming": [{"id": row["id"], "month": row["month"], "visited_name": row["visited_name"], "status": row["status"]} for row in upcoming],
        }

    reviews = db.query(PeerVisit.status).filter(PeerVisit.submitted_by.in_(aliases))
    if academic_year:
        reviews = reviews.filter(PeerVisit.academic_year == academic_year)
    reviews = reviews.all()
    if reviews:
        result["reviews"] = {"statuses": _statuses(reviews)}

    # Преподавателю — только подтверждённые несоответствия (как GET /violations/my, п. 4.5)
    violations = db.query(Violation.status).filter(Violation.teacher_login.in_(aliases), Violation.status == "confirmed")
    if period:
        violations = violations.filter(Violation.violation_date.between(*period))
    violations = violations.all()
    if violations:
        result["violations"] = {"total": len(violations), "statuses": dict(Counter(status for (status,) in violations))}

    pending = len(committee_service.pending_for(db, username)) + len(approvals.pending_for(db, username))
    if pending:
        result["signing"] = {"pending": pending}

    if role == ROLE_COMMITTEE:
        active = next((order for order in committee_service.list_orders(db) if order["is_active"]), None)
        if active:
            result["committee"] = {"number": active["number"], "academic_year": active["academic_year"]}
        assignments = my_assignments(db, username, academic_year)
        if assignments:
            result["assignments"] = assignments
    return result
