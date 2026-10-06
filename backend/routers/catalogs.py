from collections import OrderedDict
from datetime import datetime, timezone
import os
from time import monotonic

import pymysql
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from schemas.catalog import BasicInfoCatalogOut
from migrations import get_remote_config, sync_platonus_catalogs
from services import ROLE_ADMIN, get_current_user, require_roles
from services.audit_log import audit_event

router = APIRouter(prefix="/catalogs", tags=["catalogs"])


class CatalogIntegrationItem(BaseModel):
    key: str
    label: str
    local_count: int | None = None
    remote_count: int | None = None
    status: str


class PlatonusIntegrationStatus(BaseModel):
    connected: bool
    status: str
    message: str
    database: str
    response_ms: int | None = None
    checked_at: str
    catalogs: list[CatalogIntegrationItem]


CATALOG_TABLES = (
    ("faculties", "Факультеты"),
    ("specializations", "Образовательные программы"),
    ("groups", "Группы"),
    ("tutors", "Преподаватели"),
)

REMOTE_COUNT_QUERIES = {
    "faculties": "SELECT COUNT(*) FROM faculties",
    "specializations": "SELECT COUNT(*) FROM specializations WHERE is_default = 0 AND deleted IS NULL",
    "groups": "SELECT COUNT(*) FROM `groups`",
    "tutors": "SELECT COUNT(*) FROM tutors WHERE has_access = 1",
}


def _local_catalog_counts(db: Session) -> dict[str, int | None]:
    counts = {}
    for table_name, _ in CATALOG_TABLES:
        try:
            counts[table_name] = int(
                db.execute(text(f"SELECT COUNT(*) FROM `{table_name}`")).scalar() or 0
            )
        except SQLAlchemyError:
            db.rollback()
            counts[table_name] = None
    return counts


@router.get("/platonus-status", response_model=PlatonusIntegrationStatus)
def get_platonus_integration_status(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    checked_at = datetime.now(timezone.utc).isoformat()
    local_counts = _local_catalog_counts(db)
    remote_counts: dict[str, int | None] = {key: None for key, _ in CATALOG_TABLES}
    started = monotonic()

    try:
        config = get_remote_config()
        connection = pymysql.connect(
            **config,
            connect_timeout=5,
            read_timeout=5,
            write_timeout=5,
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT DATABASE()")
                database_name = str(cursor.fetchone()[0] or config["database"])
                for table_name, _ in CATALOG_TABLES:
                    cursor.execute(REMOTE_COUNT_QUERIES[table_name])
                    remote_counts[table_name] = int(cursor.fetchone()[0] or 0)
        finally:
            connection.close()

        response_ms = round((monotonic() - started) * 1000)
        connected = True
        message = "Подключение к Platonus установлено"
    except Exception as exc:
        response_ms = round((monotonic() - started) * 1000)
        connected = False
        database_name = os.getenv("READONLY_DB_NAME", "nitro")
        if isinstance(exc, pymysql.err.OperationalError):
            message = "Нет подключения к базе Platonus. Проверьте адрес, порт и доступность сервера."
        else:
            message = "Не удалось проверить справочники Platonus"

    catalogs = []
    for table_name, label in CATALOG_TABLES:
        local_count = local_counts[table_name]
        remote_count = remote_counts[table_name]
        if not connected:
            item_status = "unavailable"
        elif local_count is None:
            item_status = "local_error"
        elif local_count == remote_count:
            item_status = "synced"
        else:
            item_status = "outdated"
        catalogs.append(CatalogIntegrationItem(
            key=table_name,
            label=label,
            local_count=local_count,
            remote_count=remote_count,
            status=item_status,
        ))

    return PlatonusIntegrationStatus(
        connected=connected,
        status="online" if connected else "offline",
        message=message,
        database=database_name,
        response_ms=response_ms,
        checked_at=checked_at,
        catalogs=catalogs,
    )


@router.post("/platonus-sync")
def sync_platonus_integration_catalogs(
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    result = sync_platonus_catalogs()
    success = result.get("status") == "success"
    audit_event(
        action="catalogs.platonus.sync",
        outcome="success" if success else "failure",
        actor=context.get("username"),
        details={"counts": result.get("counts"), "message": result.get("message")},
    )
    if not success:
        raise HTTPException(status_code=502, detail=result.get("message"))
    return result


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
