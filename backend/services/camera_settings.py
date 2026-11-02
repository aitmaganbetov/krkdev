"""Настройки трансляций камер: лимит одновременных live-трансляций (system_settings)."""
import os

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

LIVE_MAX_STREAMS_KEY = "camera_live_max_streams"
LIVE_MAX_STREAMS_RANGE = (1, 20)

# Процессы ffmpeg идущих трансляций (routers/rooms.py); один процесс uvicorn — счёт общий для всех
live_streams: set = set()


def active_live_streams() -> int:
    live_streams.difference_update({p for p in live_streams if p.returncode is not None})
    return len(live_streams)


def default_live_max_streams() -> int:
    """Значение из окружения (CAMERA_LIVE_MAX_STREAMS), пока в настройках системы ничего не сохранено."""
    try:
        return int(os.getenv("CAMERA_LIVE_MAX_STREAMS", "3") or 3)
    except ValueError:
        return 3


def get_live_max_streams(db: Session) -> int:
    try:
        value = db.execute(
            text("SELECT value_text FROM system_settings WHERE `key` = :key LIMIT 1"), {"key": LIVE_MAX_STREAMS_KEY}
        ).scalar()
    except SQLAlchemyError:
        db.rollback()
        value = None
    try:
        return int(value) if value is not None else default_live_max_streams()
    except ValueError:
        return default_live_max_streams()


def save_live_max_streams(db: Session, value: int) -> None:
    db.execute(
        text("""
            INSERT INTO system_settings (`key`, value_text) VALUES (:key, :value)
            ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)
        """),
        {"key": LIVE_MAX_STREAMS_KEY, "value": str(value)},
    )
    db.commit()
