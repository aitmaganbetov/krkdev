from sqlalchemy import Column, Date, DateTime, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from database import Base


class PlatonusStudent(Base):
    """Обучающийся Platonus (students, isStudent=1): по логину вход определяется как студенческий."""
    __tablename__ = "platonus_students"

    student_id = Column(Integer, primary_key=True, autoincrement=False)
    login = Column(String(255), nullable=False, default="", index=True)
    full_name = Column(String(255), nullable=False, default="")
    group_name = Column(String(100), nullable=False, default="")
    # ИИН — для входа по ЭЦП (сопоставление с сертификатом НУЦ); наружу через API не отдаётся
    iin = Column(String(12), nullable=True, index=True)


class ScheduleGroupStudent(Base):
    """Состав учебного потока (studentstudygroup): кому можно отметиться на занятии потока."""
    __tablename__ = "schedule_group_students"

    study_group_id = Column(Integer, primary_key=True, autoincrement=False)
    student_id = Column(Integer, primary_key=True, autoincrement=False, index=True)


class LessonAttendance(Base):
    """Отметка студента на занятии по QR-коду аудитории. Снятая отметка хранится с removed_at."""
    __tablename__ = "lesson_attendance"
    __table_args__ = (UniqueConstraint("lesson_id", "lesson_date", "student_id", name="uq_lesson_attendance"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Индексы: uq_lesson_attendance (lesson_id, …) и (student_id, lesson_date) — services/db_indexes.py
    lesson_id = Column(Integer, nullable=False)  # schedule_lessons.lesson_id (timetable.lessonID)
    lesson_date = Column(Date, nullable=False, index=True)
    student_id = Column(Integer, nullable=False)
    student_login = Column(String(255), nullable=False, default="")
    room_id = Column(Integer, nullable=True)
    marked_at = Column(DateTime, server_default=func.now(), nullable=False)
    ip_address = Column(String(64), nullable=False, default="")
    user_agent = Column(Text, nullable=False, default="")
    removed_at = Column(DateTime, nullable=True)
    removed_by = Column(String(255), nullable=True)
