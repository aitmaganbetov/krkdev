"""Учебное расписание из Platonus: импорт и занятия на дату (для ситуационного мониторинга).

Platonus хранит расписание как слоты «день недели + пара» (timetable) с набором учебных недель
(timetable_weeks). Неделя 1 начинается с понедельника недели старта семестра (terms, тип «Семестр»).
Импортируются только опубликованные занятия; кабинет связывается с rooms по аудитории Platonus.
"""
import logging
import threading
from collections import Counter, OrderedDict
from datetime import date, datetime, time, timedelta
from time import monotonic
from types import SimpleNamespace
from typing import Dict, Optional

import pymysql
from sqlalchemy import bindparam, delete, inspect, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import SessionLocal
from migrations import _compose_tutor_name, get_remote_config
from models.room import Room
from models.attendance import PlatonusStudent, ScheduleGroupStudent
from models.schedule_lesson import ScheduleLesson, ScheduleTerm
from services.auth_service import sync_auto_roles

logger = logging.getLogger(__name__)

UTC_PLUS_5 = timedelta(hours=5)
TERM_WEEKS_FALLBACK = 15
# Расписание в Platonus заполняется в течение семестра — при устаревании подтягиваем его в фоне
AUTO_SYNC_AFTER = timedelta(hours=3)
_sync_lock = threading.Lock()


# Platonus: studylanguages.Id и degree_types.degreeID → значения формы взаимопосещения
LANGUAGE_BY_ID = {1: "ru", 2: "kz", 3: "en"}
EDUCATION_LEVEL_BY_DEGREE = {1: "bachelor", 8: "bachelor", 2: "master", 3: "master"}


