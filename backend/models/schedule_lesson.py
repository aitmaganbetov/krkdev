from database import Base
from sqlalchemy import Boolean, Column, Date, DateTime, Integer, String, Text, Time, UniqueConstraint
from sqlalchemy.sql import func


class ScheduleLesson(Base):
    """Занятие расписания Platonus (timetable): один слот «день недели + пара» потока на семестр."""
    __tablename__ = "schedule_lessons"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id = Column(Integer, nullable=False, unique=True)  # timetable.lessonID
    study_year = Column(Integer, nullable=False, index=True)  # год начала учебного года: 2026 = 2026–2027
    term = Column(Integer, nullable=False)
    week_day = Column(Integer, nullable=False)  # 1 — понедельник
    pair_number = Column(Integer, nullable=False, default=0)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    weeks = Column(String(255), nullable=False, default="")  # номера учебных недель через запятую
    subject = Column(String(500), nullable=False, default="")
    subject_kz = Column(String(500), nullable=False, default="")
    lesson_type = Column(String(100), nullable=False, default="")
    lesson_type_kz = Column(String(100), nullable=False, default="")
    tutor_id = Column(Integer, nullable=True, index=True)
    teacher = Column(String(255), nullable=False, default="")
    teacher_login = Column(String(255), nullable=True)
    student_groups = Column(Text, nullable=False, default="")
    students_count = Column(Integer, nullable=False, default=0)
    study_group = Column(String(255), nullable=False, default="")
    study_group_id = Column(Integer, nullable=True, index=True)  # studygroups.StudyGroupID — состав в schedule_group_students
    # Для предзаполнения отзыва о взаимопосещении: курс большинства студентов потока,
    # уровень образования дисциплины (bachelor/master) и язык обучения (ru/kz/en)
    course = Column(Integer, nullable=False, default=0)
    education_level = Column(String(20), nullable=False, default="")
    language = Column(String(5), nullable=False, default="")
    platonus_auditory_id = Column(Integer, nullable=True, index=True)
    room_name = Column(String(100), nullable=False, default="")
    building = Column(String(150), nullable=False, default="")
    online = Column(Boolean, nullable=False, default=False)


class ScheduleTerm(Base):
    """Учебный семестр с импортированным расписанием: от его начала считаются недели timetable_weeks."""
    __tablename__ = "schedule_terms"
    __table_args__ = (UniqueConstraint("study_year", "term", name="uq_schedule_terms_year_term"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    study_year = Column(Integer, nullable=False)
    term = Column(Integer, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    lessons_count = Column(Integer, nullable=False, default=0)
    synced_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
