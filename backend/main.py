from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from sqlalchemy import inspect, text
import models  # noqa: F401 — ensures models are registered before create_all
from routers import auth_router, catalogs_router, records_router, system_settings_router, users_router
from migrations import import_faculties
from services import require_roles, ROLE_ADMIN
from services.audit_log import audit_event

Base.metadata.create_all(bind=engine)


def ensure_records_schema():
    inspector = inspect(engine)
    columns = {col["name"] for col in inspector.get_columns("records")}
    if "submitted_by" not in columns:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE records ADD COLUMN submitted_by VARCHAR(255) NULL"))


ensure_records_schema()

app = FastAPI(
    title="KRK Monitoring System API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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
