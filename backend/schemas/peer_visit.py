from datetime import datetime as DateTime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator

Faculty = Literal["eb", "tf", "iit"]
EducationLevel = Literal["bachelor", "master"]
Language = Literal["kz", "ru", "en"]
LessonType = Literal["lecture", "practical", "laboratory", "studio"]
Level = Literal["high", "medium", "satisfactory", "low", "fail"]

# Критерии формы с оценкой по уровню (п.1 — отдельное поле syllabus_compliant,
# п.6 и п.8 — текстовые ответы)
LEVEL_CRITERIA = ("2", "3", "4", "5", "7", "9", "10")

REQUIRED_TEXT_FIELDS = (
    "teacher", "department", "group_name", "subject", "topic",
    "academic_year", "visitor_name", "visitor_position",
)
OPTIONAL_TEXT_FIELDS = (
    "technologies_used", "methods_used", "strengths", "remarks",
    "recommendations", "note", "visitor_degree",
)


def _validate_ratings(v: dict) -> dict:
    missing = [code for code in LEVEL_CRITERIA if code not in v]
    extra = [code for code in v if code not in LEVEL_CRITERIA]
    if missing:
        raise ValueError(f"Не заполнены критерии: {', '.join(missing)}")
    if extra:
        raise ValueError(f"Неизвестные критерии: {', '.join(extra)}")
    return v


class _PeerVisitValidators(BaseModel):
    @field_validator(*REQUIRED_TEXT_FIELDS, check_fields=False)
    @classmethod
    def validate_required_text(cls, v):
        if v is None:
            return v
        if not v.strip():
            raise ValueError("Обязательное поле")
        return v.strip()

    @field_validator(*OPTIONAL_TEXT_FIELDS, check_fields=False)
    @classmethod
    def validate_optional_text(cls, v):
        if v is None:
            return v
        return v.strip() or None

    @field_validator("ratings", check_fields=False)
    @classmethod
    def validate_ratings(cls, v):
        if v is None:
            return v
        return _validate_ratings(v)

    @field_validator("course", check_fields=False)
    @classmethod
    def validate_course(cls, v):
        if v is not None and not 1 <= v <= 6:
            raise ValueError("Курс должен быть от 1 до 6")
        return v

    @field_validator("students_plan", "students_fact", check_fields=False)
    @classmethod
    def validate_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("Количество обучающихся не может быть отрицательным")
        return v

    @model_validator(mode="after")
    def validate_student_counts(self):
        plan = getattr(self, "students_plan", None)
        fact = getattr(self, "students_fact", None)
        if plan is not None and fact is not None and fact > plan:
            raise ValueError("Присутствовало больше, чем обучающихся по списку")
        return self


class PeerVisitCreate(_PeerVisitValidators):
    # Статус во входных данных не принимается: новый отзыв всегда draft
    # Строка графика, по которой заполняется отзыв (выполнение графика считается по ней)
    schedule_id: Optional[int] = None
    datetime: DateTime
    teacher: str
    department: str
    faculty: Faculty
    education_level: EducationLevel
    course: int
    group_name: str
    students_plan: int
    students_fact: int
    language: Language
    subject: str
    lesson_type: LessonType
    topic: str
    academic_year: str
    syllabus_compliant: bool
    ratings: dict[str, Level]
    technologies_used: Optional[str] = None
    methods_used: Optional[str] = None
    strengths: Optional[str] = None
    remarks: Optional[str] = None
    recommendations: Optional[str] = None
    note: Optional[str] = None
    visitor_name: str
    visitor_position: str
    visitor_degree: Optional[str] = None


class PeerVisitUpdate(_PeerVisitValidators):
    datetime: Optional[DateTime] = None
    teacher: Optional[str] = None
    department: Optional[str] = None
    faculty: Optional[Faculty] = None
    education_level: Optional[EducationLevel] = None
    course: Optional[int] = None
    group_name: Optional[str] = None
    students_plan: Optional[int] = None
    students_fact: Optional[int] = None
    language: Optional[Language] = None
    subject: Optional[str] = None
    lesson_type: Optional[LessonType] = None
    topic: Optional[str] = None
    academic_year: Optional[str] = None
    syllabus_compliant: Optional[bool] = None
    ratings: Optional[dict[str, Level]] = None
    technologies_used: Optional[str] = None
    methods_used: Optional[str] = None
    strengths: Optional[str] = None
    remarks: Optional[str] = None
    recommendations: Optional[str] = None
    note: Optional[str] = None
    visitor_name: Optional[str] = None
    visitor_position: Optional[str] = None
    visitor_degree: Optional[str] = None


class PeerVisitOut(BaseModel):
    # Без входных валидаторов и Literal: ответ не должен падать на исторических данных
    id: int
    schedule_id: Optional[int] = None
    datetime: DateTime
    teacher: str
    department: str
    faculty: str
    education_level: str
    course: int
    group_name: str
    students_plan: int
    students_fact: int
    attendance: float
    language: str
    subject: str
    lesson_type: str
    topic: str
    academic_year: str
    syllabus_compliant: bool
    ratings: dict[str, str]
    technologies_used: Optional[str] = None
    methods_used: Optional[str] = None
    score: float
    is_problem: bool = False
    strengths: Optional[str] = None
    remarks: Optional[str] = None
    recommendations: Optional[str] = None
    note: Optional[str] = None
    visitor_name: str
    visitor_position: str
    visitor_degree: Optional[str] = None
    status: str
    submitted_by: Optional[str] = None
    submitted_by_display: Optional[str] = None
    submitted_at: Optional[DateTime] = None
    reviewed_by: Optional[str] = None
    reviewed_by_display: Optional[str] = None
    reviewed_at: Optional[DateTime] = None
    created_at: DateTime

    model_config = {"from_attributes": True}


class PeerVisitListOut(BaseModel):
    total: int
    items: list[PeerVisitOut]
