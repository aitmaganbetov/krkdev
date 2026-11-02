"""QR-код аудитории (/room/<код>).

Сотрудник видит занятия аудитории сегодня (пара, преподаватель, группы, число студентов и отметившихся),
камеру — по правам своей роли, оснащение (цены — только суперадминистратору).
Студент отмечает посещаемость: только во время своего занятия в этой аудитории (за EARLY_MINUTES до начала
и до конца пары), только если он в составе потока, один раз. Сохраняются время, IP и устройство;
преподаватель занятия, администратор, инспектор и деканат факультета видят список и могут снять отметку.
"""
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models.attendance import LessonAttendance, PlatonusStudent, ScheduleGroupStudent
from models.room import Room
from models.room_inventory import RoomInventoryItem
from models.schedule_lesson import ScheduleLesson
from services import ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STUDENT, ROLE_SUPERADMIN, get_current_user_context
from services import schedule_service
from services.audit_log import audit_event
from services.faculty_scope import dean_faculty_id
from services.notification_service import login_aliases
from services.request_meta import get_client_ip

router = APIRouter(prefix="/scan", tags=["room-scan"])

# Отметка открывается за 10 минут до начала пары и закрывается с её окончанием
EARLY_MINUTES = 10
ATTENDANCE_VIEW_ROLES = (ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_INSPECTOR)
CAMERA_ROLES = (ROLE_SUPERADMIN, ROLE_ADMIN)


def _room_by_code(db: Session, code: str) -> Room:
    room = db.query(Room).filter(Room.qr_code == (code or "").strip()).first()
    if not room:
        raise HTTPException(status_code=404, detail="Аудитория по этому QR-коду не найдена")
    return room


def _minutes(hhmm: str) -> int:
    hours, minutes = hhmm.split(":")
    return int(hours) * 60 + int(minutes)


def _room_lessons_today(db: Session, room: Room) -> tuple[datetime, list[dict]]:
    now = schedule_service.now_local()
    clock = now.hour * 60 + now.minute
    lessons = []
    # Только занятия этой аудитории: у кабинета без привязки к Platonus занятий по расписанию нет
    day_lessons = schedule_service.lessons_for_date(db, now.date(), auditory_id=room.platonus_auditory_id)["lessons"] \
        if room.platonus_auditory_id else []
    for lesson in day_lessons:
        if lesson["room_id"] != room.id:
            continue
        start, end = _minutes(lesson["start_time"]), _minutes(lesson["end_time"])
        status = "finished" if clock >= end else ("now" if clock >= start else "upcoming")
        lessons.append({**lesson, "status": status, "attendance_open": start - EARLY_MINUTES <= clock < end})
    return now, lessons


STATUS_ORDER = {"now": 0, "upcoming": 1, "finished": 2}


def _class_key(lesson: dict) -> tuple:
    return (lesson["start_time"], lesson["end_time"], lesson["subject"], lesson.get("lesson_type") or "",
            (lesson.get("teacher_login") or "").lower())


def _merged(lessons: list[dict]) -> list[dict]:
    """Одна пара у одного преподавателя в аудитории приходит из Platonus несколькими занятиями: по занятию на
    каждую группу и на каждый учебный поток группы (Platonus делит её по РУП, году поступления). На странице QR
    это одно занятие (lesson_ids — все его части, группы через запятую).
    Сначала идущая пара, затем предстоящие, в конце завершённые."""
    merged: dict[tuple, dict] = {}
    for lesson in lessons:
        item = merged.get(_class_key(lesson))
        if item:
            item["lesson_ids"].append(lesson["lesson_id"])
            item["students_count"] = (item["students_count"] or 0) + (lesson["students_count"] or 0)
            groups = [group for group in (item.get("student_groups") or "").split(", ") if group]
            if lesson.get("student_groups") and lesson["student_groups"] not in groups:
                item["student_groups"] = ", ".join(groups + [lesson["student_groups"]])
        else:
            merged[_class_key(lesson)] = {**lesson, "lesson_ids": [lesson["lesson_id"]]}
    return sorted(merged.values(), key=lambda item: (STATUS_ORDER[item["status"]], _minutes(item["start_time"])))


def _class_lesson_ids(db: Session, lesson: dict, day: date) -> list[int]:
    """Все части занятия (см. _merged) в той же аудитории на дату."""
    room = db.get(Room, lesson["room_id"]) if lesson.get("room_id") else None
    if not room or not room.platonus_auditory_id:
        return [lesson["lesson_id"]]
    key = _class_key(lesson)
    day_lessons = schedule_service.lessons_for_date(db, day, auditory_id=room.platonus_auditory_id)["lessons"]
    return [item["lesson_id"] for item in day_lessons if item["room_id"] == room.id and _class_key(item) == key] \
        or [lesson["lesson_id"]]


