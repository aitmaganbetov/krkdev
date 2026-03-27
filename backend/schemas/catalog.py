from pydantic import BaseModel


class TeacherOption(BaseModel):
    id: int
    full_name: str


class GroupOption(BaseModel):
    id: int
    name: str


class SpecializationOption(BaseModel):
    id: int
    name_ru: str
    name_kz: str | None = None
    name_en: str | None = None
    code: str | None = None
    groups: list[GroupOption] = []


class FacultyOption(BaseModel):
    id: int
    name_ru: str
    name_kz: str | None = None
    name_en: str | None = None
    specializations: list[SpecializationOption] = []


class BasicInfoCatalogOut(BaseModel):
    teachers: list[TeacherOption]
    faculties: list[FacultyOption]
    academic_years: list[str]