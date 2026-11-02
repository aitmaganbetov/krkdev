"""Демо-данные по ролям — ТОЛЬКО для dev (DEV_QUICK_LOGIN, см. routers/dev_login.py).

Роли «Преподаватель», «Пользователь», «Член комитета КРК» и «Студент» входят как настоящие люди из Platonus
(персонажи выбираются один раз и запоминаются в system_settings): их личные разделы заполняются по логину
Platonus, как у живых пользователей. Остальные роли — служебные учётные записи dev.<роль>.

Данные создаются через сервисы приложения (баллы, проблемность, отпечаток документа и PDF формы 16-02 —
как из интерфейса). Каждая созданная строка учитывается в dev_seed_items: clear() удаляет только её,
настоящие данные не затрагиваются. Подпись ЭЦП в демо-данных не настоящая и помечена «DEV · демо-подпись».
"""
import hashlib
import json
import logging
import os
import random
import uuid
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from models.attendance import LessonAttendance, ScheduleGroupStudent
from models.notification import Notification
from models.peer_visit import PeerVisit
from models.peer_visit_schedule import PeerVisitSchedule
from models.record import Record
from models.room import Room
from models.schedule_lesson import ScheduleLesson
from models.violation import Violation, ViolationResponse
from schemas.peer_visit import LEVEL_CRITERIA, PeerVisitCreate
from schemas.record import RecordCreate
from services import peer_visit_service, record_service
from services import rating_template_service as rating_templates
from services import schedule_service
from services import video_checklist as checklist_rules
from services.faculty_scope import teacher_faculty_id
from services.peer_visit_service import FACULTY_CODE_BY_ID
from services.situational_monitoring import act_dir, document_hash, notify_teacher, save_checklist_pdf

logger = logging.getLogger(__name__)

PERSONAS_KEY = "dev_seed_personas"
UTC_PLUS_5 = timedelta(hours=5)
# Служебные учётные записи (как в быстром входе) — авторы записей и наблюдатели
ADMIN, INSPECTOR, STAFF, PEER_INSPECTOR = "dev.admin", "dev.inspector", "dev.staff", "dev.peer_inspector"
DEMO_SIGNATURE = "DEV · демо-подпись (без ЭЦП)"
TOPICS = (
    "Основные понятия и определения", "Практическое применение методов", "Анализ типовых задач",
    "Решение задач по теме раздела", "Обобщение и контроль знаний", "Лабораторный практикум",
)


def _expanding(name: str):
    return bindparam(name, expanding=True)


# ——— учёт созданных строк ———

def _ensure_tables(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS dev_seed_items (
            id INT PRIMARY KEY AUTO_INCREMENT,
            kind VARCHAR(50) NOT NULL,
            row_id INT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY ix_dev_seed_items_kind (kind)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))


def _track(db: Session, kind: str, row_id: int) -> None:
    db.execute(text("INSERT INTO dev_seed_items (kind, row_id) VALUES (:kind, :id)"), {"kind": kind, "id": row_id})


def _tracked(db: Session, kind: str) -> list[int]:
    return [row_id for (row_id,) in db.execute(text("SELECT row_id FROM dev_seed_items WHERE kind = :kind"), {"kind": kind})]


def is_seeded(db: Session) -> bool:
    _ensure_tables(db)
    return bool(db.execute(text("SELECT 1 FROM dev_seed_items WHERE kind = 'seeded' LIMIT 1")).first())


# ——— персонажи из Platonus ———

def _academic_year(today: date) -> str:
    year = schedule_service.study_year_for(today)
    return f"{year}-{year + 1}"


def _no_account(login_column: str) -> str:
    """Человек без учётной записи КРК: персонаж не перезаписывает настоящий аккаунт (LDAP, пароль)."""
    return (f"NOT EXISTS (SELECT 1 FROM users u WHERE SUBSTRING_INDEX(LOWER(u.username), '@', 1) = "
            f"LOWER({login_column}) COLLATE utf8mb4_unicode_ci)")


