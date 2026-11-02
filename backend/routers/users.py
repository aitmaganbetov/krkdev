from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import bindparam, text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
import json
import logging
import os
import re
import site
import ssl
import sys
from time import monotonic

from database import get_db
from services import ROLE_ADMIN, ROLE_SUPERADMIN, get_current_user, require_roles
from services.audit_log import audit_event
from services.auth_service import _hash_password, _normalize_username, _parse_ldap_server_url, invalidate_account_state
from services.secret_box import decode_ldap_settings
from services.request_meta import get_client_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users", tags=["users"])


class CachedUserOut(BaseModel):
    username: str
    display_name: str
    role: str
    faculty_id: int | None = None
    faculty_name: str | None = None
    auth_source: str
    is_ldap: bool
    ldap_dn: str | None = None
    last_login_at: str
    is_blocked: bool
    blocked_until: str | None = None
    block_reason: str | None = None


class LdapDirectoryUserOut(BaseModel):
    username: str
    display_name: str
    dn: str


class UserRoleUpdateIn(BaseModel):
    role: str
    faculty_id: int | None = None


class LocalUserCreateIn(BaseModel):
    username: str
    display_name: str = ""
    password: str
    role: str = "user"
    faculty_id: int | None = None


class LocalUserUpdateIn(BaseModel):
    display_name: str | None = None
    password: str | None = None
    role: str | None = None
    faculty_id: int | None = None


class UserBlockIn(BaseModel):
    reason: str | None = None
    duration_minutes: int | None = None


def _import_ldap3_for_users():
    try:
        from ldap3 import ALL, SUBTREE, Connection, Server, Tls
        from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError
        return ALL, SUBTREE, Connection, Server, Tls, LDAPException, LDAPSocketOpenError
    except Exception as first_exc:
        user_site = site.getusersitepackages()
        if isinstance(user_site, str) and user_site and user_site not in sys.path:
            sys.path.append(user_site)
        vendor_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor"))
        if vendor_path not in sys.path:
            sys.path.append(vendor_path)
        try:
            from ldap3 import ALL, SUBTREE, Connection, Server, Tls
            from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError
            return ALL, SUBTREE, Connection, Server, Tls, LDAPException, LDAPSocketOpenError
        except Exception:
            raise RuntimeError(
                "ldap3 dependency is unavailable. Install ldap3 during build/deploy; runtime installation is disabled."
            ) from first_exc


def _validate_role(role: str | None, actor_role: str | None) -> str:
    normalized = (role or "user").strip().lower()
    if normalized == "committee":
        raise HTTPException(status_code=400, detail="Роль «Член комитета КРК» назначается по составу комитета в разделе «Комитет КРК»")
    if normalized not in {ROLE_SUPERADMIN, "admin", "inspector", "peer_inspector", "staff", "dean", "user", "teacher", "student"}:
        raise HTTPException(status_code=400, detail="Роль должна быть superadmin, admin, inspector, peer_inspector, staff, dean, user, teacher или student")
    # Иначе администратор мог бы выдать себе или другому все права
    if normalized == ROLE_SUPERADMIN and actor_role != ROLE_SUPERADMIN:
        raise HTTPException(status_code=403, detail="Роль суперадминистратора назначает только суперадминистратор")
    return normalized


def _current_role(db: Session, username: str) -> str | None:
    return db.execute(
        text("""
            SELECT COALESCE(r.name, 'user') AS role
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.username = :username
            LIMIT 1
        """),
        {"username": username},
    ).scalar()


def _count_role(db: Session, *roles: str) -> int:
    return int(db.execute(
        text("""
            SELECT COUNT(*)
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE COALESCE(r.name, 'user') IN :roles
        """).bindparams(bindparam("roles", expanding=True)),
        {"roles": list(roles)},
    ).scalar() or 0)


def _guard_superadmin_target(db: Session, username: str, actor_role: str | None) -> None:
    """Учётную запись суперадминистратора меняет, блокирует и удаляет только суперадминистратор."""
    if actor_role != ROLE_SUPERADMIN and _current_role(db, username) == ROLE_SUPERADMIN:
        raise HTTPException(status_code=403, detail="Изменять суперадминистратора может только суперадминистратор")


