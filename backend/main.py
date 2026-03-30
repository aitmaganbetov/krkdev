from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from sqlalchemy import inspect, text
import os
import models  # noqa: F401 — ensures models are registered before create_all
from routers import auth_router, catalogs_router, records_router, system_settings_router, users_router
from migrations import import_faculties
from services import require_roles, ROLE_ADMIN

Base.metadata.create_all(bind=engine)


def ensure_records_schema():
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("records")}
    if "submitted_by" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE records ADD COLUMN submitted_by VARCHAR(255) NULL"))


ensure_records_schema()


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

app = FastAPI(
    title="KRK Monitoring System API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ALLOW_ORIGINS,
    allow_credentials=True,
    allow_methods=CORS_ALLOW_METHODS,
    allow_headers=CORS_ALLOW_HEADERS,
)

app.include_router(auth_router)
app.include_router(catalogs_router)
app.include_router(records_router)
app.include_router(system_settings_router)
app.include_router(users_router)


@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/admin/migrate/faculties")
def migrate_faculties(_: dict = Depends(require_roles(ROLE_ADMIN))):
    """Admin endpoint to import faculties from remote database"""
    return import_faculties()
