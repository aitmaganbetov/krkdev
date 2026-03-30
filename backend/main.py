from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from migrations import import_faculties, migrate_records_submitted_by
from routers import auth_router, catalogs_router, records_router, system_settings_router, users_router
from services import require_roles, ROLE_ADMIN

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
def migrate_faculties(_: dict = Depends(require_roles(ROLE_ADMIN))):
    """Admin endpoint to import faculties from remote database"""
    return import_faculties()


@app.post("/admin/migrate/records-submitted-by")
def migrate_records_submitted_by_column(_: dict = Depends(require_roles(ROLE_ADMIN))):
    """Admin endpoint to add records.submitted_by column if needed"""
    return migrate_records_submitted_by()
