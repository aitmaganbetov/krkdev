from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from datetime import datetime as DateTime


def _validate_ratings(v: dict) -> dict:
    # Состав вопросов и шкала зависят от учебного года и проверяются по справочнику
    # в record_service; здесь только базовая форма.
    if not v:
        raise ValueError("Ratings are required")
    return v


def _validate_non_empty_string(v: str, field_name: str) -> str:
    if not isinstance(v, str) or not v.strip():
        raise ValueError(f"{field_name} is required")
    return v.strip()


class RecordBase(BaseModel):
    teacher: str
    subject: str
    faculty: str
    op: str
    group_name: str
    room: str
    lesson_type: str
    format: str
    topic: str
    datetime: DateTime
    students_plan: int
    students_fact: int
    academic_year: str
    ratings: dict[str, int]
    comment: Optional[str] = None
    status: str = "draft"

    @field_validator("ratings")
    @classmethod
    def validate_ratings(cls, v: dict) -> dict:
        return _validate_ratings(v)

    @field_validator("students_plan", "students_fact")
    @classmethod
    def validate_positive(cls, v: int) -> int:
        if v < 0:
            raise ValueError("Student count must be non-negative")
        return v

    @model_validator(mode="after")
    def validate_student_counts(self):
        if self.students_fact > self.students_plan:
            raise ValueError("students_fact cannot be greater than students_plan")
        return self


class RecordCreate(RecordBase):
    comment: str

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, v: str) -> str:
        return _validate_non_empty_string(v, "comment")


class RecordUpdate(BaseModel):
    teacher: Optional[str] = None
    subject: Optional[str] = None
    faculty: Optional[str] = None
    op: Optional[str] = None
    group_name: Optional[str] = None
    room: Optional[str] = None
    lesson_type: Optional[str] = None
    format: Optional[str] = None
    topic: Optional[str] = None
    datetime: Optional[DateTime] = None
    students_plan: Optional[int] = None
    students_fact: Optional[int] = None
    academic_year: Optional[str] = None
    ratings: Optional[dict[str, int]] = None
    comment: Optional[str] = None
    status: Optional[str] = None

    @field_validator("ratings")
    @classmethod
    def validate_ratings(cls, v: Optional[dict[str, int]]) -> Optional[dict[str, int]]:
        if v is None:
            return v
        return _validate_ratings(v)

    @field_validator("comment")
    @classmethod
    def validate_comment(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        return _validate_non_empty_string(v, "comment")

    @model_validator(mode="after")
    def validate_student_counts(self):
        if (
            self.students_plan is not None
            and self.students_fact is not None
            and self.students_fact > self.students_plan
        ):
            raise ValueError("students_fact cannot be greater than students_plan")
        return self



class RecordOut(RecordBase):
    id: int
    attendance: float
    score: float
    is_problem: bool = False
    is_low_score: bool = False
    submitted_by: Optional[str] = None
    submitted_by_display: Optional[str] = None
    submitted_at: Optional[DateTime] = None
    reviewed_by: Optional[str] = None
    reviewed_by_display: Optional[str] = None
    reviewed_at: Optional[DateTime] = None
    created_at: DateTime

    model_config = {"from_attributes": True}


class RecordListOut(BaseModel):
    total: int
    items: list[RecordOut]


class DashboardStats(BaseModel):
    total_records: int
    avg_score: float
    avg_attendance: float
    problem_records: int