def _set_user_faculty(db: Session, username: str, role: str, faculty_id: int | None) -> None:
    """Факультет нужен только деканату; у остальных ролей он сбрасывается."""
    if role != "dean":
        db.execute(text("UPDATE users SET faculty_id = NULL WHERE username = :username"), {"username": username})
        return
    if not faculty_id:
        raise HTTPException(status_code=400, detail="Для роли «Деканат» выберите факультет")
    exists = db.execute(text("SELECT 1 FROM faculties WHERE FacultyID = :id LIMIT 1"), {"id": faculty_id}).first()
    if not exists:
        raise HTTPException(status_code=400, detail="Факультет не найден в справочнике")
    db.execute(text("UPDATE users SET faculty_id = :faculty_id WHERE username = :username"),
               {"faculty_id": faculty_id, "username": username})


def _fetch_local_user_row(db: Session, username: str):
    return db.execute(text("""
        SELECT
            u.username,
            COALESCE(u.display_name, u.username) AS display_name,
            COALESCE(r.name, 'user') AS role,
            u.faculty_id,
            f.facultyNameRU AS faculty_name,
            u.auth_source,
            u.is_ldap,
            u.ldap_dn,
            DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
            u.is_blocked,
            DATE_FORMAT(u.blocked_until, '%Y-%m-%d %H:%i:%s') AS blocked_until,
            u.block_reason
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN faculties f ON f.FacultyID = u.faculty_id
        WHERE u.username = :username
        LIMIT 1
    """), {"username": _normalize_username(username)}).mappings().first()


LOCAL_USERS_SQL = """
    SELECT
        u.username,
        COALESCE(u.display_name, u.username) AS display_name,
        COALESCE(r.name, 'user') AS role,
        u.faculty_id,
        f.facultyNameRU AS faculty_name,
        u.auth_source,
        u.is_ldap,
        u.ldap_dn,
        DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
        u.is_blocked,
        DATE_FORMAT(u.blocked_until, '%Y-%m-%d %H:%i:%s') AS blocked_until,
        u.block_reason
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN faculties f ON f.FacultyID = u.faculty_id
    ORDER BY last_login_at DESC
"""


def _map_cached_user_row(row) -> dict:
    return {
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"] or "user",
        "faculty_id": row.get("faculty_id"),
        "faculty_name": row.get("faculty_name"),
        "auth_source": row["auth_source"],
        "is_ldap": bool(row["is_ldap"]),
        "ldap_dn": row["ldap_dn"],
        "last_login_at": row["last_login_at"] or "",
        "is_blocked": bool(row.get("is_blocked")),
        "blocked_until": row.get("blocked_until"),
        "block_reason": row.get("block_reason"),
    }


def _load_ldap_settings(db: Session) -> dict:
    row = db.execute(
        text("SELECT value_text FROM system_settings WHERE `key` = 'ldap' LIMIT 1")
    ).mappings().first()

    if not row:
        return {}

    try:
        data = json.loads(row["value_text"])
    except (TypeError, ValueError):
        return {}

    return decode_ldap_settings(data) if isinstance(data, dict) else {}


def _username_aliases(username: str) -> set[str]:
    raw = _normalize_username(username)
    if not raw:
        return set()

    aliases = {raw}
    if "\\" in raw:
        aliases.add(raw.split("\\", 1)[1])
    if "@" in raw:
        aliases.add(raw.split("@", 1)[0])
    return aliases


def _looks_like_login(display_name: str, username: str) -> bool:
    value = (display_name or "").strip().lower()
    if not value:
        return True
    return value in _username_aliases(username)


