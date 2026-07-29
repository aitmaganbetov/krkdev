from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func

from database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True, index=True)
    building = Column(String(150), nullable=False, default="")
    floor = Column(String(30), nullable=False, default="")
    capacity = Column(Integer, nullable=False, default=0)
    equipment = Column(Text, nullable=False, default="")
    notes = Column(Text, nullable=False, default="")
    camera_enabled = Column(Boolean, nullable=False, default=False)
    camera_api_url = Column(String(1000), nullable=False, default="")
    camera_stream_url = Column(String(1000), nullable=False, default="")
    camera_username = Column(String(255), nullable=False, default="")
    camera_api_key_encrypted = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