def ensure_schedule_schema(engine) -> None:
    """Стартовая миграция schedule_lessons (курс, уровень образования, язык) и ИИН обучающихся
    в platonus_students (таблицы создаёт create_all)."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = inspector.get_table_names()
        if "platonus_students" in tables:
            if "iin" not in {c["name"] for c in inspector.get_columns("platonus_students")}:
                conn.execute(text("ALTER TABLE platonus_students ADD COLUMN iin CHAR(12) NULL, ADD KEY ix_platonus_students_iin (iin)"))
        if "schedule_lessons" not in tables:
            return
        columns = {c["name"] for c in inspector.get_columns("schedule_lessons")}
        if "course" not in columns:
            conn.execute(text("ALTER TABLE schedule_lessons ADD COLUMN course INT NOT NULL DEFAULT 0"))
        if "education_level" not in columns:
            conn.execute(text("ALTER TABLE schedule_lessons ADD COLUMN education_level VARCHAR(20) NOT NULL DEFAULT ''"))
        if "language" not in columns:
            conn.execute(text("ALTER TABLE schedule_lessons ADD COLUMN language VARCHAR(5) NOT NULL DEFAULT ''"))
        if "study_group_id" not in columns:
            conn.execute(text("ALTER TABLE schedule_lessons ADD COLUMN study_group_id INT NULL, ADD KEY idx_schedule_lessons_study_group (study_group_id)"))


def now_local() -> datetime:
    return datetime.utcnow() + UTC_PLUS_5


def study_year_for(day: date) -> int:
    """Учебный год начинается в августе: октябрь 2026 → 2026 (2026–2027)."""
    return day.year if day.month >= 8 else day.year - 1


def _as_time(value) -> Optional[time]:
    if value is None:
        return None
    if isinstance(value, time):
        return value
    seconds = int(value.total_seconds())
    return time(seconds // 3600 % 24, seconds // 60 % 60)


def _connect():
    return pymysql.connect(
        **get_remote_config(),
        connect_timeout=5,
        read_timeout=60,
        cursorclass=pymysql.cursors.DictCursor,
    )


def _term_period(cursor, study_year: int, term: int) -> tuple[date, date]:
    """Самые частые даты семестра среди учебных календарей; у части магистратуры они свои."""
    window = (
        (date(study_year, 8, 1), date(study_year, 12, 31))
        if term == 1 else (date(study_year + 1, 1, 1), date(study_year + 1, 6, 30))
    )
    cursor.execute("""
        SELECT TermStartDate AS start_date, TermFinishDate AS end_date, COUNT(*) AS calendars
        FROM terms
        WHERE TermTypeID = 1 AND TermStartDate BETWEEN %s AND %s
        GROUP BY TermStartDate, TermFinishDate
        ORDER BY calendars DESC, TermStartDate
        LIMIT 1
    """, window)
    row = cursor.fetchone()
    if row:
        return row["start_date"], row["end_date"]
    start = window[0] if term == 1 else window[0] + timedelta(days=17)
    return start, start + timedelta(weeks=TERM_WEEKS_FALLBACK, days=-3)


def _chunks(items: list, size: int = 500):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def _fetch_schedule(study_year: int) -> dict:
    conn = _connect()
    try:
        with conn.cursor() as cursor:
            terms = {term: _term_period(cursor, study_year, term) for term in (1, 2)}

            cursor.execute("""
                SELECT
                    t.lessonID, t.week_day, t.onlineClass,
                    NULLIF(t.auditoryID, 0) AS auditoryID,
                    -- Преподаватель — у потока; timetable.tutorID — диспетчер, внёсший расписание
                    NULLIF(sg.tutorid, 0) AS tutorID,
                    sg.StudyGroupID, sg.groupname, sg.Term,
                    s.SubjectNameRU, s.SubjectNameKZ, s.degreetypeid AS degreeID, ts.language AS languageID,
                    gt.nameru AS typeRU, gt.namekz AS typeKZ,
                    lh.start, lh.finish, lh.displayNumber,
                    a.auditoryName, b.buildingName
                FROM timetable t
                JOIN studygroups sg ON sg.StudyGroupID = t.studyGroupID
                LEFT JOIN subjects s ON s.SubjectID = sg.subjectid
                LEFT JOIN tutorsubject ts ON ts.TutorSubjectID = sg.tutorSubjectID
                LEFT JOIN grouptypes gt ON gt.grouptypeID = ts.grouptypeid
                LEFT JOIN lesson_hours lh ON lh.number = t.number
                LEFT JOIN auditories a ON a.auditoryID = NULLIF(t.auditoryID, 0)
                LEFT JOIN buildings b ON b.buildingID = a.buildingID
                WHERE sg.year = %s AND sg.Term IN (1, 2) AND COALESCE(sg.deleted, 0) = 0
                  AND t.publishedDate IS NOT NULL
                ORDER BY t.lessonID
            """, (study_year,))
            lessons = cursor.fetchall()

            cursor.execute("""
                SELECT COUNT(*) AS n
                FROM timetable t JOIN studygroups sg ON sg.StudyGroupID = t.studyGroupID
                WHERE sg.year = %s AND sg.Term IN (1, 2) AND COALESCE(sg.deleted, 0) = 0
                  AND t.publishedDate IS NULL
            """, (study_year,))
            unpublished = cursor.fetchone()["n"]

            weeks: dict[int, list[int]] = {}
            lesson_ids = [row["lessonID"] for row in lessons]
            for chunk in _chunks(lesson_ids):
                cursor.execute(
                    f"SELECT lessonID, weekNumber FROM timetable_weeks WHERE lessonID IN ({','.join(['%s'] * len(chunk))})",
                    chunk,
                )
                for row in cursor.fetchall():
                    weeks.setdefault(row["lessonID"], []).append(int(row["weekNumber"]))

            groups: dict[int, dict] = {}
            courses: dict[int, tuple[int, int]] = {}
            members: list[dict] = []
            study_group_ids = sorted({row["StudyGroupID"] for row in lessons})
            for chunk in _chunks(study_group_ids):
                cursor.execute(f"""
                    SELECT ssg.studyGroupID,
                           GROUP_CONCAT(DISTINCT g.name ORDER BY g.name SEPARATOR ', ') AS names,
                           COUNT(DISTINCT ssg.StudentID) AS students
                    FROM studentstudygroup ssg
                    JOIN students st ON st.StudentID = ssg.StudentID
                    LEFT JOIN `groups` g ON g.groupID = st.groupID
                    WHERE ssg.studyGroupID IN ({','.join(['%s'] * len(chunk))})
                    GROUP BY ssg.studyGroupID
                """, chunk)
                for row in cursor.fetchall():
                    groups[row["studyGroupID"]] = row
                # Состав потока: кто может отметиться на его занятиях по QR-коду аудитории
                cursor.execute(
                    f"SELECT studyGroupID AS study_group_id, StudentID AS student_id FROM studentstudygroup "
                    f"WHERE studyGroupID IN ({','.join(['%s'] * len(chunk))})",
                    chunk,
                )
                members.extend(cursor.fetchall())
                # Курс потока — курс большинства его студентов
                cursor.execute(f"""
                    SELECT ssg.studyGroupID, st.CourseNumber AS course, COUNT(*) AS students
                    FROM studentstudygroup ssg
                    JOIN students st ON st.StudentID = ssg.StudentID
                    WHERE ssg.studyGroupID IN ({','.join(['%s'] * len(chunk))}) AND st.CourseNumber > 0
                    GROUP BY ssg.studyGroupID, st.CourseNumber
                """, chunk)
                for row in cursor.fetchall():
                    best = courses.get(row["studyGroupID"])
                    if best is None or row["students"] > best[1]:
                        courses[row["studyGroupID"]] = (int(row["course"]), row["students"])

            tutors: dict[int, dict] = {}
            tutor_ids = sorted({row["tutorID"] for row in lessons if row["tutorID"]})
            for chunk in _chunks(tutor_ids):
                cursor.execute(f"""
                    SELECT TutorID AS tutor_id, lastname_ru, firstname_ru, patronymic_ru,
                           lastname, firstname, patronymic, NULLIF(TRIM(Login), '') AS login
                    FROM tutors WHERE TutorID IN ({','.join(['%s'] * len(chunk))})
                """, chunk)
                for row in cursor.fetchall():
                    tutors[row["tutor_id"]] = row
            cursor.execute(STUDENTS_SQL)
            students = cursor.fetchall()
    finally:
        conn.close()
    return {
        "terms": terms, "lessons": lessons, "weeks": weeks, "groups": groups, "courses": courses,
        "tutors": tutors, "unpublished": unpublished, "members": members, "students": students,
    }


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


# Активные обучающиеся: по их логинам вход через LDAP получает роль «Студент», по ИИН — вход по ЭЦП
STUDENTS_SQL = """
    SELECT s.StudentID AS student_id, NULLIF(TRIM(s.Login), '') AS login,
           s.lastname, s.firstname, s.patronymic, g.name AS group_name,
           CASE WHEN TRIM(s.iinplt) REGEXP '^[0-9]{12}$' THEN TRIM(s.iinplt) END AS iin
    FROM students s LEFT JOIN `groups` g ON g.groupID = s.groupID
    WHERE s.isStudent = 1
