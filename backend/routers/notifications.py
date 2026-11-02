from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from services import get_current_user_context
from services import notification_service as service

# Уведомления текущего пользователя (колокольчик в шапке)
router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: int
    kind: str
    title: str
    body: str
    link: Optional[str] = None
    read_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class NotificationListOut(BaseModel):
    unread: int
    items: list[NotificationOut]


@router.get("", response_model=NotificationListOut)
def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    unread, items = service.list_notifications(db, context["username"], limit=limit)
    return NotificationListOut(unread=unread, items=items)


@router.post("/read-all")
def read_all_notifications(
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    return {"updated": service.mark_all_read(db, context["username"])}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def read_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(get_current_user_context),
):
    return service.mark_read(db, notification_id, context["username"])
