from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.sql import func

from database import Base


class ViolationEvidence(Base):
    __tablename__ = "violation_evidence"

    id = Column(Integer, primary_key=True, autoincrement=True)
    violation_id = Column(Integer, nullable=True, index=True)
    room_id = Column(Integer, nullable=False, index=True)
    media_type = Column(String(20), nullable=False)
    filename = Column(String(255), nullable=False, unique=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