def _load_ldap_directory_profiles(db: Session) -> dict[str, dict]:
    settings = _load_ldap_settings(db)

    server_url = (settings.get("server_url") or "").strip()
    if not server_url and settings.get("host"):
        legacy_scheme = "ldaps" if settings.get("use_ssl") else "ldap"
        legacy_port = int(settings.get("port") or (636 if settings.get("use_ssl") else 389))
        server_url = f"{legacy_scheme}://{settings.get('host')}:{legacy_port}"

    if not server_url:
        return {}

    try:
        host, port, use_ssl = _parse_ldap_server_url(server_url)
    except ValueError:
        return {}

    base_dn = (settings.get("base_dn") or "").strip()
    bind_dn = (settings.get("bind_dn") or "").strip()
    bind_password = settings.get("bind_password") or ""
    cert_data = (settings.get("certificate_key") or "").strip()
    if not base_dn:
        return {}

    ALL, SUBTREE, Connection, Server, Tls, LDAPException, LDAPSocketOpenError = _import_ldap3_for_users()

    tls = None
    if use_ssl:
        if cert_data:
            tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_data=cert_data)
        else:
            tls = Tls(validate=ssl.CERT_REQUIRED)

    server = Server(host, port=port, use_ssl=use_ssl, tls=tls, get_info=ALL, connect_timeout=6)
    if bind_dn:
        connection = Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
    else:
        connection = Connection(server, auto_bind=True)

    connection.search(
        search_base=base_dn,
        search_filter="(&(objectClass=user)(!(objectClass=computer)))",
        search_scope=SUBTREE,
        attributes=["sAMAccountName", "userPrincipalName", "mail", "displayName", "cn"],
        size_limit=5000,
    )

    profiles: dict[str, dict] = {}
    for entry in connection.entries:
        attrs = entry.entry_attributes_as_dict
        display_name = (
            (attrs.get("displayName") or [None])[0]
            or (attrs.get("cn") or [None])[0]
        )
        if not display_name:
            continue

        aliases = [
            (attrs.get("sAMAccountName") or [None])[0],
            (attrs.get("userPrincipalName") or [None])[0],
            (attrs.get("mail") or [None])[0],
            (attrs.get("cn") or [None])[0],
        ]

        for alias in aliases:
            alias_key = _normalize_username(str(alias or ""))
            if not alias_key:
                continue
            profiles[alias_key] = {
                "display_name": str(display_name),
                "dn": str(entry.entry_dn),
            }

    connection.unbind()
    return profiles


# Учётные записи LDAP, у которых вместо ФИО логин, сверяются с каталогом не чаще раза в час на логин:
# без этого каждое открытие списка пользователей выполняло полный поиск по каталогу LDAP
_LDAP_NAME_RETRY_SECONDS = 3600
_ldap_name_attempts: dict[str, float] = {}


def _sync_local_ldap_display_names(db: Session, rows: list[dict]) -> bool:
    now = monotonic()
    candidates = [
        row for row in rows
        if bool(row["is_ldap"]) and _looks_like_login(row["display_name"], row["username"])
        and now - _ldap_name_attempts.get(row["username"], -_LDAP_NAME_RETRY_SECONDS) >= _LDAP_NAME_RETRY_SECONDS
    ]
    if not candidates:
        return False
    for row in candidates:
        _ldap_name_attempts[row["username"]] = now

    try:
        profiles = _load_ldap_directory_profiles(db)
    except Exception:
        # Каталог недоступен — список пользователей показывается с текущими именами
        logger.warning("Не удалось получить ФИО из LDAP для списка пользователей", exc_info=True)
        return False
    if not profiles:
        return False

    updated = False
    for row in candidates:
        aliases = _username_aliases(row["username"])
        profile = next((profiles[alias] for alias in aliases if alias in profiles), None)
        if not profile:
            token_candidates = sorted(
                {
                    token
                    for alias in aliases
                    for token in re.split(r"[^a-z0-9]+", alias)
                    if len(token) >= 5
                },
                key=len,
                reverse=True,
            )

            for token in token_candidates:
                fuzzy_matches: dict[tuple[str, str], dict] = {}
                for alias_key, alias_profile in profiles.items():
                    if token not in alias_key:
                        continue
                    fuzzy_matches[(alias_profile["display_name"], alias_profile["dn"])] = alias_profile
                if len(fuzzy_matches) == 1:
                    profile = next(iter(fuzzy_matches.values()))
                    break

        if not profile:
            continue

        display_name = (profile.get("display_name") or "").strip()
        if not display_name:
            continue

        db.execute(
            text("UPDATE users SET display_name = :display_name, ldap_dn = COALESCE(:ldap_dn, ldap_dn) WHERE username = :username"),
            {
                "display_name": display_name,
                "ldap_dn": profile.get("dn") or None,
                "username": row["username"],
            },
        )
        updated = True

    if updated:
        db.commit()
    return updated


