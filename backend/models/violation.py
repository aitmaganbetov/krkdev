from sqlalchemy import Column, Date, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from database import Base


class Violation(Base):
    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_ref = Column(String(100), nullable=False, index=True)
    teacher = Column(String(255), nullable=False, index=True)
    room = Column(String(255), nullable=False, default="")
    subject = Column(String(255), nullable=False, default="")
    violation_type = Column(String(150), nullable=False, index=True)
    violation_date = Column(Date, nullable=False, index=True)
    description = Column(Text, nullable=False, default="")
    status = Column(String(30), nullable=False, default="pending", index=True)
    created_by = Column(String(255), nullable=False)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comment = Column(Text, nullable=False, default="")
    act_filename = Column(String(255), nullable=True)
    act_uploaded_by = Column(String(255), nullable=True)
    act_uploaded_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
