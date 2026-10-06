from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from migrations import import_faculties, migrate_records_submitted_by
import os
from database import engine, Base
from routers import auth_router, catalogs_router, records_router, system_settings_router, users_router, audit_logs_router, rooms_router, violations_router, ai_router, rating_templates_router, academic_years_router
from services import require_roles, ROLE_ADMIN
from services.audit_log import audit_event

# Import all models to ensure they are registered with Base
import models.record  # noqa: F401
import models.audit_log  # noqa: F401
import models.room  # noqa: F401
import models.violation  # noqa: F401
import models.violation_evidence  # noqa: F401
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
    import logging
    logging.error(f"Failed to create database tables: {e}")

try:
    ensure_rating_setup(engine)
except Exception as e:
    import logging
    logging.error(f"Failed to prepare rating templates: {e}")

app = FastAPI(
    title="Sapa API — система ректорского контроля",
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


@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/admin/migrate/faculties")
def migrate_faculties(context: dict = Depends(require_roles(ROLE_ADMIN))):
    """Admin endpoint to import faculties from remote database"""
    result = import_faculties()
    outcome = "success" if result.get("status") == "success" else "failure"
    audit_event(
        action="admin.migrate.faculties",
        outcome=outcome,
        actor=context.get("username"),
        details={"status": result.get("status"), "count": result.get("count")},
    )
    return result


@app.post("/admin/migrate/records-submitted-by")
def migrate_records_submitted_by_column(context: dict = Depends(require_roles(ROLE_ADMIN))):
    """Admin endpoint to add records.submitted_by column if needed"""
    result = migrate_records_submitted_by()
    outcome = "success" if result.get("status") == "success" else "failure"
    audit_event(
        action="admin.migrate.records-submitted-by",
        outcome=outcome,
        actor=context.get("username"),
        details={"status": result.get("status")},
    )
    return result
