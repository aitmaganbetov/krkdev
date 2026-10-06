import re
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from database import get_db
from models.rating_template import RatingTemplate
from models.record import Record
from services import ROLE_ADMIN, get_current_user_context, require_roles
from services import rating_template_service as templates
from services.audit_log import audit_event
from services.request_meta import get_client_ip

router = APIRouter(prefix="/rating-templates", tags=["rating-templates"])

YEAR_PATTERN = re.compile(r"^(\d{4})-(\d{4})$")
CODE_PATTERN = re.compile(r"^[0-9A-Za-zА-Яа-я._-]{1,20}$")


def _validate_year(value: str) -> str:
    value = (value or "").strip()
    match = YEAR_PATTERN.match(value)
    if not match or int(match.group(2)) != int(match.group(1)) + 1:
        raise ValueError("Учебный год должен быть в формате 2026-2027")
    return value


class LocalizedText(BaseModel):
    ru: str = Field(default="", max_length=2000)
    kk: str = Field(default="", max_length=2000)
    en: str = Field(default="", max_length=2000)

    @field_validator("ru", "kk", "en")
    @classmethod
    def strip(cls, value: str) -> str:
        return value.strip()


class QuestionIn(BaseModel):
    code: str
    text: LocalizedText
    hint: LocalizedText = LocalizedText()
    report_title: str = Field(default="", max_length=2000)
    weight: float = Field(default=1, gt=0, le=100)

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip()
        if not CODE_PATTERN.match(value):
            raise ValueError("Код вопроса: до 20 символов, буквы, цифры, точка, дефис")
        return value

    @field_validator("report_title")
    @classmethod
    def strip_report_title(cls, value: str) -> str:
        return value.strip()

    @model_validator(mode="after")
    def require_text(self):
        if not self.text.ru:
            raise ValueError(f"Вопрос {self.code}: текст на русском обязателен")
        return self


class SectionIn(BaseModel):
    code: str
    title: LocalizedText
    weight: float = Field(default=1, gt=0, le=100)
    # Пусто — раздел для всех занятий, иначе только для перечисленных видов занятия
    lesson_types: list[str] = Field(default_factory=list, max_length=30)
    questions: list[QuestionIn] = Field(min_length=1, max_length=100)

    @field_validator("lesson_types")
    @classmethod
    def clean_lesson_types(cls, value: list[str]) -> list[str]:
        cleaned = []
        for item in value:
            item = (item or "").strip()
            if len(item) > 100:
                raise ValueError("Вид занятия: не длиннее 100 символов")
            if item and item.lower() not in {c.lower() for c in cleaned}:
                cleaned.append(item)
        return cleaned

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        value = value.strip()
        if not CODE_PATTERN.match(value):
            raise ValueError("Код раздела: до 20 символов, буквы, цифры, точка, дефис")
        return value

    @model_validator(mode="after")
    def require_title(self):
        if not self.title.ru:
            raise ValueError(f"Раздел {self.code}: название на русском обязательно")
        return self


class TemplateIn(BaseModel):
    scale_min: int = Field(ge=0, le=100)
    scale_max: int = Field(ge=1, le=100)
    calc_method: Literal["average", "weighted", "sections", "sum"]
    problem_score_below: float = Field(ge=0, le=10000)
    problem_attendance_below: float = Field(ge=0, le=100)
    note: LocalizedText = LocalizedText()
    sections: list[SectionIn] = Field(min_length=1, max_length=30)

    @model_validator(mode="after")
    def validate_structure(self):
        if self.scale_min >= self.scale_max:
            raise ValueError("Минимальная оценка должна быть меньше максимальной")
        common = [s for s in self.sections if not s.lesson_types]
        modules = [s for s in self.sections if s.lesson_types]
        common_section_codes = [s.code for s in common]
        if len(common_section_codes) != len(set(common_section_codes)):
            raise ValueError("Коды общих разделов не должны повторяться")
        common_codes = [q.code for s in common for q in s.questions]
        if len(common_codes) != len(set(common_codes)):
            raise ValueError("Коды вопросов в общих разделах не должны повторяться")
        # Модули по виду занятия взаимоисключающие: в анкету попадает один, поэтому коды
        # (например E1–E3) могут повторяться между модулями, но не с общими разделами.
        seen_types: dict[str, str] = {}
        for module in modules:
            codes = [q.code for q in module.questions]
            if len(codes) != len(set(codes)) or set(codes) & set(common_codes):
                raise ValueError(f"Раздел «{module.title.ru}»: коды вопросов повторяются")
            for lesson_type in module.lesson_types:
                key = lesson_type.lower()
                if key in seen_types:
                    raise ValueError(f"Вид занятия «{lesson_type}» указан в двух разделах: «{seen_types[key]}» и «{module.title.ru}»")
                seen_types[key] = module.title.ru
        return self


