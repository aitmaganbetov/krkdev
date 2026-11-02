from collections import OrderedDict
from datetime import datetime, timezone
import os
from time import monotonic

import pymysql
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from schemas.catalog import BasicInfoCatalogOut
from migrations import ACTIVE_TUTORS_WHERE, get_remote_config, sync_platonus_catalogs
from services import ROLE_ADMIN, get_current_user, require_roles
from services.auth_service import sync_auto_roles
from services.audit_log import audit_event
from services.room_sync_service import sync_rooms_from_platonus
from services.schedule_service import STUDENTS_COUNT_SQL, sync_students_from_platonus
from services.people_service import (
    KIND_STUDENT,
    KIND_TUTOR,
    attach_accounts,
    get_card,
    sync_people_profiles,
    update_fields,
)

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
    ("cafedras", "Кафедры"),
    ("specializations", "Образовательные программы"),
    ("groups", "Группы"),
    ("tutors", "Преподаватели"),
    ("students", "Студенты"),
    ("rooms", "Кабинеты"),
)

# Студенты — снимок platonus_students; кабинеты — только привязанные к аудиториям Platonus
# (кабинеты, заведённые вручную или исчезнувшие из Platonus, не считаются)
LOCAL_COUNT_QUERIES = {
    "students": "SELECT COUNT(*) FROM platonus_students",
    "rooms": "SELECT COUNT(*) FROM rooms WHERE platonus_auditory_id IS NOT NULL",
}

# Действующие аудитории — как в импорте кабинетов (services/room_sync_service.py)
REMOTE_AUDITORIES_SQL = """
    SELECT auditoryID FROM auditories
    WHERE COALESCE(closed, 0) = 0 AND COALESCE(blocked, 0) = 0 AND TRIM(COALESCE(auditoryName, '')) <> ''
"""

REMOTE_COUNT_QUERIES = {
    "faculties": "SELECT COUNT(*) FROM faculties",
    "cafedras": "SELECT COUNT(*) FROM cafedras",
    "specializations": "SELECT COUNT(*) FROM specializations WHERE is_default = 0 AND deleted IS NULL",
    "groups": "SELECT COUNT(*) FROM `groups`",
    "tutors": f"SELECT COUNT(*) FROM tutors WHERE {ACTIVE_TUTORS_WHERE}",
    "students": STUDENTS_COUNT_SQL,
}