def _student(db: Session, username: str) -> Optional[PlatonusStudent]:
    aliases = {alias.lower() for alias in login_aliases(username)}
    if not aliases:
        return None
    return db.query(PlatonusStudent).filter(PlatonusStudent.login.in_(aliases)).first()


def _can_view_attendance(context: dict, lesson: dict) -> bool:
    role = context.get("role")
    if role in ATTENDANCE_VIEW_ROLES:
        return True
    faculty_id = dean_faculty_id(context)
    if faculty_id is not None and schedule_service.lesson_in_faculty(lesson, faculty_id):
        return True
    teacher_login = (lesson.get("teacher_login") or "").strip().lower()
    return bool(teacher_login) and teacher_login in {alias.lower() for alias in login_aliases(context.get("username") or "")}


def _lesson_for_date(db: Session, lesson_id: int, day: date) -> dict:
    lessons = schedule_service.lessons_for_date(db, day, lesson_id=lesson_id)["lessons"]
    lesson = next((item for item in lessons if item["lesson_id"] == lesson_id), None)
    if not lesson:
        raise HTTPException(status_code=404, detail="Занятие на эту дату не найдено в расписании")
    return lesson


def _marked_counts(db: Session, lesson_ids: list[int], day: date) -> dict[int, int]:
    if not lesson_ids:
        return {}
    rows = (
        db.query(LessonAttendance.lesson_id)
        .filter(LessonAttendance.lesson_id.in_(lesson_ids), LessonAttendance.lesson_date == day, LessonAttendance.removed_at.is_(None))
        .all()
    )
    counts: dict[int, int] = {}
    for (lesson_id,) in rows:
        counts[lesson_id] = counts.get(lesson_id, 0) + 1
    return counts