@router.get("/local", response_model=list[CachedUserOut])
def list_local_users(
    db: Session = Depends(get_db),
    _: str = Depends(get_current_user),
    __: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    try:

        rows = db.execute(text(LOCAL_USERS_SQL)).mappings().all()

        if _sync_local_ldap_display_names(db, list(rows)):
            rows = db.execute(text(LOCAL_USERS_SQL)).mappings().all()

        return [
            _map_cached_user_row(row)
            for row in rows
        ]
    except SQLAlchemyError as exc:
        raise HTTPException(status_code=500, detail="Не удалось загрузить локальных пользователей") from exc


@router.get("/ldap", response_model=list[LdapDirectoryUserOut])
def list_ldap_directory_users(
    db: Session = Depends(get_db),
    _: str = Depends(get_current_user),
    __: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    try:
        settings = _load_ldap_settings(db)
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=500,
            detail="Не удалось загрузить LDAP настройки.",
        ) from exc

    server_url = (settings.get("server_url") or "").strip()
    if not server_url and settings.get("host"):
        legacy_scheme = "ldaps" if settings.get("use_ssl") else "ldap"
        legacy_port = int(settings.get("port") or (636 if settings.get("use_ssl") else 389))
        server_url = f"{legacy_scheme}://{settings.get('host')}:{legacy_port}"

    if not server_url:
        raise HTTPException(status_code=400, detail="LDAP не настроен: укажите URL сервера")

    try:
        host, port, use_ssl = _parse_ldap_server_url(server_url)
    except ValueError:
        raise HTTPException(status_code=400, detail="Некорректный URL LDAP сервера")

    base_dn = (settings.get("base_dn") or "").strip()
    bind_dn = (settings.get("bind_dn") or "").strip()
    bind_password = settings.get("bind_password") or ""
    cert_data = (settings.get("certificate_key") or "").strip()

    if not base_dn:
        raise HTTPException(status_code=400, detail="Base DN обязателен")

    try:
        ALL, SUBTREE, Connection, Server, Tls, LDAPException, LDAPSocketOpenError = _import_ldap3_for_users()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"LDAP клиент недоступен: {exc}",
        ) from exc

    try:
        tls = None
        if use_ssl:
            if cert_data:
                tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_data=cert_data)
            else:
                tls = Tls(validate=ssl.CERT_REQUIRED)

        server = Server(host, port=port, use_ssl=use_ssl, tls=tls, get_info=ALL, connect_timeout=6)

        if bind_dn:
            connection = Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
        else:
            connection = Connection(server, auto_bind=True)

        # Generic AD-style user filter.
        search_filter = "(&(objectClass=user)(!(objectClass=computer)))"

        # Use paged search to bypass the server-side size limit (default 1000 in AD).
        entries_raw = []
        cookie = None
        while True:
            connection.search(
                search_base=base_dn,
                search_filter=search_filter,
                search_scope=SUBTREE,
                attributes=["sAMAccountName", "userPrincipalName", "displayName", "cn"],
                size_limit=0,
                paged_size=500,
                paged_cookie=cookie,
            )
            entries_raw.extend(connection.entries)
            controls = connection.result.get("controls") or {}
            paged_control = controls.get("1.2.840.113556.1.4.319") or {}
            cookie = (paged_control.get("value") or {}).get("cookie")
            if not cookie:
                break

        result: dict[str, dict] = {}
        for entry in entries_raw:
            attrs = entry.entry_attributes_as_dict
            username = (
                (attrs.get("sAMAccountName") or [None])[0]
                or (attrs.get("userPrincipalName") or [None])[0]
                or (attrs.get("cn") or [None])[0]
            )

            if not username:
                continue

            display_name = (
                (attrs.get("displayName") or [None])[0]
                or (attrs.get("cn") or [None])[0]
                or username
            )

            key = str(username).strip().lower()
            if not key:
                continue

            result[key] = {
                "username": str(username),
                "display_name": str(display_name),
                "dn": str(entry.entry_dn),
            }

        connection.unbind()
        return sorted(result.values(), key=lambda item: item["display_name"].lower())
    except (LDAPSocketOpenError, LDAPException, OSError) as exc:
        raise HTTPException(status_code=503, detail=f"LDAP недоступен: {exc}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Ошибка LDAP: {exc}") from exc