class TemplateCreate(BaseModel):
    academic_year: str
    copy_from: Optional[str] = None

    @field_validator("academic_year")
    @classmethod
    def validate_year(cls, value: str) -> str:
        return _validate_year(value)


class TemplateOut(BaseModel):
    id: int
    academic_year: str
    scale_min: int
    scale_max: int
    calc_method: str
    problem_score_below: float
    problem_attendance_below: float
    note: dict
    sections: list[dict]
    max_score: float
    question_count: int
    records_count: int
    locked: bool
    updated_by: Optional[str] = None
    updated_at: Optional[datetime] = None


def _records_counts(db: Session) -> dict[str, int]:
    rows = db.query(Record.academic_year, func.count(Record.id)).group_by(Record.academic_year).all()
    return {year: int(count) for year, count in rows}


def _to_out(template: RatingTemplate, records_count: int) -> TemplateOut:
    return TemplateOut(
        id=template.id,
        academic_year=template.academic_year,
        scale_min=template.scale_min,
        scale_max=template.scale_max,
        calc_method=template.calc_method,
        problem_score_below=template.problem_score_below,
        problem_attendance_below=template.problem_attendance_below,
        note=template.note or {},
        sections=template.sections or [],
        max_score=templates.max_score(template),
        question_count=templates.questions_per_record(template),
        records_count=records_count,
        locked=records_count > 0,
        updated_by=template.updated_by,
        updated_at=template.updated_at,
    )


def _get_or_404(db: Session, academic_year: str) -> RatingTemplate:
    template = templates.get_template(db, academic_year)
    if not template:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Справочник для этого учебного года не найден")
    return template


@router.get("", response_model=list[TemplateOut])
def list_templates(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(get_current_user_context),
):
    counts = _records_counts(db)
    items = db.query(RatingTemplate).order_by(RatingTemplate.academic_year.desc()).all()
    return [_to_out(item, counts.get(item.academic_year, 0)) for item in items]


@router.get("/{academic_year}", response_model=TemplateOut)
def get_template(
    academic_year: str,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(get_current_user_context),
):
    template = _get_or_404(db, academic_year)
    return _to_out(template, _records_counts(db).get(academic_year, 0))


@router.post("", response_model=TemplateOut, status_code=201)
def create_template(
    body: TemplateCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    if templates.get_template(db, body.academic_year):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Справочник для этого учебного года уже есть")

    if body.copy_from:
        source = _get_or_404(db, body.copy_from)
        content = templates.template_content(source)
    else:
        content = templates.default_template_fields()

    template = RatingTemplate(academic_year=body.academic_year, updated_by=current_user["username"], **content)
    db.add(template)
    # Год должен появиться в выпадающем списке формы записи.
    db.execute(text("INSERT IGNORE INTO academic_years (name) VALUES (:name)"), {"name": body.academic_year})
    db.commit()
    db.refresh(template)

    audit_event(
        action="admin.rating_templates.create",
        outcome="success",
        actor=current_user["username"],
        details={"academic_year": body.academic_year, "copy_from": body.copy_from},
        db=db,
        ip_address=get_client_ip(request),
    )
    return _to_out(template, 0)


@router.put("/{academic_year}", response_model=TemplateOut)
def update_template(
    academic_year: str,
    body: TemplateIn,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    template = _get_or_404(db, academic_year)
    records_count = _records_counts(db).get(academic_year, 0)
    new_content = body.model_dump()

    if records_count and templates.structure_signature(new_content) != templates.structure_signature(templates.template_content(template)):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"По учебному году {academic_year} уже есть записи ({records_count}). "
                "Можно менять только тексты. Состав вопросов, шкалу, веса, метод расчёта и пороги "
                "изменить нельзя, иначе разойдутся старые данные."
            ),
        )

    for field, value in new_content.items():
        setattr(template, field, value)
    template.updated_by = current_user["username"]
    db.commit()
    db.refresh(template)

    audit_event(
        action="admin.rating_templates.update",
        outcome="success",
        actor=current_user["username"],
        details={"academic_year": academic_year, "locked": bool(records_count), "questions": templates.questions_per_record(template)},
        db=db,
        ip_address=get_client_ip(request),
    )
    return _to_out(template, records_count)


@router.delete("/{academic_year}", status_code=204)
def delete_template(
    academic_year: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    template = _get_or_404(db, academic_year)
    records_count = _records_counts(db).get(academic_year, 0)
    if records_count:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Нельзя удалить: по учебному году {academic_year} есть записи ({records_count})",
        )

    db.delete(template)
    db.commit()
    audit_event(
        action="admin.rating_templates.delete",
        outcome="success",
        actor=current_user["username"],
        details={"academic_year": academic_year},
        db=db,
        ip_address=get_client_ip(request),
    )
    return Response(status_code=204)
