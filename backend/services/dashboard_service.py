"""Сводная статистика для дашбордов модулей «Взаимопосещение» и «Ситуационный мониторинг».

Дашборд записей КРК считается в record_service (get_dashboard_stats, get_faculty_comparison).
"""
from collections import Counter
from datetime import date
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session, load_only

from models.peer_visit import PeerVisit
from services import peer_visit_schedule_service as schedule_service
from services.peer_visit_service import FACULTY_CODE_BY_ID, FACULTY_ID_BY_CODE

# Итоговый уровень по среднему баллу 1–5 — те же пороги, что overallLevel в frontend/src/utils/peerVisit.js
LEVEL_THRESHOLDS = (("high", 4.5), ("medium", 3.5), ("satisfactory", 2.5), ("low", 1.5))
LEVELS = ("high", "medium", "satisfactory", "low", "fail")


def overall_level(score: float) -> Optional[str]:
    if not score:
        return None
    for level, threshold in LEVEL_THRESHOLDS:
        if score >= threshold:
            return level
    return "fail"


def academic_year_range(academic_year: Optional[str]) -> Optional[tuple[date, date]]:
    """«2026-2027» → [01.09.2026, 01.09.2027); пустой или нераспознанный год — без ограничения."""
    try:
        start = int((academic_year or "").split("-")[0])
    except ValueError:
        return None
    return date(start, 9, 1), date(start + 1, 9, 1)


def _faculty_names(db: Session) -> dict[int, str]:
    return {row[0]: row[1] for row in db.execute(text("SELECT FacultyID, facultyNameRU FROM faculties")).all()}


def _schedule_totals(items: list[dict]) -> Optional[dict]:
    """Итог выполнения графика по набору строк (summary без разбивки по кафедрам)."""
    totals = schedule_service.summary([{**item, "faculty_id": 0, "cafedra_id": None, "cafedra_name": ""} for item in items])
    return totals[0] if totals else None


