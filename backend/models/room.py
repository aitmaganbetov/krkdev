from sqlalchemy import Boolean, Column, DateTime, Integer, Numeric, String, Text
from sqlalchemy.sql import func

from database import Base


class Room(Base):
    __tablename__ = "rooms"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Номера повторяются в разных корпусах Platonus (и даже внутри одного), поэтому имя не уникально
    name = Column(String(100), nullable=False, index=True)
    building = Column(String(150), nullable=False, default="")
    floor = Column(String(30), nullable=False, default="")
    capacity = Column(Integer, nullable=False, default=0)
    area = Column(Numeric(10, 2), nullable=False, default=0)  # площадь, м² (auditories.area в Platonus)
    equipment = Column(Text, nullable=False, default="")
    notes = Column(Text, nullable=False, default="")
    # Аудитория Platonus (auditories.auditoryID); NULL — кабинет заведён вручную
    platonus_auditory_id = Column(Integer, nullable=True, unique=True)
    room_type = Column(String(255), nullable=False, default="")
    # Код в QR на двери аудитории (/room/<код>): случайный, чтобы адреса кабинетов нельзя было перебрать
    qr_code = Column(String(32), nullable=True, unique=True)
    camera_enabled = Column(Boolean, nullable=False, default=False)
    camera_api_url = Column(String(1000), nullable=False, default="")
    camera_stream_url = Column(String(1000), nullable=False, default="")
    camera_username = Column(String(255), nullable=False, default="")
    camera_api_key_encrypted = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
