from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, field_validator
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db
from models.rating_template import RatingTemplate
from models.record import Record
from routers.rating_templates import _validate_year
from services import ROLE_ADMIN, get_current_user_context, require_roles
from services.audit_log import audit_event
from services.request_meta import get_client_ip

router = APIRouter(prefix="/academic-years", tags=["academic-years"])

DEFAULT_SETTING_KEY = "default_academic_year"


class AcademicYearIn(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        return _validate_year(value)


class AcademicYearOut(BaseModel):
    name: str
    records_count: int
    has_template: bool
    # Год, который подставляется в новую запись
    is_default: bool = False
    # Год выбран администратором явно (иначе — текущий по дате)
    default_is_manual: bool = False


def _current_by_date(today: date | None = None) -> str:
    """Учебный год начинается 1 сентября."""
    today = today or date.today()
    start = today.year if today.month >= 9 else today.year - 1
    return f"{start}-{start + 1}"


def _manual_default(db: Session) -> str | None:
    value = db.execute(
        text("SELECT value_text FROM system_settings WHERE `key` = :key LIMIT 1"), {"key": DEFAULT_SETTING_KEY}
    ).scalar()
    return (value or "").strip() or None


def _set_manual_default(db: Session, name: str | None) -> None:
    if name:
        db.execute(
            text("""
                INSERT INTO system_settings (`key`, value_text) VALUES (:key, :value)
                ON DUPLICATE KEY UPDATE value_text = :value
            """),
            {"key": DEFAULT_SETTING_KEY, "value": name},
        )
    else:
        db.execute(text("DELETE FROM system_settings WHERE `key` = :key"), {"key": DEFAULT_SETTING_KEY})


def _list(db: Session) -> list[AcademicYearOut]:
    names = db.execute(text("SELECT name FROM academic_years")).scalars().all()
    counts = dict(db.query(Record.academic_year, func.count(Record.id)).group_by(Record.academic_year).all())
    templates = {year for (year,) in db.query(RatingTemplate.academic_year).all()}
    # Год мог попасть в записи или справочник в обход списка — показываем и его
    all_names = set(names) | set(counts) | templates
    manual = _manual_default(db)
    if manual in all_names:
        default, is_manual = manual, True
    else:
        current = _current_by_date()
        default, is_manual = (current if current in all_names else None), False
    return [
        AcademicYearOut(
            name=name,
            records_count=int(counts.get(name, 0)),
            has_template=name in templates,
            is_default=name == default,
            default_is_manual=is_manual,
        )
        for name in sorted((n for n in all_names if n), reverse=True)
    ]


@router.get("", response_model=list[AcademicYearOut])
def list_academic_years(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(get_current_user_context),
):
    return _list(db)


@router.post("", response_model=AcademicYearOut, status_code=201)
def create_academic_year(
    body: AcademicYearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    exists = db.execute(text("SELECT 1 FROM academic_years WHERE name = :name"), {"name": body.name}).first()
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Учебный год {body.name} уже есть")
    db.execute(text("INSERT INTO academic_years (name) VALUES (:name)"), {"name": body.name})
    db.commit()
    audit_event(
        action="admin.academic_years.create",
        outcome="success",
        actor=current_user["username"],
        details={"name": body.name},
        db=db,
        ip_address=get_client_ip(request),
    )
    return next(item for item in _list(db) if item.name == body.name)


@router.delete("/{name}", status_code=204)
def delete_academic_year(
    name: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    item = next((item for item in _list(db) if item.name == name), None)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Учебный год не найден")
    if item.records_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Нельзя удалить: по учебному году {name} есть записи ({item.records_count})",
        )
    if item.has_template:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Нельзя удалить: для {name} заведены вопросы. Сначала удалите их во вкладке «Вопросы»",
        )
    db.execute(text("DELETE FROM academic_years WHERE name = :name"), {"name": name})
    if _manual_default(db) == name:
        _set_manual_default(db, None)
    db.commit()
    audit_event(
        action="admin.academic_years.delete",
        outcome="success",
        actor=current_user["username"],
        details={"name": name},
        db=db,
        ip_address=get_client_ip(request),
    )
    return Response(status_code=204)


class DefaultYearIn(BaseModel):
    # None — снова считать текущим год по дате
    name: str | None = None


@router.put("/default", response_model=list[AcademicYearOut])
def set_default_academic_year(
    body: DefaultYearIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    if body.name and body.name not in {item.name for item in _list(db)}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Учебный год не найден")
    _set_manual_default(db, body.name)
    db.commit()
    audit_event(
        action="admin.academic_years.default",
        outcome="success",
        actor=current_user["username"],
        details={"name": body.name},
        db=db,
        ip_address=get_client_ip(request),
    )
    return _list(db)
