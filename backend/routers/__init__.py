from routers.auth import router as auth_router
from routers.catalogs import router as catalogs_router
from routers.records import router as records_router
from routers.system_settings import router as system_settings_router
from routers.users import router as users_router
from routers.audit_logs import router as audit_logs_router
from routers.rooms import router as rooms_router
from routers.violations import router as violations_router
from routers.ai import router as ai_router
from routers.rating_templates import router as rating_templates_router
from routers.academic_years import router as academic_years_router
from routers.peer_visits import router as peer_visits_router
from routers.notifications import router as notifications_router
from routers.peer_visit_schedule import router as peer_visit_schedule_router
from routers.schedule import router as schedule_router
from routers.committee import router as committee_router
from routers.signing import router as signing_router

__all__ = ["auth_router", "catalogs_router", "records_router", "system_settings_router", "users_router", "audit_logs_router", "rooms_router", "violations_router", "ai_router", "rating_templates_router", "academic_years_router", "peer_visits_router", "notifications_router", "peer_visit_schedule_router", "schedule_router", "committee_router", "signing_router"]
