from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from migrations import ensure_catalog_tables, ensure_settings_table
import logging
import os
from database import engine, Base
from routers import auth_router, catalogs_router, records_router, system_settings_router, users_router, audit_logs_router, rooms_router, violations_router, ai_router, rating_templates_router, academic_years_router, peer_visits_router, notifications_router, peer_visit_schedule_router, schedule_router, committee_router, signing_router

# Все модели регистрируются в Base до create_all: пакет models и модели вне его __init__
import models  # noqa: F401
import models.schedule_lesson  # noqa: F401
import models.room_inventory  # noqa: F401
import models.attendance  # noqa: F401
import models.rating_template  # noqa: F401
from services.rating_template_service import ensure_rating_setup


def _read_csv_env(name: str, default: list[str]) -> list[str]:
    raw_value = (os.getenv(name) or "").strip()
    if not raw_value:
        return default
    values = [item.strip() for item in raw_value.split(",") if item.strip()]
    return values or default


CORS_ALLOW_ORIGINS = _read_csv_env(
    "CORS_ALLOW_ORIGINS",
    ["http://localhost:5173", "http://localhost:3000"],
)
CORS_ALLOW_METHODS = _read_csv_env(
    "CORS_ALLOW_METHODS",
    ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
)
CORS_ALLOW_HEADERS = _read_csv_env(
    "CORS_ALLOW_HEADERS",
    ["Authorization", "Content-Type"],
)

# Create all tables at startup (if not already created)
try:
    Base.metadata.create_all(bind=engine)
except Exception as e:
    logging.error(f"Failed to create database tables: {e}")

try:
    ensure_settings_table(engine)
except Exception as e:
    logging.error(f"Failed to prepare system settings table: {e}")

try:
    from services.auth_service import ensure_auth_schema
    ensure_auth_schema()
except Exception as e:
    logging.error(f"Failed to prepare users/roles tables: {e}")

try:
    from services.peer_visit_schedule_service import ensure_schedule_schema
    ensure_schedule_schema(engine)
except Exception as e:
    logging.error(f"Failed to prepare peer visit schedule: {e}")

try:
    ensure_catalog_tables(engine)
except Exception as e:
    logging.error(f"Failed to prepare catalog tables: {e}")

try:
    from services.people_service import ensure_people_tables
    ensure_people_tables(engine)
except Exception as e:
    logging.error(f"Failed to prepare people profile tables: {e}")

try:
    from database import SessionLocal
    from services.faculty_scope import backfill_violation_faculties
    _session = SessionLocal()
    try:
        backfill_violation_faculties(_session)
    finally:
        _session.close()
except Exception as e:
    logging.error(f"Failed to backfill violation faculties: {e}")

try:
    from services.schedule_service import ensure_schedule_schema
    ensure_schedule_schema(engine)
except Exception as e:
    logging.error(f"Failed to prepare schedule tables: {e}")

try:
    from services.committee_service import ensure_committee_schema
    ensure_committee_schema(engine)
except Exception as e:
    logging.error(f"Failed to prepare committee tables: {e}")

# Автоматические роли: член комитета КРК, преподаватель, студент (после миграций справочников)
try:
    from services.auth_service import sync_auto_roles
    sync_auto_roles()
except Exception as e:
    logging.error(f"Failed to sync Platonus roles: {e}")

try:
    from services.room_sync_service import ensure_room_schema
    ensure_room_schema(engine)
except Exception as e:
    logging.error(f"Failed to prepare rooms table: {e}")

try:
    ensure_rating_setup(engine)
except Exception as e:
    logging.error(f"Failed to prepare rating templates: {e}")

# Индексы под запросы — после всех миграций таблиц
try:
    from services.db_indexes import ensure_performance_indexes
    ensure_performance_indexes(engine)
except Exception as e:
    logging.error(f"Failed to prepare indexes: {e}")

app = FastAPI(
    title="Sapa Monitoring API",
    version="1.0.0",
    docs_url="/docs" if os.getenv("ENABLE_API_DOCS", "false").strip().lower() in {"1", "true", "yes"} else None,
    redoc_url="/redoc" if os.getenv("ENABLE_API_DOCS", "false").strip().lower() in {"1", "true", "yes"} else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=CORS_ALLOW_METHODS,
    allow_headers=CORS_ALLOW_HEADERS,
)

app.include_router(auth_router, prefix="/api")
app.include_router(catalogs_router, prefix="/api")
app.include_router(records_router, prefix="/api")
app.include_router(system_settings_router, prefix="/api")
app.include_router(users_router, prefix="/api")
app.include_router(audit_logs_router, prefix="/api")
app.include_router(rooms_router, prefix="/api")
app.include_router(violations_router, prefix="/api")
app.include_router(ai_router, prefix="/api")
app.include_router(rating_templates_router, prefix="/api")
app.include_router(academic_years_router, prefix="/api")
app.include_router(peer_visits_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(peer_visit_schedule_router, prefix="/api")
app.include_router(schedule_router, prefix="/api")
app.include_router(committee_router, prefix="/api")
app.include_router(signing_router, prefix="/api")

# Быстрый вход под ролями — только dev (DEV_QUICK_LOGIN в docker-compose.dev.yml и не Secure-cookie)
from routers.room_scan import router as room_scan_router
app.include_router(room_scan_router, prefix="/api")

from routers import dev_login as _dev_login
if _dev_login.is_enabled():
    logging.warning("DEV_QUICK_LOGIN: быстрый вход под ролями включён (только для dev)")
    app.include_router(_dev_login.router, prefix="/api")


@app.get("/health")
def health():
    return {"status": "ok"}
