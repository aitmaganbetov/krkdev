from routers.auth import router as auth_router
from routers.catalogs import router as catalogs_router
from routers.records import router as records_router
from routers.system_settings import router as system_settings_router
from routers.users import router as users_router
from routers.audit_logs import router as audit_logs_router

__all__ = ["auth_router", "catalogs_router", "records_router", "system_settings_router", "users_router", "audit_logs_router"]
