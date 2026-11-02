from database import Base
from sqlalchemy import Boolean, Column, Integer, String, Float, Text, DateTime, JSON
from sqlalchemy.sql import func


class PeerVisit(Base):
    """Отзыв о взаимопосещении занятия (форма «Отзыв о взаимопосещении занятия»)."""

    __tablename__ = "peer_visits"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Строка графика взаимопосещения (peer_visit_schedule.id), по которой заполнен отзыв
    schedule_id = Column(Integer, nullable=True, unique=True)

    # Сведения о занятии
    datetime = Column(DateTime, nullable=False)
    teacher = Column(String(255), nullable=False, index=True)
    department = Column(String(255), nullable=False)
    # Коды: eb — Экономика и бизнес, tf — Технологический, iit — Инжиниринг и ИТ
    faculty = Column(String(20), nullable=False, index=True)
    # bachelor, master
    education_level = Column(String(20), nullable=False)
    course = Column(Integer, nullable=False)
    group_name = Column(String(100), nullable=False, index=True)
    students_plan = Column(Integer, nullable=False)
    students_fact = Column(Integer, nullable=False)
    attendance = Column(Float, nullable=False, default=0.0)
    # kz, ru, en
    language = Column(String(20), nullable=False)
    subject = Column(String(255), nullable=False, index=True)
    # lecture, practical, laboratory, studio
    lesson_type = Column(String(20), nullable=False)
    topic = Column(Text, nullable=False)
    academic_year = Column(String(20), nullable=False, index=True)

    # Оценка: п.1 — соответствие Syllabus, п.2–5, 7, 9, 10 — уровень (high..fail)
    syllabus_compliant = Column(Boolean, nullable=False, default=True)
    # JSON: {"2": "high", "3": "medium", ...}
    ratings = Column(JSON, nullable=False, default=dict)
    technologies_used = Column(Text, nullable=True)  # п.6
    methods_used = Column(Text, nullable=True)  # п.8
    # Средний балл уровней по шкале 1–5 (high = 5 ... fail = 1)
    score = Column(Float, nullable=False, default=0.0)
    # Не соответствует Syllabus или есть критерий ниже удовлетворительного
    is_problem = Column(Boolean, nullable=False, default=False)

    # Комментарии по результатам посещения
    strengths = Column(Text, nullable=True)
    remarks = Column(Text, nullable=True)
    recommendations = Column(Text, nullable=True)
    note = Column(Text, nullable=True)

    # Посещающий
    visitor_name = Column(String(255), nullable=False)
    visitor_position = Column(String(255), nullable=False)
    visitor_degree = Column(String(255), nullable=True)

    # draft, submitted, rework, accepted — как у записей КРК
    status = Column(String(50), nullable=False, default="draft")
    submitted_by = Column(String(255), nullable=True, index=True)
    submitted_at = Column(DateTime, nullable=True)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