@router.get("/{code}")
def scan_room(code: str, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    room = _room_by_code(db, code)
    now, raw_lessons = _room_lessons_today(db, room)
    lessons = _merged(raw_lessons)
    room_info = {"name": room.name, "building": room.building or "", "floor": room.floor or ""}

    if context.get("role") == ROLE_STUDENT:
        student = _student(db, context.get("username") or "")
        marked = set()
        if student:
            marked = {
                lesson_id for (lesson_id,) in db.query(LessonAttendance.lesson_id).filter(
                    LessonAttendance.student_id == student.student_id,
                    LessonAttendance.lesson_date == now.date(),
                    LessonAttendance.removed_at.is_(None),
                ).all()
            }
        return {
            "mode": "student",
            "room": room_info,
            "now": now.strftime("%Y-%m-%dT%H:%M:%S"),
            "lessons": [
                {key: lesson[key] for key in ("lesson_id", "subject", "subject_kz", "lesson_type", "teacher", "start_time", "end_time", "pair_number", "status", "attendance_open")}
                | {"marked": any(lesson_id in marked for lesson_id in lesson["lesson_ids"])}
                for lesson in lessons if lesson["status"] != "finished"
            ],
        }

    role = context.get("role")
    faculty_id = dean_faculty_id(context)
    counts = _marked_counts(db, [lesson["lesson_id"] for lesson in raw_lessons], now.date())
    camera_available = bool(room.camera_enabled and room.camera_stream_url) and (
        role in CAMERA_ROLES
        or (faculty_id is not None and any(schedule_service.lesson_in_faculty(lesson, faculty_id) for lesson in raw_lessons))
    )
    items = db.query(RoomInventoryItem).filter(RoomInventoryItem.room_id == room.id).order_by(RoomInventoryItem.name).all()
    # Стоимость оснащения — тем, кто ведёт инвентаризацию на странице кабинетов
    with_prices = role in (ROLE_SUPERADMIN, ROLE_ADMIN)
    inventory = [
        {"name": item.name, "category": item.category or "", "quantity": item.quantity, "condition": item.condition}
        | ({"total": round(float(item.unit_price or 0) * (item.quantity or 0), 2)} if with_prices else {})
        for item in items
    ]
    return {
        "mode": "staff",
        "room": room_info | {
            "id": room.id, "room_type": room.room_type or "", "capacity": room.capacity or 0,
            "area": float(room.area or 0),
            "camera_enabled": bool(room.camera_enabled),
        },
        "now": now.strftime("%Y-%m-%dT%H:%M:%S"),
        "lessons": [
            lesson | {
                "marked_count": sum(counts.get(lesson_id, 0) for lesson_id in lesson["lesson_ids"]),
                "can_view_attendance": _can_view_attendance(context, lesson),
            }
            for lesson in lessons
        ],
        "camera_available": camera_available,
        "inventory": inventory,
        "inventory_total": round(sum(i["total"] for i in inventory if i.get("condition") != "written_off"), 2) if with_prices else None,
    }


@router.post("/{code}/attendance")
def mark_attendance(code: str, request: Request, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    if context.get("role") != ROLE_STUDENT:
        raise HTTPException(status_code=403, detail="Отмечаться по QR-коду могут только студенты")
    student = _student(db, context.get("username") or "")
    if not student:
        raise HTTPException(status_code=403, detail="Учётная запись не найдена среди обучающихся Platonus")
    room = _room_by_code(db, code)
    now, lessons = _room_lessons_today(db, room)
    open_lessons = [lesson for lesson in lessons if lesson["attendance_open"]]
    if not open_lessons:
        raise HTTPException(status_code=409, detail="Сейчас в этой аудитории нет занятия, на котором можно отметиться")

    group_ids = {
        row.lesson_id: row.study_group_id
        for row in db.query(ScheduleLesson.lesson_id, ScheduleLesson.study_group_id)
        .filter(ScheduleLesson.lesson_id.in_([lesson["lesson_id"] for lesson in open_lessons])).all()
    }
    my_groups = {
        study_group_id for (study_group_id,) in db.query(ScheduleGroupStudent.study_group_id)
        .filter(ScheduleGroupStudent.student_id == student.student_id,
                ScheduleGroupStudent.study_group_id.in_([g for g in group_ids.values() if g])).all()
    }
    mine = [lesson for lesson in open_lessons if group_ids.get(lesson["lesson_id"]) in my_groups]
    if not mine:
        raise HTTPException(status_code=409, detail="Вы не числитесь на занятии, которое сейчас идёт в этой аудитории")

    lesson = mine[0]
    existing = db.query(LessonAttendance).filter(
        LessonAttendance.lesson_id == lesson["lesson_id"],
        LessonAttendance.lesson_date == now.date(),
        LessonAttendance.student_id == student.student_id,
    ).first()
    if existing and existing.removed_at:
        raise HTTPException(status_code=409, detail="Отметка на этом занятии снята преподавателем")
    status = "already"
    if not existing:
        db.add(LessonAttendance(
            lesson_id=lesson["lesson_id"], lesson_date=now.date(), student_id=student.student_id,
            student_login=student.login, room_id=room.id, ip_address=get_client_ip(request) or "",
            user_agent=(request.headers.get("user-agent") or "")[:1000],
        ))
        try:
            db.commit()
            status = "marked"
        except IntegrityError:
            # Повторное сканирование в ту же секунду: отметка уже есть
            db.rollback()
        if status == "marked":
            audit_event("attendance.mark", actor=context.get("username"),
                        details={"lesson_id": lesson["lesson_id"], "room_id": room.id, "student_id": student.student_id}, db=db)
    return {
        "status": status,
        "lesson": {key: lesson[key] for key in ("lesson_id", "subject", "subject_kz", "teacher", "start_time", "end_time", "pair_number")},
        "room": {"name": room.name, "building": room.building or ""},
        "student": {"full_name": student.full_name, "group_name": student.group_name},
    }


@router.get("/attendance/{lesson_id}")
def lesson_attendance(
    lesson_id: int,
    day: Optional[date] = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    context: dict = Depends(get_current_user_context),
):
    target = day or schedule_service.now_local().date()
    lesson = _lesson_for_date(db, lesson_id, target)
    if not _can_view_attendance(context, lesson):
        raise HTTPException(status_code=403, detail="Список посещаемости доступен преподавателю занятия и проверяющим")
    # Список всех потоков занятия, если Platonus разбил его на части (как на странице QR)
    lesson_ids = _class_lesson_ids(db, lesson, target)
    study_group_ids = {
        study_group_id for (study_group_id,) in
        db.query(ScheduleLesson.study_group_id).filter(ScheduleLesson.lesson_id.in_(lesson_ids)).all() if study_group_id
    }
    roster = (
        db.query(PlatonusStudent)
        .join(ScheduleGroupStudent, ScheduleGroupStudent.student_id == PlatonusStudent.student_id)
        .filter(ScheduleGroupStudent.study_group_id.in_(study_group_ids))
        .distinct()
        .order_by(PlatonusStudent.group_name, PlatonusStudent.full_name)
        .all()
    ) if study_group_ids else []
    marks = {
        mark.student_id: mark
        for mark in db.query(LessonAttendance).filter(LessonAttendance.lesson_id.in_(lesson_ids), LessonAttendance.lesson_date == target).all()
    }
    students = []
    for student in roster:
        mark = marks.get(student.student_id)
        students.append({
            "student_id": student.student_id,
            "full_name": student.full_name,
            "group_name": student.group_name,
            "attendance_id": mark.id if mark else None,
            "marked_at": mark.marked_at.isoformat() if mark else None,
            "removed": bool(mark and mark.removed_at),
        })
    present = sum(1 for item in students if item["marked_at"] and not item["removed"])
    return {"lesson": lesson, "date": target.isoformat(), "present": present, "total": len(students), "students": students}


@router.delete("/attendance/mark/{attendance_id}")
def remove_attendance(attendance_id: int, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    mark = db.get(LessonAttendance, attendance_id)
    if not mark:
        raise HTTPException(status_code=404, detail="Отметка не найдена")
    lesson = _lesson_for_date(db, mark.lesson_id, mark.lesson_date)
    if not _can_view_attendance(context, lesson):
        raise HTTPException(status_code=403, detail="Снять отметку может преподаватель занятия или проверяющий")
    if not mark.removed_at:
        mark.removed_at = datetime.utcnow()
        mark.removed_by = context.get("username")
        db.commit()
        audit_event("attendance.remove", actor=context.get("username"),
                    details={"attendance_id": mark.id, "lesson_id": mark.lesson_id, "student_id": mark.student_id}, db=db)
    return {"status": "removed"}


@router.get("/my/schedule")
def my_schedule(
    day: Optional[date] = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    context: dict = Depends(get_current_user_context),
):
    """Расписание студента на неделю, содержащую дату (по умолчанию — текущую), с отметками посещаемости."""
    if context.get("role") != ROLE_STUDENT:
        raise HTTPException(status_code=403, detail="Раздел доступен студентам")
    student = _student(db, context.get("username") or "")
    now = schedule_service.now_local()
    if not student:
        return {"student": None, "today": now.date().isoformat(), "now": now.strftime("%H:%M"), "week_start": None, "days": []}
    groups = {
        study_group_id for (study_group_id,) in
        db.query(ScheduleGroupStudent.study_group_id).filter(ScheduleGroupStudent.student_id == student.student_id).all()
    }
    result = schedule_service.week_for_study_groups(db, groups, day or now.date())
    # Отметки студента за эту неделю: занятие + дата
    week_start = date.fromisoformat(result["week_start"])
    marks = {
        (mark.lesson_id, mark.lesson_date.isoformat()): mark
        for mark in db.query(LessonAttendance).filter(
            LessonAttendance.student_id == student.student_id,
            LessonAttendance.lesson_date >= week_start,
            LessonAttendance.lesson_date < week_start + timedelta(days=7),
        ).all()
    }
    for day_item in result["days"]:
        for lesson in day_item["lessons"]:
            mark = marks.get((lesson["lesson_id"], day_item["date"]))
            lesson["attendance"] = None if not mark else ("removed" if mark.removed_at else "marked")
    return {
        "student": {"full_name": student.full_name, "group_name": student.group_name},
        "today": now.date().isoformat(),
        "now": now.strftime("%H:%M"),
        **result,
    }


@router.get("/my/attendance")
def my_attendance(db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    """Отметки студента за последние 60 дней."""
    if context.get("role") != ROLE_STUDENT:
        raise HTTPException(status_code=403, detail="Раздел доступен студентам")
    student = _student(db, context.get("username") or "")
    if not student:
        return {"student": None, "items": []}
    since = schedule_service.now_local().date() - timedelta(days=60)
    marks = (
        db.query(LessonAttendance)
        .filter(LessonAttendance.student_id == student.student_id, LessonAttendance.lesson_date >= since)
        .order_by(LessonAttendance.lesson_date.desc(), LessonAttendance.marked_at.desc())
        .all()
    )
    lessons = {
        lesson.lesson_id: lesson
        for lesson in db.query(ScheduleLesson).filter(ScheduleLesson.lesson_id.in_({mark.lesson_id for mark in marks})).all()
    } if marks else {}
    rooms = {room.id: room for room in db.query(Room).filter(Room.id.in_({mark.room_id for mark in marks if mark.room_id})).all()} if marks else {}
    items = []
    for mark in marks:
        lesson = lessons.get(mark.lesson_id)
        room = rooms.get(mark.room_id)
        items.append({
            "id": mark.id,
            "date": mark.lesson_date.isoformat(),
            "marked_at": mark.marked_at.isoformat(),
            "removed": bool(mark.removed_at),
            "subject": lesson.subject if lesson else "",
            "subject_kz": lesson.subject_kz if lesson else "",
            "start_time": lesson.start_time.strftime("%H:%M") if lesson else "",
            "end_time": lesson.end_time.strftime("%H:%M") if lesson else "",
            "teacher": lesson.teacher if lesson else "",
            "room": room.name if room else "",
            "building": room.building if room else "",
        })
    return {"student": {"full_name": student.full_name, "group_name": student.group_name}, "items": items}
