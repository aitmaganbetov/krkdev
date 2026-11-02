from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models.notification import Notification
from services.record_service import _username_aliases


def normalize_login(value: Optional[str]) -> str:
    """Логин без домена в нижнем регистре: DOMAIN\\user, user@domain и user → user."""
    raw = (value or "").strip().lower()
    if "\\" in raw:
        raw = raw.split("\\", 1)[1]
    if "@" in raw:
        raw = raw.split("@", 1)[0]
    return raw


def login_aliases(username: Optional[str]) -> list[str]:
    """Все формы логина пользователя, под которыми ему могли адресовать уведомление или нарушение."""
    aliases = set(_username_aliases(username)) | {normalize_login(username)}
    return [alias for alias in aliases if alias]


def notify(db: Session, recipient: str, kind: str, title: str, body: str = "", link: Optional[str] = None) -> Optional[Notification]:
    """Добавляет уведомление в текущую транзакцию (commit — у вызывающего)."""
    login = normalize_login(recipient)
    if not login:
        return None
    notification = Notification(recipient=login, kind=kind, title=title[:255], body=body, link=link)
    db.add(notification)
    return notification


def list_notifications(db: Session, username: str, limit: int = 20) -> tuple[int, list[Notification]]:
    query = db.query(Notification).filter(Notification.recipient.in_(login_aliases(username)))
    unread = query.filter(Notification.read_at.is_(None)).count()
    items = query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).all()
    return unread, items


def mark_read(db: Session, notification_id: int, username: str) -> Notification:
    notification = (
        db.query(Notification)
        .filter(Notification.id == notification_id, Notification.recipient.in_(login_aliases(username)))
        .first()
    )
    if not notification:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Уведомление не найдено")
    if notification.read_at is None:
        notification.read_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_read(db: Session, username: str) -> int:
    count = (
        db.query(Notification)
        .filter(Notification.recipient.in_(login_aliases(username)), Notification.read_at.is_(None))
        .update({"read_at": datetime.now(timezone.utc)}, synchronize_session=False)
    )
    db.commit()
    return count