def _average(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def peer_visits_dashboard(db: Session, academic_year: Optional[str] = None, faculty_code: Optional[str] = None) -> dict:
    """Отзывы (без черновиков — они видны только автору) и выполнение графика взаимопосещения."""
    # Для счётчиков нужны четыре поля, а не тексты отзывов
    query = (db.query(PeerVisit)
             .options(load_only(PeerVisit.status, PeerVisit.score, PeerVisit.faculty, PeerVisit.is_problem))
             .filter(PeerVisit.status != "draft"))
    if academic_year:
        query = query.filter(PeerVisit.academic_year == academic_year)
    if faculty_code:
        query = query.filter(PeerVisit.faculty == faculty_code)
    visits = query.all()

    statuses = Counter(visit.status for visit in visits)
    levels = Counter(overall_level(visit.score) for visit in visits if visit.score)

    reviews_by_faculty: dict[str, list[PeerVisit]] = {}
    for visit in visits:
        reviews_by_faculty.setdefault(visit.faculty, []).append(visit)

    # Выполнение графика: строки за год (и факультет), статус строки считается по отзывам
    faculty_id = FACULTY_ID_BY_CODE.get(faculty_code) if faculty_code else None
    schedule_items = schedule_service.list_rows(db, academic_year=academic_year, faculty_id=faculty_id)
    schedule_by_faculty: dict[Optional[str], list[dict]] = {}
    for item in schedule_items:
        schedule_by_faculty.setdefault(FACULTY_CODE_BY_ID.get(item["faculty_id"]), []).append(item)

    names = _faculty_names(db)
    faculties = []
    for code in sorted((set(reviews_by_faculty) | set(schedule_by_faculty)) - {None}):
        group = reviews_by_faculty.get(code, [])
        schedule = _schedule_totals(schedule_by_faculty.get(code, []))
        faculties.append({
            "faculty": code,
            "faculty_name": names.get(FACULTY_ID_BY_CODE.get(code), code),
            "total": len(group),
            "accepted": sum(1 for visit in group if visit.status == "accepted"),
            "problems": sum(1 for visit in group if visit.is_problem),
            "avg_score": _average([visit.score for visit in group if visit.score]),
            "schedule_total": schedule["total"] if schedule else 0,
            "schedule_percent": schedule["percent"] if schedule else None,
            "schedule_overdue": schedule["overdue"] if schedule else 0,
        })

    return {
        "total": len(visits),
        "statuses": {status: statuses.get(status, 0) for status in ("submitted", "rework", "accepted")},
        "problems": sum(1 for visit in visits if visit.is_problem),
        "avg_score": _average([visit.score for visit in visits if visit.score]),
        "levels": {level: levels.get(level, 0) for level in LEVELS},
        "schedule": _schedule_totals(schedule_items),
        "faculties": faculties,
    }


def violations_dashboard(db: Session, academic_year: Optional[str] = None, faculty_id: Optional[int] = None) -> dict:
    """Нарушения ситуационного мониторинга. Факультет — по преподавателю: violations.teacher_login →
    tutors.login → cafedras.FacultyID, для старых нарушений — по ФИО; не найден — «не определён»."""
    where, params = "", {}
    period = academic_year_range(academic_year)
    if period:
        where = "WHERE v.violation_date >= :start AND v.violation_date < :end"
        params = {"start": period[0], "end": period[1]}
    rows = db.execute(text(f"""
        SELECT v.id, v.teacher, v.teacher_login, v.violation_type, v.violation_date, v.status,
               c.FacultyID AS faculty_id,
               (SELECT COUNT(*) FROM violation_evidence e WHERE e.violation_id = v.id) AS evidence_count
        FROM violations v
        -- таблицы созданы с разной collation (справочник Platonus — utf8mb4_unicode_ci)
        LEFT JOIN tutors t ON t.login = v.teacher_login COLLATE utf8mb4_unicode_ci
        LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        {where}
    """), params).mappings().all()

    names = _faculty_names(db)
    # Нарушения, зафиксированные до появления teacher_login, — по ФИО через справочник Platonus
    matcher = None
    rows = [dict(row) for row in rows]
    for row in rows:
        if row["faculty_id"] is None and row["teacher"]:
            matcher = matcher or schedule_service.TutorMatcher(db)
            tutor = matcher.match(row["teacher"])
            row["faculty_id"] = tutor["faculty_id"] if tutor else None
    if faculty_id is not None:
        # Деканат — только нарушения преподавателей своего факультета
        rows = [row for row in rows if row["faculty_id"] == faculty_id]
    # Наблюдения по чек-листу 16-02 сохраняются и без замечаний. Виды расхождений — по наблюдениям, где они
    # есть (кроме «соответствует», технического сбоя — п. 4.7 — и снятых по пояснению или отклонённых);
    # преподаватели — только по подписанным ЭЦП нарушениям
    with_deviation = [row for row in rows if row["status"] not in ("compliant", "technical", "rejected", "justified")]
    confirmed = [row for row in rows if row["status"] == "confirmed"]
    by_type = Counter(row["violation_type"] for row in with_deviation)
    by_month = Counter(row["violation_date"].strftime("%Y-%m") for row in rows if row["violation_date"])
    by_faculty = Counter(row["faculty_id"] for row in rows)
    teachers = Counter(row["teacher"] for row in confirmed)
    return {
        "total": len(rows),
        "statuses": dict(Counter(row["status"] for row in rows)),
        # Уведомление уходит только при подтверждении — доля считается от подтверждённых
        "notified": sum(1 for row in confirmed if row["teacher_login"]),
        "with_evidence": sum(1 for row in rows if row["evidence_count"]),
        "by_type": [{"type": key, "count": count} for key, count in by_type.most_common()],
        "by_month": [{"month": key, "count": by_month[key]} for key in sorted(by_month)],
        "by_faculty": [
            {"faculty_id": key, "faculty_name": names.get(key) if key else None, "count": count}
            for key, count in by_faculty.most_common()
        ],
        "top_teachers": [{"teacher": key, "count": count} for key, count in teachers.most_common(10)],
    }
