from database import Base
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, JSON
from sqlalchemy.sql import func


class Record(Base):
    __tablename__ = "records"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    teacher = Column(String(255), nullable=False, index=True)
    subject = Column(String(255), nullable=False, index=True)
    faculty = Column(String(255), nullable=False)
    op = Column(String(255), nullable=False, index=True)
    group_name = Column(String(100), nullable=False, index=True)
    room = Column(String(100), nullable=False)
    lesson_type = Column(String(100), nullable=False)
    format = Column(String(100), nullable=False)
    topic = Column(Text, nullable=False)
    datetime = Column(DateTime, nullable=False)
    students_plan = Column(Integer, nullable=False)
    students_fact = Column(Integer, nullable=False)
    attendance = Column(Float, nullable=False, default=0.0)
    academic_year = Column(String(20), nullable=False)

    # JSON: {"1.1": 8, "1.2": 7, ..., "3.4": 9}
    ratings = Column(JSON, nullable=False, default=dict)

    score = Column(Float, nullable=False, default=0.0)
    # Status values: draft, submitted, rework, accepted
    status = Column(String(50), nullable=False, default="draft")
    comment = Column(Text, nullable=True)
    submitted_by = Column(String(255), nullable=True, index=True)
    submitted_at = Column(DateTime, nullable=True)
    
    # For admin/inspector actions
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)