def _guard_admin_demotion(db: Session, target_username: str, new_role: str, actor: str | None) -> None:
    """Не даёт понизить себя, последнего суперадминистратора и последнего администратора."""
    current = _current_role(db, target_username)
    if current not in (ROLE_SUPERADMIN, ROLE_ADMIN) or new_role == current:
        return
    if target_username == _normalize_username(actor or ""):
        raise HTTPException(status_code=400, detail="Нельзя изменить роль самому себе")
    if current == ROLE_SUPERADMIN and _count_role(db, ROLE_SUPERADMIN) <= 1:
        raise HTTPException(status_code=400, detail="Нельзя понизить последнего суперадминистратора")
    if new_role != ROLE_SUPERADMIN and _count_role(db, ROLE_SUPERADMIN, ROLE_ADMIN) <= 1:
        raise HTTPException(status_code=400, detail="Нельзя понизить последнего администратора")


@router.patch("/local/{username}/role", response_model=CachedUserOut)
def update_local_user_role(
    username: str,
    body: UserRoleUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    role = _validate_role(body.role, context.get("role"))

    try:

        target = db.execute(
            text("""
                SELECT id FROM users WHERE username = :username LIMIT 1
            """),
            {"username": username.strip().lower()},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        _guard_superadmin_target(db, username.strip().lower(), context.get("role"))
        _guard_admin_demotion(db, username.strip().lower(), role, context.get("username"))

        db.execute(
            text("""
                UPDATE users
                SET role_id = (SELECT id FROM roles WHERE name = :role LIMIT 1)
                WHERE username = :username
            """),
            {"role": role, "username": username.strip().lower()},
        )
        _set_user_faculty(db, username.strip().lower(), role, body.faculty_id)
        db.commit()
        invalidate_account_state(username)

        row = _fetch_local_user_row(db, username)

        if not row:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        audit_event(
            action="admin.users.role.update",
            outcome="success",
            actor=context.get("username"),
            details={"target": username.strip().lower(), "role": role, "faculty_id": body.faculty_id if role == "dean" else None},
            db=db,
            ip_address=client_ip,
        )
        return _map_cached_user_row(row)
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.role.update",
            outcome="failure",
            actor=context.get("username"),
            details={"target": username.strip().lower(), "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось обновить роль пользователя") from exc


@router.post("/local", response_model=CachedUserOut, status_code=201)
def create_local_user(
    body: LocalUserCreateIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    username = _normalize_username(body.username)
    if not username:
        raise HTTPException(status_code=400, detail="Логин обязателен")
    if len((body.password or "").strip()) < 8:
        raise HTTPException(status_code=400, detail="Пароль должен быть не короче 8 символов")

    role = _validate_role(body.role, context.get("role"))
    password_hash, password_salt = _hash_password(body.password)

    try:

        exists = db.execute(
            text("SELECT 1 FROM users WHERE username = :username LIMIT 1"),
            {"username": username},
        ).first()
        if exists:
            raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")

        db.execute(
            text("""
                INSERT INTO users
                    (username, display_name, role_id, auth_source, is_ldap, ldap_dn, password_hash, password_salt, last_login_at)
                VALUES
                    (
                        :username,
                        :display_name,
                        (SELECT id FROM roles WHERE name = :role LIMIT 1),
                        'manual',
                        0,
                        NULL,
                        :password_hash,
                        :password_salt,
                        NOW()
                    )
            """),
            {
                "username": username,
                "display_name": (body.display_name or "").strip() or username,
                "role": role,
                "password_hash": password_hash,
                "password_salt": password_salt,
            },
        )
        _set_user_faculty(db, username, role, body.faculty_id)
        db.commit()
        invalidate_account_state(username)

        row = _fetch_local_user_row(db, username)
        if not row:
            raise HTTPException(status_code=500, detail="Пользователь создан, но не найден")
        audit_event(
            action="admin.users.create",
            outcome="success",
            actor=context.get("username"),
            details={"target": username, "role": role},
            db=db,
            ip_address=client_ip,
        )
        return _map_cached_user_row(row)
    except HTTPException:
        db.rollback()
        audit_event(
            action="admin.users.create",
            outcome="failure",
            actor=context.get("username"),
            details={"target": username, "reason": "validation_or_conflict"},
            db=db,
            ip_address=client_ip,
        )
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.create",
            outcome="failure",
            actor=context.get("username"),
            details={"target": username, "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось создать пользователя") from exc


@router.patch("/local/{username}", response_model=CachedUserOut)
def update_local_user(
    username: str,
    body: LocalUserUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    normalized = _normalize_username(username)
    if not normalized:
        raise HTTPException(status_code=400, detail="Некорректный логин")

    updates: dict[str, object] = {}
    if body.display_name is not None:
        updates["display_name"] = body.display_name.strip() or normalized

    if body.password is not None:
        if len(body.password.strip()) < 8:
            raise HTTPException(status_code=400, detail="Пароль должен быть не короче 8 символов")
        password_hash, password_salt = _hash_password(body.password)
        updates["password_hash"] = password_hash
        updates["password_salt"] = password_salt

    role = None
    if body.role is not None:
        role = _validate_role(body.role, context.get("role"))

    if not updates and role is None:
        raise HTTPException(status_code=400, detail="Нет данных для обновления")

    try:
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        _guard_superadmin_target(db, normalized, context.get("role"))

        if updates:
            set_parts = ", ".join([f"{field} = :{field}" for field in updates.keys()])
            db.execute(
                text(f"UPDATE users SET {set_parts} WHERE username = :username"),
                {**updates, "username": normalized},
            )

        if role is not None:
            _guard_admin_demotion(db, normalized, role, context.get("username"))
            db.execute(
                text("""
                    UPDATE users
                    SET role_id = (SELECT id FROM roles WHERE name = :role LIMIT 1)
                    WHERE username = :username
                """),
                {"role": role, "username": normalized},
            )
            _set_user_faculty(db, normalized, role, body.faculty_id)

        db.commit()
        invalidate_account_state(normalized)

        row = _fetch_local_user_row(db, normalized)
        if not row:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        audit_event(
            action="admin.users.update",
            outcome="success",
            actor=context.get("username"),
            details={"target": normalized, "updated_fields": sorted(list(updates.keys()) + (["role"] if role is not None else []))},
            db=db,
            ip_address=client_ip,
        )
        return _map_cached_user_row(row)
    except HTTPException:
        db.rollback()
        audit_event(
            action="admin.users.update",
            outcome="failure",
            actor=context.get("username"),
            details={"target": normalized, "reason": "validation_or_not_found"},
            db=db,
            ip_address=client_ip,
        )
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.update",
            outcome="failure",
            actor=context.get("username"),
            details={"target": normalized, "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось обновить пользователя") from exc


@router.delete("/local/{username}")
def delete_local_user(
    username: str,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    normalized = _normalize_username(username)
    actor = _normalize_username(context.get("username") or "")
    if not normalized:
        raise HTTPException(status_code=400, detail="Некорректный логин")
    if normalized == actor:
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")

    try:

        target = db.execute(
            text("""
                SELECT u.id, COALESCE(r.name, 'user') AS role
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                WHERE u.username = :username
                LIMIT 1
            """),
            {"username": normalized},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        _guard_superadmin_target(db, normalized, context.get("role"))
        target_role = target.get("role") or "user"
        if target_role == ROLE_SUPERADMIN and _count_role(db, ROLE_SUPERADMIN) <= 1:
            raise HTTPException(status_code=400, detail="Нельзя удалить последнего суперадминистратора")
        if target_role in (ROLE_SUPERADMIN, ROLE_ADMIN) and _count_role(db, ROLE_SUPERADMIN, ROLE_ADMIN) <= 1:
            raise HTTPException(status_code=400, detail="Нельзя удалить последнего администратора")

        db.execute(
            text("DELETE FROM users WHERE username = :username"),
            {"username": normalized},
        )
        db.commit()
        invalidate_account_state(normalized)

        audit_event(
            action="admin.users.delete",
            outcome="success",
            actor=context.get("username"),
            details={"target": normalized},
            db=db,
            ip_address=client_ip,
        )
        return {"status": "ok"}
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.delete",
            outcome="failure",
            actor=context.get("username"),
            details={"target": normalized, "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось удалить пользователя") from exc


@router.post("/local/{username}/block", response_model=CachedUserOut)
def block_local_user(
    username: str,
    body: UserBlockIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    normalized = _normalize_username(username)
    actor = _normalize_username(context.get("username") or "")
    if not normalized:
        raise HTTPException(status_code=400, detail="Некорректный логин")
    if normalized == actor:
        raise HTTPException(status_code=400, detail="Нельзя заблокировать самого себя")

    duration_minutes = body.duration_minutes
    if duration_minutes is not None and duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="duration_minutes должен быть больше 0")

    reason = (body.reason or "manual_admin_block").strip()[:255]

    try:
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        _guard_superadmin_target(db, normalized, context.get("role"))

        if duration_minutes is None:
            db.execute(
                text("""
                    UPDATE users
                    SET is_blocked = 1,
                        blocked_until = NULL,
                        block_reason = :reason
                    WHERE username = :username
                """),
                {"username": normalized, "reason": reason},
            )
        else:
            db.execute(
                text("""
                    UPDATE users
                    SET is_blocked = 1,
                        blocked_until = DATE_ADD(UTC_TIMESTAMP(), INTERVAL :duration_minutes MINUTE),
                        block_reason = :reason
                    WHERE username = :username
                """),
                {"username": normalized, "reason": reason, "duration_minutes": duration_minutes},
            )
        db.commit()
        invalidate_account_state(normalized)

        row = _fetch_local_user_row(db, normalized)
        if not row:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        audit_event(
            action="admin.users.block",
            outcome="success",
            actor=context.get("username"),
            details={"target": normalized, "reason": reason, "duration_minutes": duration_minutes},
            db=db,
            ip_address=client_ip,
        )
        return _map_cached_user_row(row)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.block",
            outcome="failure",
            actor=context.get("username"),
            details={"target": normalized, "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось заблокировать пользователя") from exc


@router.post("/local/{username}/unblock", response_model=CachedUserOut)
def unblock_local_user(
    username: str,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    normalized = _normalize_username(username)
    if not normalized:
        raise HTTPException(status_code=400, detail="Некорректный логин")

    try:
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        _guard_superadmin_target(db, normalized, context.get("role"))

        db.execute(
            text("""
                UPDATE users
                SET is_blocked = 0,
                    blocked_until = NULL,
                    block_reason = NULL
                WHERE username = :username
            """),
            {"username": normalized},
        )
        db.commit()
        invalidate_account_state(normalized)

        row = _fetch_local_user_row(db, normalized)
        if not row:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        audit_event(
            action="admin.users.unblock",
            outcome="success",
            actor=context.get("username"),
            details={"target": normalized},
            db=db,
            ip_address=client_ip,
        )
        return _map_cached_user_row(row)
    except HTTPException:
        db.rollback()
        raise
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.users.unblock",
            outcome="failure",
            actor=context.get("username"),
            details={"target": normalized, "error": type(exc).__name__},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=500, detail="Не удалось разблокировать пользователя") from exc