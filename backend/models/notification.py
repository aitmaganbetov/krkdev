from database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func


class Notification(Base):
    """Уведомление пользователю в интерфейсе (колокольчик в шапке)."""

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Логин получателя в нижнем регистре, без домена (как tutors.login / users.username)
    recipient = Column(String(255), nullable=False, index=True)
    # Тип события, например violation.confirmed
    kind = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False, default="")
    # Маршрут фронтенда, куда ведёт уведомление
    link = Column(String(255), nullable=True)
    read_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False, index=True)