def _local_catalog_counts(db: Session) -> dict[str, int | None]:
    counts = {}
    for table_name, _ in CATALOG_TABLES:
        try:
            counts[table_name] = int(
                db.execute(text(LOCAL_COUNT_QUERIES.get(table_name, f"SELECT COUNT(*) FROM `{table_name}`"))).scalar() or 0
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
                for table_name in REMOTE_COUNT_QUERIES:
                    cursor.execute(REMOTE_COUNT_QUERIES[table_name])
                    remote_counts[table_name] = int(cursor.fetchone()[0] or 0)
                cursor.execute(REMOTE_AUDITORIES_SQL)
                remote_auditories = {row[0] for row in cursor.fetchall()}
                remote_counts["rooms"] = len(remote_auditories)
        finally:
            connection.close()

        # Кабинеты сверяются по аудиториям: закрытая в Platonus аудитория остаётся в системе, но не в счёте
        try:
            linked = {row[0] for row in db.execute(text(
                "SELECT platonus_auditory_id FROM rooms WHERE platonus_auditory_id IS NOT NULL"
            )).all()}
            local_counts["rooms"] = len(linked & remote_auditories)
        except SQLAlchemyError:
            db.rollback()
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
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    result = sync_platonus_catalogs()
    success = result.get("status") == "success"
    if success:
        invalidate_basic_catalog()
        # Студенты и кабинеты — до карточек и ролей: роль «Студент» считается по platonus_students.
        # Сбой не отменяет обновлённые справочники
        students = sync_students_from_platonus(db)
        if students["status"] == "success":
            result["counts"]["students"] = students["total"]
            result["message"] = f"{result['message']}. Студентов — {students['total']}"
        else:
            result["message"] = f"{result['message']}. {students['message']}"
        rooms = sync_rooms_from_platonus(db)
        if rooms["status"] == "success":
            result["counts"].update({
                "rooms": rooms["total"], "rooms_created": rooms["created"], "rooms_updated": rooms["updated"],
            })
            result["message"] = (f"{result['message']}. Кабинетов — {rooms['total']} "
                                 f"(новых {rooms['created']}, изменено {rooms['updated']})")
        else:
            result["message"] = f"{result['message']}. {rooms['message']}"
        # Карточки преподавателей и студентов; сбой не отменяет обновлённые справочники
        try:
            profiles = sync_people_profiles()
            result["counts"].update({"tutor_profiles": profiles["tutors"], "student_profiles": profiles["students"]})
            result["message"] = (f"{result['message']}. Карточки: преподавателей — {profiles['tutors']}, "
                                 f"студентов — {profiles['students']}")
        except Exception as exc:  # noqa: BLE001 — сообщение уходит администратору
            result["message"] = f"{result['message']}. Карточки не обновлены: {type(exc).__name__}: {exc}"
        # Роли «Преподаватель» и «Студент» по обновлённому справочнику преподавателей
        try:
            result["counts"]["roles_changed"] = sync_auto_roles()
        except Exception as exc:  # noqa: BLE001
            result["message"] = f"{result['message']}. Роли не обновлены: {type(exc).__name__}: {exc}"
    audit_event(
        action="catalogs.platonus.sync",
        outcome="success" if success else "failure",
        actor=context.get("username"),
        details={"counts": result.get("counts"), "message": result.get("message")},
    )
    if not success:
        raise HTTPException(status_code=502, detail=result.get("message"))
    return result


# Справочники Platonus для форм (преподаватели, факультеты → ОП → группы, кафедры) меняются только
# синхронизацией: кеш в памяти сбрасывается в POST /catalogs/platonus-sync, 10 минут — запас
_BASIC_CATALOG_TTL = 600.0
_basic_catalog_cache: dict = {}


def invalidate_basic_catalog() -> None:
    _basic_catalog_cache.clear()


def _basic_catalog(db: Session) -> dict:
    cached = _basic_catalog_cache.get("data")
    if cached is not None and monotonic() - _basic_catalog_cache["at"] < _BASIC_CATALOG_TTL:
        return cached
    try:
        teachers_rows = db.execute(text("""
            SELECT t.tutor_id, t.full_name, c.cafedraNameRU AS cafedra
            FROM tutors t
            LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
            WHERE t.has_access = 1
              AND COALESCE(t.full_name, '') <> ''
            ORDER BY t.full_name
        """)).mappings().all()

        cafedra_rows = db.execute(text("""
            SELECT cafedraID, cafedraNameRU, cafedraNameKZ, cafedraNameEN, FacultyID
            FROM cafedras
            ORDER BY cafedraNameRU
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
            detail="Справочники не готовы. Сначала выполните синхронизацию справочников Platonus в настройках.",
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
        {"id": row["tutor_id"], "full_name": row["full_name"], "cafedra": row["cafedra"]}
        for row in teachers_rows
    ]
    cafedras = [
        {
            "id": row["cafedraID"],
            "name_ru": row["cafedraNameRU"] or "",
            "name_kz": row["cafedraNameKZ"],
            "name_en": row["cafedraNameEN"],
            "faculty_id": row["FacultyID"],
        }
        for row in cafedra_rows
    ]

    data = {"teachers": teachers, "faculties": result, "cafedras": cafedras}
    _basic_catalog_cache.update(data=data, at=monotonic())
    return data


@router.get("/basic-info", response_model=BasicInfoCatalogOut)
def get_basic_info_catalog(
    db: Session = Depends(get_db),
    _: str = Depends(get_current_user),
):
    catalog = _basic_catalog(db)
    # Таблица academic_years создаётся при старте (ensure_rating_setup). Здесь только чтение:
    # прежний INSERT IGNORE в GET возвращал удалённые администратором учебные годы.
    try:
        academic_years = [row[0] for row in db.execute(text("SELECT name FROM academic_years ORDER BY name"))]
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Справочники не готовы. Сначала выполните синхронизацию справочников Platonus в настройках.",
        ) from exc
    return {**catalog, "academic_years": academic_years}


# Просмотр справочников Platonus (вкладки «Справочника»). Данные только для чтения:
# источник — Platonus, обновление — POST /catalogs/platonus-sync.

def _like(search: str | None) -> str | None:
    value = (search or "").strip()
    return f"%{value}%" if value else None


def _paged(db: Session, select_sql: str, from_sql: str, where: list[str], params: dict,
           order_sql: str, skip: int, limit: int, count_from_sql: str | None = None) -> dict:
    """count_from_sql — FROM для подсчёта без фильтров, когда соединения не меняют число строк."""
    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    try:
        count_from = count_from_sql if count_from_sql and not where else from_sql
        total = db.execute(text(f"SELECT COUNT(*) {count_from} {where_sql}"), params).scalar() or 0
        rows = db.execute(
            text(f"SELECT {select_sql} {from_sql} {where_sql} ORDER BY {order_sql} LIMIT :limit OFFSET :skip"),
            {**params, "limit": limit, "skip": skip},
        ).mappings().all()
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Справочники не готовы. Сначала выполните синхронизацию справочников Platonus в настройках.",
        ) from exc
    return {"total": int(total), "items": [dict(row) for row in rows]}


@router.get("/faculties")
def list_faculties(
    search: str | None = Query(None, max_length=100),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if (pattern := _like(search)) is not None:
        where.append("(f.facultyNameRU LIKE :p OR f.facultyNameKZ LIKE :p OR f.facultyNameEN LIKE :p)")
        params["p"] = pattern
    return _paged(db, """
            f.FacultyID AS id, f.facultyNameRU AS name_ru, f.facultyNameKZ AS name_kz, f.facultyNameEN AS name_en,
            (SELECT COUNT(*) FROM cafedras c WHERE c.FacultyID = f.FacultyID) AS cafedras_count,
            (SELECT COUNT(*) FROM specializations s WHERE s.faculty_id = f.FacultyID) AS specializations_count,
            (SELECT COUNT(*) FROM `groups` g JOIN specializations s ON s.id = g.specializationID
                WHERE s.faculty_id = f.FacultyID) AS groups_count
        """, "FROM faculties f", where, params, "f.FacultyID", skip, limit)


@router.get("/cafedras")
def list_cafedras(
    search: str | None = Query(None, max_length=100),
    faculty_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if faculty_id is not None:
        where.append("c.FacultyID = :faculty_id")
        params["faculty_id"] = faculty_id
    if (pattern := _like(search)) is not None:
        where.append("(c.cafedraNameRU LIKE :p OR c.cafedraNameKZ LIKE :p OR c.cafedraNameEN LIKE :p)")
        params["p"] = pattern
    return _paged(db, """
            c.cafedraID AS id, c.cafedraNameRU AS name_ru, c.cafedraNameKZ AS name_kz, c.cafedraNameEN AS name_en,
            c.FacultyID AS faculty_id, f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz,
            f.facultyNameEN AS faculty_name_en,
            (SELECT COUNT(*) FROM specializations s WHERE s.cafedra_id = c.cafedraID) AS specializations_count,
            (SELECT COUNT(*) FROM tutors t WHERE t.cafedra_id = c.cafedraID) AS tutors_count
        """, "FROM cafedras c LEFT JOIN faculties f ON f.FacultyID = c.FacultyID",
        where, params, "f.FacultyID, c.cafedraNameRU", skip, limit)


@router.get("/specializations")
def list_specializations(
    search: str | None = Query(None, max_length=100),
    faculty_id: int | None = Query(None),
    cafedra_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if faculty_id is not None:
        where.append("s.faculty_id = :faculty_id")
        params["faculty_id"] = faculty_id
    if cafedra_id is not None:
        where.append("s.cafedra_id = :cafedra_id")
        params["cafedra_id"] = cafedra_id
    if (pattern := _like(search)) is not None:
        where.append("(s.nameru LIKE :p OR s.namekz LIKE :p OR s.nameen LIKE :p OR s.specializationCode LIKE :p)")
        params["p"] = pattern
    return _paged(db, """
            s.id, s.specializationCode AS code, s.nameru AS name_ru, s.namekz AS name_kz, s.nameen AS name_en,
            s.faculty_id, f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en,
            s.cafedra_id, c.cafedraNameRU AS cafedra_name_ru, c.cafedraNameKZ AS cafedra_name_kz, c.cafedraNameEN AS cafedra_name_en,
            (SELECT COUNT(*) FROM `groups` g WHERE g.specializationID = s.id) AS groups_count
        """, """FROM specializations s
            LEFT JOIN faculties f ON f.FacultyID = s.faculty_id
            LEFT JOIN cafedras c ON c.cafedraID = s.cafedra_id""",
        where, params, "s.specializationCode, s.nameru", skip, limit)


@router.get("/groups")
def list_groups(
    search: str | None = Query(None, max_length=100),
    faculty_id: int | None = Query(None),
    cafedra_id: int | None = Query(None),
    specialization_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if faculty_id is not None:
        where.append("s.faculty_id = :faculty_id")
        params["faculty_id"] = faculty_id
    if cafedra_id is not None:
        where.append("s.cafedra_id = :cafedra_id")
        params["cafedra_id"] = cafedra_id
    if specialization_id is not None:
        where.append("g.specializationID = :specialization_id")
        params["specialization_id"] = specialization_id
    if (pattern := _like(search)) is not None:
        where.append("(g.name LIKE :p OR s.nameru LIKE :p OR s.specializationCode LIKE :p)")
        params["p"] = pattern
    return _paged(db, """
            g.groupID AS id, g.name,
            g.specializationID AS specialization_id, s.specializationCode AS specialization_code,
            s.nameru AS specialization_name_ru, s.namekz AS specialization_name_kz, s.nameen AS specialization_name_en,
            s.faculty_id, f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en,
            c.cafedraNameRU AS cafedra_name_ru, c.cafedraNameKZ AS cafedra_name_kz, c.cafedraNameEN AS cafedra_name_en
        """, """FROM `groups` g
            LEFT JOIN specializations s ON s.id = g.specializationID
            LEFT JOIN faculties f ON f.FacultyID = s.faculty_id
            LEFT JOIN cafedras c ON c.cafedraID = s.cafedra_id""",
        where, params, "(g.name IS NULL OR g.name = ''), g.name", skip, limit)


# «Пользователи → Преподаватели / Студенты»: люди из Platonus, их учётные записи КРК и карточки
# (services/people_service.py). В списке ФИО и почта — с учётом правок КРК.

def _override_join(alias: str, kind: str, id_column: str, field: str) -> str:
    return (f"LEFT JOIN people_overrides {alias} ON {alias}.kind = '{kind}' "
            f"AND {alias}.person_id = {id_column} AND {alias}.field = '{field}'")


@router.get("/tutors")
def list_tutors(
    search: str | None = Query(None, max_length=100),
    faculty_id: int | None = Query(None),
    cafedra_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if faculty_id is not None:
        where.append("c.FacultyID = :faculty_id")
        params["faculty_id"] = faculty_id
    if cafedra_id is not None:
        where.append("t.cafedra_id = :cafedra_id")
        params["cafedra_id"] = cafedra_id
    if (pattern := _like(search)) is not None:
        where.append("(t.full_name LIKE :p OR o_name.value LIKE :p OR t.login LIKE :p OR t.email LIKE :p OR o_mail.value LIKE :p)")
        params["p"] = pattern
    # ИИН — персональные данные: наружу только признак, что вход по ЭЦП возможен
    page = _paged(db, """
            t.tutor_id AS id, COALESCE(o_name.value, t.full_name) AS full_name, t.login,
            COALESCE(o_mail.value, t.email) AS email, (t.iin IS NOT NULL) AS has_iin,
            t.cafedra_id, c.cafedraNameRU AS cafedra_name_ru, c.cafedraNameKZ AS cafedra_name_kz, c.cafedraNameEN AS cafedra_name_en,
            c.FacultyID AS faculty_id, f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en
        """, f"""FROM tutors t
            LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
            LEFT JOIN faculties f ON f.FacultyID = c.FacultyID
            {_override_join("o_name", KIND_TUTOR, "t.tutor_id", "full_name")}
            {_override_join("o_mail", KIND_TUTOR, "t.tutor_id", "email")}""",
        where, params, "COALESCE(o_name.value, t.full_name)", skip, limit)
    for item in page["items"]:
        item["has_iin"] = bool(item["has_iin"])
    attach_accounts(db, page["items"])
    return page


@router.get("/students")
def list_students(
    search: str | None = Query(None, max_length=100),
    faculty_id: int | None = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    where, params = [], {}
    if faculty_id is not None:
        where.append("gx.faculty_id = :faculty_id")
        params["faculty_id"] = faculty_id
    if (pattern := _like(search)) is not None:
        where.append("(s.full_name LIKE :p OR o_name.value LIKE :p OR s.login LIKE :p OR s.group_name LIKE :p)")
        params["p"] = pattern
    # Студент связан с группой только по названию (platonus_students заполняет синхронизация расписания);
    # одно название бывает у нескольких групп — ОП показывается, только если она у них одна.
    # platonus_students создана ORM с другой сортировкой строк — COLLATE при сравнении с таблицами справочников
    page = _paged(db, """
            s.student_id AS id, COALESCE(o_name.value, s.full_name COLLATE utf8mb4_unicode_ci) AS full_name,
            s.login, (s.iin IS NOT NULL) AS has_iin, s.group_name, gx.specialization_code, gx.faculty_id,
            f.facultyNameRU AS faculty_name_ru, f.facultyNameKZ AS faculty_name_kz, f.facultyNameEN AS faculty_name_en
        """, f"""FROM platonus_students s
            {_override_join("o_name", KIND_STUDENT, "s.student_id", "full_name")}
            LEFT JOIN (
                SELECT g.name,
                       CASE WHEN COUNT(DISTINCT sp.id) = 1 THEN MIN(sp.specializationCode) END AS specialization_code,
                       MIN(sp.faculty_id) AS faculty_id
                FROM `groups` g
                LEFT JOIN specializations sp ON sp.id = g.specializationID
                GROUP BY g.name
            ) gx ON gx.name = s.group_name COLLATE utf8mb4_unicode_ci
            LEFT JOIN faculties f ON f.FacultyID = gx.faculty_id""",
        where, params, "COALESCE(o_name.value, s.full_name COLLATE utf8mb4_unicode_ci)", skip, limit,
        # Все соединения — LEFT JOIN один к одному (gx сгруппирован по названию), число строк = число студентов
        count_from_sql="FROM platonus_students s")
    for item in page["items"]:
        item["has_iin"] = bool(item["has_iin"])
    attach_accounts(db, page["items"])
    return page


class PersonUpdate(BaseModel):
    # Ключ поля → новое значение; null — вернуть значение Platonus
    fields: dict[str, str | None] = Field(max_length=30)


def _card_or_404(db: Session, kind: str, person_id: int) -> dict:
    card = get_card(db, kind, person_id)
    if card is None:
        raise HTTPException(status_code=404, detail="Не найдено в справочнике Platonus")
    return card


def _update_person(db: Session, kind: str, person_id: int, body: PersonUpdate, context: dict) -> dict:
    _card_or_404(db, kind, person_id)
    try:
        changed = update_fields(db, kind, person_id, body.fields, context.get("username") or "unknown")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Неверное значение поля {exc}") from exc
    if changed:
        # Значения — персональные данные: в журнал только названия полей
        audit_event(
            action=f"people.{kind}.update",
            outcome="success",
            actor=context.get("username"),
            details={"person_id": person_id, "fields": changed},
            db=db,
        )
    return _card_or_404(db, kind, person_id)


@router.get("/tutors/{tutor_id}")
def get_tutor_card(tutor_id: int, db: Session = Depends(get_db), _: dict[str, str] = Depends(require_roles(ROLE_ADMIN))):
    return _card_or_404(db, KIND_TUTOR, tutor_id)


@router.patch("/tutors/{tutor_id}")
def update_tutor_card(tutor_id: int, body: PersonUpdate, db: Session = Depends(get_db),
                      context: dict[str, str] = Depends(require_roles(ROLE_ADMIN))):
    return _update_person(db, KIND_TUTOR, tutor_id, body, context)


@router.get("/students/{student_id}")
def get_student_card(student_id: int, db: Session = Depends(get_db), _: dict[str, str] = Depends(require_roles(ROLE_ADMIN))):
    return _card_or_404(db, KIND_STUDENT, student_id)


@router.patch("/students/{student_id}")
def update_student_card(student_id: int, body: PersonUpdate, db: Session = Depends(get_db),
                        context: dict[str, str] = Depends(require_roles(ROLE_ADMIN))):
    return _update_person(db, KIND_STUDENT, student_id, body, context)