def _pick_visitor(db: Session, academic_year: str, study_year: int, exclude: set[int]) -> Optional[dict]:
    """Преподаватель с занятиями в учебном году, который есть в графике взаимопосещения посещающим."""
    query = text(f"""
        SELECT t.tutor_id, t.login, t.full_name, c.FacultyID AS faculty_id,
               COUNT(DISTINCT s.id) AS plan_rows,
               (SELECT COUNT(*) FROM schedule_lessons l WHERE l.tutor_id = t.tutor_id AND l.study_year = :study_year) AS lessons
        FROM tutors t
        JOIN cafedras c ON c.cafedraID = t.cafedra_id
        JOIN peer_visit_schedule s ON s.visitor_tutor_id = t.tutor_id AND s.academic_year = :year
        WHERE t.login IS NOT NULL AND {_no_account('t.login')}
          AND t.tutor_id NOT IN (SELECT m.tutor_id FROM committee_members m
                                 JOIN committee_orders o ON o.id = m.order_id AND o.is_active = 1)
          AND t.tutor_id NOT IN :exclude
        GROUP BY t.tutor_id, t.login, t.full_name, c.FacultyID
        HAVING lessons > 0
        ORDER BY plan_rows DESC, lessons DESC, t.tutor_id
        LIMIT 1
    """).bindparams(_expanding("exclude"))
    row = db.execute(query, {"year": academic_year, "study_year": study_year, "exclude": sorted(exclude) or [0]}).mappings().first()
    return dict(row) if row else None


def _pick_committee_member(db: Session) -> Optional[dict]:
    """Член действующего комитета с назначениями на проверку в 1-м семестре."""
    row = db.execute(text(f"""
        SELECT t.tutor_id, t.login, t.full_name, c.FacultyID AS faculty_id, COUNT(a.id) AS assigned
        FROM committee_members m
        JOIN committee_orders o ON o.id = m.order_id AND o.is_active = 1
        JOIN tutors t ON t.tutor_id = m.tutor_id
        LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        JOIN committee_assignments a ON a.order_id = o.id AND a.inspector_tutor_id = m.tutor_id AND a.term = 1
        WHERE t.login IS NOT NULL AND {_no_account('t.login')}
        GROUP BY t.tutor_id, t.login, t.full_name, c.FacultyID
        ORDER BY assigned DESC, t.tutor_id
        LIMIT 1
    """)).mappings().first()
    return dict(row) if row else None


def _pick_student(db: Session) -> Optional[dict]:
    """Обучающийся, у потоков которого больше всего пар в аудиториях (есть что отмечать по QR)."""
    row = db.execute(text(f"""
        SELECT s.student_id, s.login, s.full_name, s.group_name, COUNT(l.id) AS lessons
        FROM platonus_students s
        JOIN schedule_group_students g ON g.student_id = s.student_id
        JOIN schedule_lessons l ON l.study_group_id = g.study_group_id AND l.platonus_auditory_id IS NOT NULL
        WHERE s.login <> '' AND s.student_id > 0 AND {_no_account('s.login')}
        GROUP BY s.student_id, s.login, s.full_name, s.group_name
        ORDER BY lessons DESC, s.student_id
        LIMIT 1
    """)).mappings().first()
    return dict(row) if row else None


def personas(db: Session) -> dict:
    """Персонажи для ролей teacher / user / committee / student. Выбираются один раз и запоминаются."""
    stored = db.execute(text("SELECT value_text FROM system_settings WHERE `key` = :key"), {"key": PERSONAS_KEY}).scalar()
    if stored:
        return json.loads(stored)
    today = schedule_service.now_local().date()
    year, study_year = _academic_year(today), schedule_service.study_year_for(today)
    result: dict = {}
    teacher = _pick_visitor(db, year, study_year, set())
    if teacher:
        result["teacher"] = teacher
        user = _pick_visitor(db, year, study_year, {teacher["tutor_id"]})
        if user:
            result["user"] = user
    member = _pick_committee_member(db)
    if member:
        result["committee"] = member
    student = _pick_student(db)
    if student:
        result["student"] = student
    for person in result.values():
        person["username"] = person["login"].strip().lower()
        for extra in ("plan_rows", "lessons", "assigned"):
            person.pop(extra, None)
    db.execute(text("""
        INSERT INTO system_settings (`key`, value_text) VALUES (:key, :value)
        ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)
    """), {"key": PERSONAS_KEY, "value": json.dumps(result, ensure_ascii=False)})
    db.commit()
    return result


