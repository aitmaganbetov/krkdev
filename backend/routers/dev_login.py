"""Быстрый вход под каждой ролью — ТОЛЬКО для dev-окружения.

Роутер подключается в main.py, лишь когда DEV_QUICK_LOGIN=true (задаётся в docker-compose.dev.yml,
не в общем backend/.env) и cookie не Secure (dev работает по http). На проде маршрутов нет — 404.
Вход выполняется под служебными учётными записями dev.<роль> без пароля: по паролю под ними войти нельзя.
Роли «Преподаватель», «Пользователь», «Член комитета КРК» и «Студент» входят как настоящие люди из Platonus
с демо-данными (services/dev_seed.py); при первом входе сиды создаются автоматически.
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import get_db
from services.audit_log import audit_event
from services.auth_service import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH_COOKIE_NAME,
    ROLE_ADMIN,
    ROLE_COMMITTEE,
    ROLE_DEAN,
    ROLE_INSPECTOR,
    ROLE_PEER_INSPECTOR,
    ROLE_STAFF,
    ROLE_STUDENT,
    ROLE_SUPERADMIN,
    ROLE_TEACHER,
    ROLE_USER,
    _upsert_user,
    create_access_token,
    invalidate_account_state,
)
from services import dev_seed
from services.request_meta import get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/dev-login", tags=["dev-login"])

ROLES = (ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_INSPECTOR, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_USER, ROLE_TEACHER,
         ROLE_COMMITTEE, ROLE_STUDENT)
# Роли, которые входят как настоящий человек из Platonus (персонаж dev_seed)
PERSONA_ROLES = (ROLE_TEACHER, ROLE_USER, ROLE_COMMITTEE, ROLE_STUDENT)
AUTH_COOKIE_SAMESITE = (os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower() or "lax")


def is_enabled() -> bool:
    flag = os.getenv("DEV_QUICK_LOGIN", "").strip().lower() in {"1", "true", "yes", "on"}
    cookie_secure = os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower() in {"1", "true", "yes", "on"}
    if flag and cookie_secure:
        logger.error("DEV_QUICK_LOGIN включён при Secure-cookie (похоже на прод) — быстрый вход отключён")
    return flag and not cookie_secure


class DevLoginIn(BaseModel):
    role: str = Field(min_length=1, max_length=20)
    faculty_id: int | None = None


def _faculties(db: Session) -> list[dict]:
    rows = db.execute(text("SELECT FacultyID AS id, facultyNameRU AS name FROM faculties ORDER BY FacultyID")).mappings().all()
    return [{"id": row["id"], "name": row["name"]} for row in rows]


def _personas(db: Session) -> dict:
    """Персонажи dev_seed; без справочников Platonus их нет — тогда роли входят служебными учётными записями."""
    try:
        return dev_seed.personas(db)
    except Exception:
        db.rollback()
        logger.exception("Не удалось выбрать персонажей для быстрого входа")
        return {}


@router.get("")
def dev_login_options(db: Session = Depends(get_db)):
    """Роли для быстрого входа; деканат — по каждому факультету."""
    people = _personas(db)
    options = [{"role": role, "faculty_id": None, "faculty_name": None,
                "person_name": people.get(role, {}).get("full_name")} for role in ROLES]
    options += [{"role": ROLE_DEAN, "faculty_id": f["id"], "faculty_name": f["name"], "person_name": None} for f in _faculties(db)]
    return {"options": options}


@router.post("")
def dev_login(body: DevLoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    role = body.role.strip().lower()
    faculty_id = None
    if role == ROLE_DEAN:
        if not any(f["id"] == body.faculty_id for f in _faculties(db)):
            raise HTTPException(status_code=400, detail="Для деканата выберите факультет")
        faculty_id = body.faculty_id
    elif role not in ROLES:
        raise HTTPException(status_code=400, detail="Неизвестная роль")

    person = _personas(db).get(role) if role in PERSONA_ROLES else None
    username = person["username"] if person else f"dev.{role}" + (f".{faculty_id}" if faculty_id else "")
    existing = db.execute(text("SELECT auth_source FROM users WHERE username = :username"), {"username": username}).scalar()
    # Настоящую учётную запись (LDAP, пароль, ЭЦП) быстрый вход не перезаписывает
    if existing in (None, "dev_quick_login"):
        _upsert_user(
            db,
            username=username,
            display_name=person["full_name"] if person else f"DEV · {role}" + (f" · факультет {faculty_id}" if faculty_id else ""),
            auth_source="dev_quick_login",
            is_ldap=False,
            ldap_dn=None,
            password=None,
            role_name=role,
        )
        db.execute(
            text("UPDATE users SET faculty_id = :faculty_id, is_blocked = 0, blocked_until = NULL, block_reason = NULL WHERE username = :username"),
            {"faculty_id": faculty_id, "username": username},
        )
        db.commit()
        invalidate_account_state(username)
    # Демо-данные всех ролей — один раз, при первом быстром входе
    try:
        if not dev_seed.is_seeded(db):
            logger.info("DEV: демо-данные по ролям — %s", dev_seed.seed_all(db))
    except Exception:
        db.rollback()
        logger.exception("Не удалось создать демо-данные (services/dev_seed.py)")

    client_ip = get_client_ip(request)
    audit_event(
        action="auth.dev_login",
        outcome="success",
        actor=username,
        details={"ip": client_ip, "role": role, "faculty_id": faculty_id},
        db=db,
        ip_address=client_ip,
    )
    token = create_access_token({"sub": username, "role": role, "auth_source": "dev_quick_login"})
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    return {"access_token": token, "token_type": "bearer", "role": role, "username": username}
