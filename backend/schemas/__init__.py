from schemas.record import RecordOut, RecordListOut, RecordCreate, RecordUpdate, DashboardStats
from schemas.auth import LoginRequest, TokenOut
from schemas.catalog import (
    BasicInfoCatalogOut,
    FacultyOption,
    GroupOption,
    SpecializationOption,
    TeacherOption,
)

__all__ = [
    "RecordOut", "RecordListOut", "RecordCreate", "RecordUpdate",
    "DashboardStats", "LoginRequest", "TokenOut",
    "BasicInfoCatalogOut", "FacultyOption", "SpecializationOption", "GroupOption", "TeacherOption",
]
