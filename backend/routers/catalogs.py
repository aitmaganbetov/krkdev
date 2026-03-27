from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from schemas.catalog import BasicInfoCatalogOut
from services import get_current_user

router = APIRouter(prefix="/catalogs", tags=["catalogs"])


@router.get("/basic-info", response_model=BasicInfoCatalogOut)
def get_basic_info_catalog(
    db: Session = Depends(get_db),
    _: str = Depends(get_current_user),
):
    try:
        db.execute(text("""
            CREATE TABLE IF NOT EXISTS academic_years (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(20) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        db.execute(
            text("INSERT IGNORE INTO academic_years (name) VALUES (:name1), (:name2)"),
            {"name1": "2025-2026", "name2": "2026-2027"},
        )
        db.commit()

        teachers_rows = db.execute(text("""
            SELECT tutor_id, full_name
            FROM tutors
            WHERE has_access = 1
              AND COALESCE(full_name, '') <> ''
            ORDER BY full_name
        """)).mappings().all()

        academic_year_rows = db.execute(text("""
            SELECT name
            FROM academic_years
            ORDER BY name
        """)).mappings().all()

        rows = db.execute(text("""
            SELECT
                f.FacultyID AS faculty_id,
                f.facultyNameRU AS faculty_name_ru,
                f.facultyNameKZ AS faculty_name_kz,
                f.facultyNameEN AS faculty_name_en,
                s.id AS specialization_id,
                s.nameru AS specialization_name_ru,
                s.namekz AS specialization_name_kz,
                s.nameen AS specialization_name_en,
                s.specializationCode AS specialization_code,
                g.groupID AS group_id,
                g.name AS group_name
            FROM faculties f
            LEFT JOIN specializations s
                ON s.faculty_id = f.FacultyID
                AND s.is_default = 0
                AND s.deleted IS NULL
            LEFT JOIN `groups` g ON g.specializationID = s.id
            ORDER BY f.FacultyID, s.id, g.groupID
        """)).mappings().all()
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Справочники не готовы. Сначала выполните импорт faculties/specializations/groups/tutors.",
        ) from exc

    faculties: OrderedDict[int, dict] = OrderedDict()

    for row in rows:
        faculty_id = row["faculty_id"]
        faculty = faculties.setdefault(
            faculty_id,
            {
                "id": faculty_id,
                "name_ru": row["faculty_name_ru"] or "",
                "name_kz": row["faculty_name_kz"],
                "name_en": row["faculty_name_en"],
                "specializations": OrderedDict(),
            },
        )

        specialization_id = row["specialization_id"]
        if specialization_id is None:
            continue

        specialization = faculty["specializations"].setdefault(
            specialization_id,
            {
                "id": specialization_id,
                "name_ru": row["specialization_name_ru"] or "",
                "name_kz": row["specialization_name_kz"],
                "name_en": row["specialization_name_en"],
                "code": row["specialization_code"],
                "groups": [],
            },
        )

        if row["group_id"] is not None:
            specialization["groups"].append(
                {"id": row["group_id"], "name": row["group_name"] or ""}
            )

    result = []
    for faculty in faculties.values():
        result.append(
            {
                "id": faculty["id"],
                "name_ru": faculty["name_ru"],
                "name_kz": faculty["name_kz"],
                "name_en": faculty["name_en"],
                "specializations": list(faculty["specializations"].values()),
            }
        )

    teachers = [
        {"id": row["tutor_id"], "full_name": row["full_name"]}
        for row in teachers_rows
    ]

    academic_years = [row["name"] for row in academic_year_rows]

    return {"teachers": teachers, "faculties": result, "academic_years": academic_years}