# ——— занятия по расписанию за прошедшие дни ———

class _Lessons:
    """Занятия прошедших учебных дней (по расписанию Platonus) в аудиториях, с кешем по дате."""

    def __init__(self, db: Session, days: int = 50):
        today = schedule_service.now_local().date()
        self.db = db
        self.dates = [today - timedelta(days=n) for n in range(1, days) if (today - timedelta(days=n)).isoweekday() <= 5]
        self._cache: dict[date, list] = {}

    def on(self, day: date) -> list[dict]:
        if day not in self._cache:
            self._cache[day] = [l for l in schedule_service.lessons_for_date(self.db, day)["lessons"] if not l["online"]]
        return self._cache[day]

    def find(self, match, count: int, used: set) -> list[tuple[date, dict]]:
        """По одному подходящему занятию на день, начиная со вчерашнего."""
        found = []
        for day in self.dates:
            for lesson in self.on(day):
                if lesson["id"] not in used and match(lesson):
                    found.append((day, lesson))
                    used.add(lesson["id"])
                    break
            if len(found) >= count:
                break
        return found


def _utc(day: date, hhmm: str) -> datetime:
    """Записи КРК и отзывы хранят время в UTC (интерфейс показывает UTC+5)."""
    hours, minutes = map(int, hhmm.split(":"))
    return datetime.combine(day, time(hours, minutes)) - UTC_PLUS_5


def _record_lesson_type(schedule_type: str) -> str:
    value = (schedule_type or "").lower()
    if "лекц" in value:
        return "Лекция"
    if "лаборатор" in value:
        return "Лабораторная"
    if "физ" in value:
        return "Физическая культура"
    return "Практика"


def _peer_lesson_type(schedule_type: Optional[str]) -> str:
    value = (schedule_type or "").lower()
    if "лекц" in value:
        return "lecture"
    if "лаборатор" in value:
        return "laboratory"
    return "practical"


# ——— записи КРК ———

