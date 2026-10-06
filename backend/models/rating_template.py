from sqlalchemy import Column, DateTime, Float, Integer, JSON, String
from sqlalchemy.sql import func

from database import Base


class RatingTemplate(Base):
    """Справочник вопросов оценки и правил расчёта на один учебный год."""

    __tablename__ = "rating_templates"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year = Column(String(20), nullable=False, unique=True, index=True)
    scale_min = Column(Integer, nullable=False, default=1)
    scale_max = Column(Integer, nullable=False, default=10)
    # average | weighted | sections | sum
    calc_method = Column(String(30), nullable=False, default="average")
    problem_score_below = Column(Float, nullable=False, default=5.0)
    problem_attendance_below = Column(Float, nullable=False, default=40.0)
    # {"ru": "...", "kk": "...", "en": "..."}
    note = Column(JSON, nullable=False, default=dict)
    # [{"code": "1", "title": {...}, "weight": 1,
    #   "questions": [{"code": "1.1", "text": {...}, "report_title": "", "weight": 1}]}]
    sections = Column(JSON, nullable=False, default=list)
    updated_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