"""
STUDENTS_COUNT_SQL = "SELECT COUNT(*) FROM students WHERE isStudent = 1"


def _replace_students(db: Session, students: list[dict]) -> None:
    """Снимок обучающихся (platonus_students) целиком; пустой ответ Platonus не стирает прежний."""
    if not students:
        return
    db.execute(delete(PlatonusStudent))
    db.bulk_insert_mappings(PlatonusStudent, [{
        "student_id": row["student_id"],
        "login": _text(row["login"], 255).lower(),
        "full_name": _text(" ".join(p for p in (row["lastname"], row["firstname"], row["patronymic"]) if p), 255),
        "group_name": _text(row["group_name"], 100),
        "iin": row["iin"],
    } for row in students])


def sync_students_from_platonus(db: Session) -> Dict:
    """Только обучающиеся, без расписания: для синхронизации справочников в настройках."""
    try:
        conn = _connect()
        try:
            with conn.cursor() as cursor:
                cursor.execute(STUDENTS_SQL)
                students = cursor.fetchall()
        finally:
            conn.close()
    except Exception as exc:
        return {"status": "error", "message": f"Не удалось получить обучающихся Platonus: {type(exc).__name__}: {exc}"}
    try:
        _replace_students(db, students)
        db.commit()
    except Exception as exc:
        db.rollback()
        return {"status": "error", "message": f"Не удалось сохранить обучающихся: {type(exc).__name__}: {exc}"}
    return {"status": "success", "total": len(students)}


def sync_schedule_from_platonus(db: Session, study_year: int) -> Dict:
    try:
        data = _fetch_schedule(study_year)
    except Exception as exc:
        return {"status": "error", "message": f"Не удалось получить расписание Platonus: {type(exc).__name__}: {exc}"}

    rows, skipped = [], 0
    for lesson in data["lessons"]:
        start, finish = _as_time(lesson["start"]), _as_time(lesson["finish"])
        if start is None or finish is None:
            skipped += 1
            continue
        tutor = data["tutors"].get(lesson["tutorID"])
        group = data["groups"].get(lesson["StudyGroupID"], {})
        rows.append({
            "lesson_id": lesson["lessonID"],
            "study_year": study_year,
            "term": lesson["Term"],
            "week_day": lesson["week_day"],
            "pair_number": lesson["displayNumber"] or 0,
            "start_time": start,
            "end_time": finish,
            "weeks": ",".join(str(w) for w in sorted(set(data["weeks"].get(lesson["lessonID"], []))))[:255],
            "subject": _text(lesson["SubjectNameRU"], 500),
            "subject_kz": _text(lesson["SubjectNameKZ"], 500),
            "lesson_type": _text(lesson["typeRU"], 100),
            "lesson_type_kz": _text(lesson["typeKZ"], 100),
            "tutor_id": lesson["tutorID"],
            "teacher": _text(_compose_tutor_name(tutor), 255) if tutor else "",
            "teacher_login": tutor["login"] if tutor else None,
            "student_groups": group.get("names") or "",
            "students_count": int(group.get("students") or 0),
            "study_group": _text(lesson["groupname"], 255),
            "study_group_id": lesson["StudyGroupID"],
            "course": data["courses"].get(lesson["StudyGroupID"], (0, 0))[0],
            "education_level": EDUCATION_LEVEL_BY_DEGREE.get(lesson["degreeID"], ""),
            "language": LANGUAGE_BY_ID.get(lesson["languageID"], ""),
            "platonus_auditory_id": lesson["auditoryID"],
            "room_name": _text(lesson["auditoryName"], 100),
            "building": _text(lesson["buildingName"], 150),
            "online": bool(lesson["onlineClass"]) or not lesson["auditoryID"],
        })

    by_term = Counter(row["term"] for row in rows)
    try:
        db.execute(delete(ScheduleLesson).where(ScheduleLesson.study_year == study_year))
        db.execute(delete(ScheduleTerm).where(ScheduleTerm.study_year == study_year))
        db.flush()
        if rows:
            db.bulk_insert_mappings(ScheduleLesson, rows)
        study_group_ids = {row["study_group_id"] for row in data["members"]} | {row["study_group_id"] for row in rows if row["study_group_id"]}
        if study_group_ids:
            db.execute(delete(ScheduleGroupStudent).where(ScheduleGroupStudent.study_group_id.in_(study_group_ids)))
        members = {(row["study_group_id"], row["student_id"]) for row in data["members"]}
        if members:
            db.bulk_insert_mappings(ScheduleGroupStudent, [{"study_group_id": g, "student_id": s} for g, s in members])
        _replace_students(db, data["students"])
        for term, (start, end) in data["terms"].items():
            db.add(ScheduleTerm(study_year=study_year, term=term, start_date=start, end_date=end, lessons_count=by_term.get(term, 0)))
        db.commit()
    except Exception as exc:
        db.rollback()
        return {"status": "error", "message": f"Не удалось сохранить расписание: {type(exc).__name__}: {exc}"}

    # Роль «Студент» по обновлённому списку обучающихся; сбой не отменяет импорт
    try:
        sync_auto_roles()
    except Exception:
        logger.exception("Не удалось обновить роли по Platonus")

    return {
        "status": "success",
        "message": "Расписание Platonus импортировано",
        "study_year": study_year,
        "lessons": len(rows),
        "by_term": {str(term): by_term.get(term, 0) for term in (1, 2)},
        "terms": {str(term): {"start": start.isoformat(), "end": end.isoformat()} for term, (start, end) in data["terms"].items()},
        "unpublished": data["unpublished"],
        "skipped": skipped,
    }


def sync_in_background_if_stale(study_year: int) -> bool:
    """Запускает фоновый импорт, если расписание года не обновлялось дольше AUTO_SYNC_AFTER."""
    db = SessionLocal()
    try:
        synced = db.query(ScheduleTerm.synced_at).filter(ScheduleTerm.study_year == study_year).order_by(ScheduleTerm.synced_at.desc()).first()
    finally:
        db.close()
    # synced_at пишет MySQL (NOW() — время сервера БД, UTC в контейнере)
    if synced and datetime.utcnow() - synced[0] < AUTO_SYNC_AFTER:
        return False
    if not _sync_lock.acquire(blocking=False):
        return False

    def run():
        session = SessionLocal()
        try:
            result = sync_schedule_from_platonus(session, study_year)
            if result["status"] != "success":
                logger.warning("Фоновый импорт расписания: %s", result["message"])
        finally:
            session.close()
            _sync_lock.release()

    threading.Thread(target=run, name="schedule-sync", daemon=True).start()
    return True


def _term_for(db: Session, day: date) -> Optional[ScheduleTerm]:
    return (
        db.query(ScheduleTerm)
        .filter(ScheduleTerm.start_date <= day, ScheduleTerm.end_date >= day)
        .order_by(ScheduleTerm.start_date.desc())
        .first()
    )


def week_number(term_start: date, day: date) -> int:
    first_monday = term_start - timedelta(days=term_start.weekday())
    return (day - first_monday).days // 7 + 1


def first_group(student_groups: str) -> str:
    return (student_groups or "").split(",")[0].strip()


def _catalog_context(db: Session, lessons: list[ScheduleLesson]) -> tuple[dict, dict]:
    """Кафедра преподавателя и факультет/ОП группы из справочников Platonus — для заполнения форм."""
    tutor_ids = sorted({lesson.tutor_id for lesson in lessons if lesson.tutor_id})
    group_names = sorted({first_group(lesson.student_groups) for lesson in lessons} - {""})
    tutors, groups = {}, {}
    try:
        if tutor_ids:
            rows = db.execute(text("""
                SELECT t.tutor_id, c.cafedraNameRU AS cafedra, c.FacultyID AS faculty_id
                FROM tutors t LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
                WHERE t.tutor_id IN :ids
            """).bindparams(bindparam("ids", expanding=True)), {"ids": tutor_ids}).mappings().all()
            tutors = {row["tutor_id"]: row for row in rows}
        if group_names:
            rows = db.execute(text("""
                SELECT g.name, s.nameru AS op_name, s.specializationCode AS op_code,
                       f.FacultyID AS faculty_id, f.facultyNameRU AS faculty
                FROM `groups` g
                LEFT JOIN specializations s ON s.id = g.specializationID
                LEFT JOIN faculties f ON f.FacultyID = s.faculty_id
                WHERE g.name IN :names
            """).bindparams(bindparam("names", expanding=True)), {"names": group_names}).mappings().all()
            groups = {row["name"]: row for row in rows}
    except SQLAlchemyError:
        # Справочники ещё не синхронизированы — формы просто не получат эти подсказки
        logger.warning("Справочники Platonus недоступны для контекста расписания", exc_info=True)
    return tutors, groups


# Полный день расписания (занятия + кафедры и группы из справочников) меняется только при синхронизации:
# кеш по (дата, время синхронизации расписания); 60 с — запас для синхронизации справочников. Кабинеты
# (название, камера) читаются при каждом запросе.
_DAY_CACHE: "OrderedDict[tuple, tuple]" = OrderedDict()
_DAY_CACHE_TTL = 60.0
_DAY_CACHE_SIZE = 16
_day_cache_lock = threading.Lock()
_LESSON_FIELDS = (
    "lesson_id", "start_time", "end_time", "pair_number", "subject", "subject_kz", "lesson_type", "lesson_type_kz",
    "tutor_id", "teacher", "teacher_login", "student_groups", "students_count", "study_group", "room_name", "building",
    "online", "course", "education_level", "language", "platonus_auditory_id",
)


def _day_lessons(db: Session, term: ScheduleTerm, day: date, week: int, auditory_id: Optional[int],
                 lesson_id: Optional[int], synced_at: Optional[datetime]) -> tuple[list, dict, dict]:
    key = (day, week, synced_at) if auditory_id is None and lesson_id is None else None
    if key is not None:
        with _day_cache_lock:
            hit = _DAY_CACHE.get(key)
        if hit and monotonic() - hit[0] < _DAY_CACHE_TTL:
            return hit[1], hit[2], hit[3]

    query = db.query(ScheduleLesson).filter(
        ScheduleLesson.study_year == term.study_year,
        ScheduleLesson.term == term.term,
        ScheduleLesson.week_day == day.isoweekday(),
    )
    if auditory_id is not None:
        query = query.filter(ScheduleLesson.platonus_auditory_id == auditory_id)
    if lesson_id is not None:
        query = query.filter(ScheduleLesson.lesson_id == lesson_id)
    # lesson_id — однозначный порядок параллельных занятий в одной аудитории (иначе он зависит от плана запроса)
    candidates = query.order_by(
        ScheduleLesson.start_time, ScheduleLesson.building, ScheduleLesson.room_name, ScheduleLesson.lesson_id
    ).all()
    # Значения, а не ORM-объекты: кеш живёт дольше сессии
    lessons = [
        SimpleNamespace(**{field: getattr(lesson, field) for field in _LESSON_FIELDS})
        for lesson in candidates if str(week) in lesson.weeks.split(",")
    ]
    tutors, groups = _catalog_context(db, lessons)
    tutors = {key_: dict(row) for key_, row in tutors.items()}
    groups = {key_: dict(row) for key_, row in groups.items()}

    if key is not None:
        with _day_cache_lock:
            _DAY_CACHE[key] = (monotonic(), lessons, tutors, groups)
            _DAY_CACHE.move_to_end(key)
            while len(_DAY_CACHE) > _DAY_CACHE_SIZE:
                _DAY_CACHE.popitem(last=False)
    return lessons, tutors, groups


def lessons_for_date(db: Session, day: date, *, auditory_id: Optional[int] = None, lesson_id: Optional[int] = None) -> Dict:
    """Занятия на дату. auditory_id / lesson_id сужают выборку в SQL (QR-скан, проверки по одной аудитории)
    вместо расчёта расписания всего университета; формат занятий тот же."""
    term = _term_for(db, day)
    synced = db.query(ScheduleTerm.synced_at).order_by(ScheduleTerm.synced_at.desc()).first()
    result = {
        "date": day.isoformat(),
        "study_year": term.study_year if term else study_year_for(day),
        "term": term.term if term else None,
        "week": None,
        "synced_at": synced[0].isoformat() if synced else None,
        "lessons": [],
    }
    if not term:
        return result
    week = week_number(term.start_date, day)
    result["week"] = week

    lessons, tutors, groups = _day_lessons(db, term, day, week, auditory_id, lesson_id, synced[0] if synced else None)

    auditory_ids = {lesson.platonus_auditory_id for lesson in lessons if lesson.platonus_auditory_id}
    rooms = {
        room.platonus_auditory_id: room
        for room in db.query(Room).filter(Room.platonus_auditory_id.in_(auditory_ids)).all()
    } if auditory_ids else {}

    for lesson in lessons:
        room = rooms.get(lesson.platonus_auditory_id)
        tutor = tutors.get(lesson.tutor_id) or {}
        group_name = first_group(lesson.student_groups)
        group = groups.get(group_name) or {}
        op = " - ".join(part for part in (group.get("op_code"), group.get("op_name")) if part)
        result["lessons"].append({
            "id": f"schedule-{lesson.lesson_id}-{day.isoformat()}",
            "lesson_id": lesson.lesson_id,
            "date": day.isoformat(),
            "start_time": lesson.start_time.strftime("%H:%M"),
            "end_time": lesson.end_time.strftime("%H:%M"),
            "pair_number": lesson.pair_number,
            "subject": lesson.subject,
            "subject_kz": lesson.subject_kz,
            "lesson_type": lesson.lesson_type,
            "lesson_type_kz": lesson.lesson_type_kz,
            "teacher": lesson.teacher,
            "teacher_login": lesson.teacher_login,
            "student_groups": lesson.student_groups,
            "students_count": lesson.students_count,
            "study_group": lesson.study_group,
            "room": room.name if room else lesson.room_name,
            "building": room.building if room else lesson.building,
            "online": lesson.online,
            "room_id": room.id if room else None,
            "camera_enabled": bool(room and room.camera_enabled),
            "course": lesson.course or None,
            "education_level": lesson.education_level,
            "language": lesson.language,
            "cafedra": tutor.get("cafedra") or "",
            "teacher_faculty_id": tutor.get("faculty_id"),
            "group_name": group_name,
            "faculty": group.get("faculty") or "",
            "faculty_id": group.get("faculty_id"),
            "op": op,
        })
    return result


def lesson_in_faculty(lesson: dict, faculty_id: int) -> bool:
    """Занятие факультета: его группа или кафедра преподавателя относятся к факультету."""
    return faculty_id in (lesson.get("faculty_id"), lesson.get("teacher_faculty_id"))


def faculty_has_lesson_in_room_today(db: Session, room_id: int, faculty_id: int) -> bool:
    room = db.get(Room, room_id)
    if room is None or not room.platonus_auditory_id:
        return False
    lessons = lessons_for_date(db, now_local().date(), auditory_id=room.platonus_auditory_id)["lessons"]
    return any(lesson["room_id"] == room_id and lesson_in_faculty(lesson, faculty_id) for lesson in lessons)


def week_for_study_groups(db: Session, study_group_ids: set[int], any_day: date) -> Dict:
    """Расписание потоков на неделю (пн–вс), содержащую any_day: для личного кабинета студента.
    Семестры недели, занятия (по запросу на семестр) и аудитории читаются один раз, а не по дню."""
    monday = any_day - timedelta(days=any_day.weekday())
    dates = [monday + timedelta(days=offset) for offset in range(7)]
    # Как _term_for: из семестров, покрывающих день, — с самым поздним началом
    terms = (db.query(ScheduleTerm)
             .filter(ScheduleTerm.start_date <= dates[-1], ScheduleTerm.end_date >= monday)
             .order_by(ScheduleTerm.start_date.desc()).all())
    term_by_day = {day: next((t for t in terms if t.start_date <= day <= t.end_date), None) for day in dates}

    lessons_by_day: dict[date, list[ScheduleLesson]] = {day: [] for day in dates}
    if study_group_ids:
        days_by_term: dict[tuple, list[date]] = {}
        for day, term in term_by_day.items():
            if term:
                days_by_term.setdefault((term.study_year, term.term), []).append(day)
        for (study_year, term_no), term_days in days_by_term.items():
            day_by_weekday = {day.isoweekday(): day for day in term_days}
            rows = db.query(ScheduleLesson).filter(
                ScheduleLesson.study_year == study_year,
                ScheduleLesson.term == term_no,
                ScheduleLesson.week_day.in_(list(day_by_weekday)),
                ScheduleLesson.study_group_id.in_(study_group_ids),
            ).order_by(ScheduleLesson.start_time, ScheduleLesson.lesson_id).all()
            for lesson in rows:
                day = day_by_weekday[lesson.week_day]
                if str(week_number(term_by_day[day].start_date, day)) in lesson.weeks.split(","):
                    lessons_by_day[day].append(lesson)

    auditory_ids = {lesson.platonus_auditory_id for lessons in lessons_by_day.values()
                    for lesson in lessons if lesson.platonus_auditory_id}
    rooms_by_auditory: dict[int, Room] = {
        room.platonus_auditory_id: room
        for room in db.query(Room).filter(Room.platonus_auditory_id.in_(auditory_ids)).all()
    } if auditory_ids else {}

    days = []
    for day in dates:
        term = term_by_day[day]
        lessons = lessons_by_day[day]
        days.append({
            "date": day.isoformat(),
            "week": week_number(term.start_date, day) if term and study_group_ids else None,
            "lessons": [{
                "lesson_id": lesson.lesson_id,
                "start_time": lesson.start_time.strftime("%H:%M"),
                "end_time": lesson.end_time.strftime("%H:%M"),
                "pair_number": lesson.pair_number,
                "subject": lesson.subject,
                "subject_kz": lesson.subject_kz,
                "lesson_type": lesson.lesson_type,
                "lesson_type_kz": lesson.lesson_type_kz,
                "teacher": lesson.teacher,
                "room": (rooms_by_auditory.get(lesson.platonus_auditory_id).name
                         if lesson.platonus_auditory_id in rooms_by_auditory else lesson.room_name),
                "building": (rooms_by_auditory.get(lesson.platonus_auditory_id).building
                             if lesson.platonus_auditory_id in rooms_by_auditory else lesson.building),
                "online": lesson.online,
            } for lesson in lessons],
        })
    return {"week_start": monday.isoformat(), "days": days}