def _record(db: Session, rng: random.Random, day: date, lesson: dict, author: str, status: str, academic_year: str,
            problem: bool = False) -> Record:
    template = rating_templates.require_template(db, academic_year)
    lesson_type = _record_lesson_type(lesson["lesson_type"])
    low, high = ((template.scale_min, max(template.scale_min, template.scale_max // 2)) if problem
                 else (max(template.scale_min, template.scale_max - 3), template.scale_max))
    ratings = {code: rng.randint(low, high) for code in rating_templates.question_codes(template, lesson_type)}
    plan = max(int(lesson["students_count"] or 0), 10)
    fact = max(1, int(plan * (rng.uniform(0.3, 0.5) if problem else rng.uniform(0.75, 1.0))))
    data = RecordCreate(
        teacher=lesson["teacher"], subject=lesson["subject"], faculty=lesson["faculty"] or "—",
        op=lesson["op"] or "—", group_name=lesson["group_name"] or lesson["study_group"] or "—",
        room=lesson["room"] or "—", lesson_type=lesson_type, format="в традиционном очном формате",
        topic=rng.choice(TOPICS), datetime=_utc(day, lesson["start_time"]), students_plan=plan, students_fact=fact,
        academic_year=academic_year, ratings=ratings,
        comment=("Низкая посещаемость и слабая вовлечённость группы." if problem
                 else "Занятие проведено по плану, материал изложен последовательно."),
    )
    record = record_service.create_record(db, data, author)
    moment = datetime.combine(day, time(12)) + timedelta(days=1)
    # Переходы статусов — как в POST /records/{id}/submit, /send-to-rework, /accept
    if status in ("submitted", "rework", "accepted"):
        record.status, record.submitted_at = "submitted", moment
    if status in ("rework", "accepted"):
        record.status, record.reviewed_by, record.reviewed_at = status, ADMIN, moment + timedelta(days=1)
    db.flush()
    _track(db, "record", record.id)
    return record


# ——— ситуационный мониторинг ———

def _checklist(outcome: str) -> dict:
    answers = {key: "yes" for key in checklist_rules.QUESTION_KEYS}
    answers["other"] = "no"
    if outcome == "violation":
        answers["teacher"] = "no"
    elif outcome == "clarification":
        answers["activity"] = "unclear"
    elif outcome == "technical":
        answers["quality"] = "no"
    return answers


def _demo_signature(signer: str, moment: datetime) -> dict:
    return {
        "subject": DEMO_SIGNATURE, "signer_name": signer, "signer_position": "",
        "issuer": "DEV", "certificate_serial": "DEV-SEED", "ocsp": "dev",
        "valid_from": moment.isoformat(), "valid_to": (moment + timedelta(days=365)).isoformat(),
    }


def _observation(db: Session, rng: random.Random, day: date, lesson: dict, observer: str, outcome: str,
                 signed: bool, response_by: Optional[str] = None, justify: bool = False) -> Violation:
    """Наблюдение по чек-листу 16-02. outcome: compliant / clarification / violation / technical;
    подписанное нарушение становится confirmed, с пояснением преподавателя — может быть снято (justified)."""
    checklist = _checklist(outcome)
    checklist_rules.validate_new(checklist, outcome, "")
    start = datetime.strptime(lesson["start_time"], "%H:%M")
    observed_from = (start + timedelta(minutes=rng.randint(5, 20))).strftime("%H:%M")
    violation = Violation(
        lesson_ref=lesson["id"], teacher=lesson["teacher"], teacher_login=lesson["teacher_login"],
        room=" · ".join(part for part in (lesson["room"], lesson["building"]) if part), camera=lesson["room"] or "",
        subject=lesson["subject"], violation_date=day, violation_type=checklist_rules.summary_type(checklist, outcome),
        description={"violation": "Преподаватель отсутствовал в аудитории в течение наблюдения.",
                     "clarification": "Учебная деятельность по видео не прослеживается — нужна сверка.",
                     "technical": "Камера показывает только часть аудитории, освещение недостаточное."}.get(outcome, ""),
        status=outcome, created_by=observer, checklist=checklist,
        scheduled_time=f"{lesson['start_time']}–{lesson['end_time']}", observed_from=observed_from,
        observed_to=(datetime.strptime(observed_from, "%H:%M") + timedelta(minutes=1)).strftime("%H:%M"),
        group_name=lesson["group_name"] or lesson["study_group"] or "",
        tech_ticket="DEV-001" if outcome == "technical" else "",
    )
    moment = datetime.combine(day, time(10)).replace(tzinfo=timezone.utc)
    if outcome == "violation":
        violation.reviewed_by, violation.reviewed_at = observer, moment
    violation.faculty_id = teacher_faculty_id(db, violation.teacher_login, violation.teacher)
    db.add(violation)
    db.flush()
    violation.document_hash = document_hash(db, violation)
    if signed:
        signer = db.execute(text("SELECT display_name FROM users WHERE username = :u"), {"u": observer}).scalar() or observer
        violation.signature_info = _demo_signature(signer, moment)
        violation.signed_at = moment
        violation.verify_token = uuid.uuid4().hex
        if outcome == "violation":
            violation.status = "confirmed"
    if response_by and violation.status == "confirmed":
        body = "Занятие было перенесено в другую аудиторию по распоряжению кафедры, группа была уведомлена."
        response = ViolationResponse(
            violation_id=violation.id, kind="explanation", method="ecp", text=body,
            document_hash=hashlib.sha256(body.encode("utf-8")).hexdigest(),
            signature_info=_demo_signature(response_by, moment + timedelta(days=1)), created_by=response_by,
        )
        db.add(response)
        db.flush()
        _track(db, "violation_response", response.id)
        if justify:
            violation.status = "justified"
            violation.reviewed_by, violation.reviewed_at = observer, moment + timedelta(days=2)
            violation.review_comment = "Пояснение принято: замена аудитории подтверждена кафедрой."
    save_checklist_pdf(db, violation)
    if signed and violation.status in ("compliant", "confirmed"):
        notify_teacher(db, violation)
    _track(db, "violation", violation.id)
    return violation


# ——— взаимопосещение ———

def _peer_visit(db: Session, rng: random.Random, lessons: _Lessons, row: PeerVisitSchedule, visitor: dict,
                status: str, academic_year: str, used: set) -> PeerVisit:
    visited = (row.visited_login or "").lower()
    found = lessons.find(lambda l: (l["teacher_login"] or "").lower() == visited, 1, used) if visited else []
    day, lesson = found[0] if found else (lessons.dates[min(10, len(lessons.dates) - 1)], {})
    if not lesson and row.visited_tutor_id:
        # Занятия посещаемого за прошедшие дни уже заняты другими сидами — дисциплина и группа из его расписания
        any_lesson = (db.query(ScheduleLesson).filter(ScheduleLesson.tutor_id == row.visited_tutor_id)
                      .order_by(ScheduleLesson.study_year.desc(), ScheduleLesson.lesson_id).first())
        if any_lesson:
            lesson = {"subject": any_lesson.subject, "group_name": schedule_service.first_group(any_lesson.student_groups),
                      "students_count": any_lesson.students_count, "lesson_type": any_lesson.lesson_type,
                      "course": any_lesson.course or None, "education_level": any_lesson.education_level or None,
                      "language": any_lesson.language or None, "start_time": any_lesson.start_time.strftime("%H:%M")}
    plan = max(int(lesson.get("students_count") or 20), 5)
    data = PeerVisitCreate(
        schedule_id=row.id, datetime=_utc(day, lesson.get("start_time") or "10:00"),
        teacher=row.visited_name, department=row.cafedra_name or "—",
        faculty=FACULTY_CODE_BY_ID.get(row.faculty_id, "eb"),
        education_level=lesson.get("education_level") or "bachelor", course=lesson.get("course") or 2,
        group_name=lesson.get("group_name") or "—", students_plan=plan, students_fact=max(plan - rng.randint(0, 4), 1),
        language=lesson.get("language") or "ru", subject=lesson.get("subject") or "—",
        lesson_type=_peer_lesson_type(lesson.get("lesson_type")), topic=rng.choice(TOPICS),
        academic_year=academic_year, syllabus_compliant=True,
        ratings={code: rng.choice(("high", "high", "medium", "medium", "satisfactory")) for code in LEVEL_CRITERIA},
        strengths="Чёткая структура занятия, активное вовлечение студентов.",
        recommendations="Больше практических примеров из профессиональной области.",
        visitor_name=visitor["full_name"], visitor_position="Преподаватель",
    )
    # Роль admin — без проверки «посещающий = текущий пользователь»; автор отзыва — сам персонаж
    visit = peer_visit_service.create_visit(db, data, visitor["username"], role="admin")
    moment = datetime.combine(day, time(15))
    # Переходы статусов — как в submit_visit / review_visit
    if status in ("submitted", "rework", "accepted"):
        visit.status, visit.submitted_at = "submitted", moment
    if status in ("rework", "accepted"):
        visit.status, visit.reviewed_by, visit.reviewed_at = status, PEER_INSPECTOR, moment + timedelta(days=2)
    db.flush()
    _track(db, "peer_visit", visit.id)
    return visit


# ——— посещаемость студента ———

def _attendance(db: Session, rng: random.Random, student: dict, lessons: _Lessons) -> int:
    groups = {g for (g,) in db.query(ScheduleGroupStudent.study_group_id).filter(ScheduleGroupStudent.student_id == student["student_id"])}
    if not groups:
        return 0
    rooms = {room.platonus_auditory_id: room.id for room in db.query(Room).filter(Room.platonus_auditory_id.isnot(None))}
    marked = 0
    for day in lessons.dates[:20]:
        term = schedule_service._term_for(db, day)
        if not term:
            continue
        week = str(schedule_service.week_number(term.start_date, day))
        rows = db.query(ScheduleLesson).filter(
            ScheduleLesson.study_year == term.study_year, ScheduleLesson.term == term.term,
            ScheduleLesson.week_day == day.isoweekday(), ScheduleLesson.study_group_id.in_(groups),
            ScheduleLesson.platonus_auditory_id.isnot(None),
        ).all()
        for lesson in rows:
            # Примерно каждое седьмое занятие — пропуск
            if week not in lesson.weeks.split(",") or rng.random() > 0.85:
                continue
            mark = LessonAttendance(
                lesson_id=lesson.lesson_id, lesson_date=day, student_id=student["student_id"],
                student_login=student["username"], room_id=rooms.get(lesson.platonus_auditory_id),
                marked_at=datetime.combine(day, lesson.start_time) - UTC_PLUS_5 + timedelta(minutes=rng.randint(-8, 5)),
                ip_address="dev-seed", user_agent="dev-seed",
            )
            db.add(mark)
            db.flush()
            _track(db, "attendance", mark.id)
            marked += 1
    return marked


# ——— сборка ———

def seed_all(db: Session) -> dict:
    """Создаёт демо-данные всех ролей (один раз; повторный вызов ничего не делает)."""
    _ensure_tables(db)
    if is_seeded(db):
        return {"status": "exists"}
    # Прежний служебный dev-студент (StudentID −1) заменён персонажем из Platonus
    db.execute(text("DELETE FROM schedule_group_students WHERE student_id = -1"))
    db.execute(text("DELETE FROM platonus_students WHERE student_id = -1"))
    rng = random.Random(2026)
    today = schedule_service.now_local().date()
    year = _academic_year(today)
    people = personas(db)
    lessons = _Lessons(db)
    used: set = set()
    summary: dict = {"personas": {role: f"{p['full_name']} ({p['username']})" for role, p in people.items()}}
    faculties = [f for (f,) in db.execute(text("SELECT FacultyID FROM faculties ORDER BY FacultyID"))]
    teacher, user, member, student = (people.get(k) for k in ("teacher", "user", "committee", "student"))
    persona_logins = {p["login"].lower() for p in (teacher, user, member) if p}
    # Уведомления, которые создаст сид (преподавателям о подписанных наблюдениях), — с id больше этого
    last_notification = db.execute(text("SELECT COALESCE(MAX(id), 0) FROM notifications")).scalar()

    def of_faculty(faculty_id):
        """Записи КРК деканат видит по факультету группы (records.faculty)."""
        return lambda l: l["faculty_id"] == faculty_id and (l["teacher_login"] or "").lower() not in persona_logins

    def of_teacher_faculty(faculty_id):
        """Наблюдения деканат видит по факультету преподавателя (кафедра в Platonus)."""
        return lambda l: (l["teacher_faculty_id"] == faculty_id and l["teacher_login"]
                          and l["teacher_login"].lower() not in persona_logins)

    def of_teacher(login):
        return lambda l: (l["teacher_login"] or "").lower() == login.lower()

    # Записи КРК: инспектор — во всех статусах (и проблемная) по всем факультетам; сотрудник — две
    records = 0
    plan = (("accepted", False), ("accepted", True), ("submitted", False), ("rework", False), ("draft", False), ("accepted", False))
    for index, faculty_id in enumerate(faculties * 2):
        for day, lesson in lessons.find(of_faculty(faculty_id), 1, used):
            status, problem = plan[index % len(plan)]
            _record(db, rng, day, lesson, INSPECTOR, status, year, problem)
            records += 1
    for status in ("submitted", "draft"):
        for day, lesson in lessons.find(lambda l: l["faculty_id"] in faculties, 1, used):
            _record(db, rng, day, lesson, STAFF, status, year)
            records += 1

    # Член комитета: записи о назначенных ему преподавателях — «Проверено» в «Мне назначено проверить»
    if member:
        assigned = db.execute(text("""
            SELECT t.login FROM committee_assignments a
            JOIN committee_orders o ON o.id = a.order_id AND o.is_active = 1
            JOIN tutors t ON t.tutor_id = a.teacher_tutor_id
            WHERE a.inspector_tutor_id = :id AND a.term = 1 AND t.login IS NOT NULL ORDER BY a.id
        """), {"id": member["tutor_id"]}).scalars().all()
        statuses = ["accepted", "submitted", "draft"]
        for login in assigned:
            if not statuses:
                break
            for day, lesson in lessons.find(of_teacher(login), 1, used):
                _record(db, rng, day, lesson, member["username"], statuses.pop(0), year)
                records += 1
    summary["records"] = records

    # Наблюдения на занятиях преподавателя-персонажа: подписанные он видит в «Моих нарушениях»
    observations = 0
    if teacher:
        cases = (("violation", True, True, False), ("violation", True, True, True),
                 ("compliant", True, False, False), ("clarification", False, False, False))
        for (day, lesson), (outcome, signed, respond, justify) in zip(lessons.find(of_teacher(teacher["login"]), 4, used), cases):
            _observation(db, rng, day, lesson, ADMIN, outcome, signed, teacher["username"] if respond else None, justify)
            observations += 1
    if user:
        for day, lesson in lessons.find(of_teacher(user["login"]), 1, used):
            _observation(db, rng, day, lesson, ADMIN, "compliant", True)
            observations += 1
    # По факультетам — для деканатов: ожидает подписи, требует уточнения, технический сбой, без замечаний
    for faculty_id in faculties:
        cases = (("violation", False), ("clarification", False), ("technical", True), ("compliant", True))
        for (day, lesson), (outcome, signed) in zip(lessons.find(of_teacher_faculty(faculty_id), 4, used), cases):
            _observation(db, rng, day, lesson, f"dev.dean.{faculty_id}", outcome, signed)
            observations += 1
    summary["observations"] = observations

    # Взаимопосещение: отзывы персонажей по их строкам графика в разных статусах
    visits = 0
    for person, statuses in ((teacher, ("accepted", "submitted", "draft")), (user, ("rework", "submitted"))):
        if not person:
            continue
        rows = (db.query(PeerVisitSchedule)
                .filter(PeerVisitSchedule.visitor_tutor_id == person["tutor_id"], PeerVisitSchedule.academic_year == year)
                .filter(~PeerVisitSchedule.id.in_(db.query(PeerVisit.schedule_id).filter(PeerVisit.schedule_id.isnot(None))))
                .order_by(PeerVisitSchedule.month, PeerVisitSchedule.id).all())
        for row, status in zip(rows, statuses):
            _peer_visit(db, rng, lessons, row, person, status, year, used)
            visits += 1
    summary["peer_visits"] = visits

    # Посещаемость студента по QR за последние учебные дни
    summary["attendance"] = _attendance(db, rng, student, lessons) if student else 0

    for (notification_id,) in db.execute(text("SELECT id FROM notifications WHERE id > :id"), {"id": last_notification}):
        _track(db, "notification", notification_id)
    _track(db, "seeded", 1)
    db.commit()
    return {"status": "created", **summary}


def clear(db: Session) -> dict:
    """Удаляет только созданное сидом (по dev_seed_items), уведомления и учётные записи персонажей."""
    _ensure_tables(db)
    removed = {}
    violation_ids = _tracked(db, "violation")
    acts = [name for (name,) in db.query(Violation.act_filename)
            .filter(Violation.id.in_(violation_ids), Violation.act_filename.isnot(None))] if violation_ids else []
    for kind, model in (("violation_response", ViolationResponse), ("violation", Violation), ("peer_visit", PeerVisit),
                        ("record", Record), ("attendance", LessonAttendance), ("notification", Notification)):
        ids = _tracked(db, kind)
        removed[kind] = db.query(model).filter(model.id.in_(ids)).delete(synchronize_session=False) if ids else 0
    stored = db.execute(text("SELECT value_text FROM system_settings WHERE `key` = :key"), {"key": PERSONAS_KEY}).scalar()
    people = json.loads(stored) if stored else {}
    usernames = sorted({p["username"] for p in people.values()})
    if usernames:
        # Только учётные записи, которые создал быстрый вход (персонажи выбираются без своих аккаунтов)
        removed["accounts"] = db.execute(
            text("DELETE FROM users WHERE username IN :logins AND auth_source = 'dev_quick_login'").bindparams(_expanding("logins")),
            {"logins": usernames},
        ).rowcount
    db.execute(text("DELETE FROM dev_seed_items"))
    db.execute(text("DELETE FROM system_settings WHERE `key` = :key"), {"key": PERSONAS_KEY})
    db.commit()
    for name in acts:
        try:
            os.remove(os.path.join(act_dir(), name))
        except OSError:
            pass
    return removed
