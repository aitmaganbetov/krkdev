from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from database import get_db
from services import ROLE_ADMIN, ROLE_COMMITTEE, ROLE_DEAN, ROLE_INSPECTOR, ROLE_PEER_INSPECTOR, ROLE_STAFF, require_roles
from services.faculty_scope import dean_faculty_id
from services import schedule_service as service
from services.audit_log import audit_event

router = APIRouter(prefix="/schedule", tags=["schedule"])


@router.get("/lessons")
def list_lessons(
    day: Optional[date] = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    # Расписание открыто тем, кто создаёт по занятию запись КРК или отзыв о взаимопосещении;
    # деканат видит занятия своего факультета
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_COMMITTEE, ROLE_DEAN)),
):
    """Занятия по расписанию Platonus на дату (по умолчанию — сегодня по UTC+5)."""
    now = service.now_local()
    target = day or now.date()
    # Мониторинг смотрит текущий учебный год — его расписание держим свежим без ручного импорта
    service.sync_in_background_if_stale(service.study_year_for(now.date()))
    result = service.lessons_for_date(db, target)
    faculty_id = dean_faculty_id(context)
    if faculty_id is not None:
        result["lessons"] = [lesson for lesson in result["lessons"] if service.lesson_in_faculty(lesson, faculty_id)]
    result["now"] = now.strftime("%Y-%m-%dT%H:%M:%S")
    # В ответе только строки и числа: готовый JSONResponse даёт те же байты без обхода jsonable_encoder
    # (на ~900 занятиях дня он занимал больше половины времени запроса)
    return JSONResponse(result)


@router.post("/platonus-sync")
def sync_schedule(
    study_year: Optional[int] = Query(default=None, ge=2018, le=2100),
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    year = study_year or service.study_year_for(service.now_local().date())
    result = service.sync_schedule_from_platonus(db, year)
    if result["status"] != "success":
        raise HTTPException(status_code=502, detail=result["message"])
    audit_event(
        "admin.schedule.platonus_sync",
        actor=context.get("username"),
        details={key: result[key] for key in ("study_year", "lessons", "by_term", "unpublished", "skipped")},
        db=db,
    )
    return result
