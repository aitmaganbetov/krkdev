from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
import base64
import hashlib
import json
import os
import re
import site
import ssl
import sys
from urllib.parse import urlparse

from database import get_db
from services import ROLE_ADMIN, get_current_user, require_roles
from services.audit_log import audit_event
from services.request_meta import get_client_ip

router = APIRouter(prefix="/users", tags=["users"])


class CachedUserOut(BaseModel):
    username: str
    display_name: str
    role: str
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


class LocalUserCreateIn(BaseModel):
    username: str
    display_name: str = ""
    password: str
    role: str = "staff"


class LocalUserUpdateIn(BaseModel):
    display_name: str | None = None
    password: str | None = None
    role: str | None = None


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


def _parse_ldap_server_url(server_url: str) -> tuple[str, int, bool]:
    raw = (server_url or "").strip()
    if not raw:
        raise ValueError("missing_server_url")

    if "://" not in raw:
        raw = f"ldaps://{raw}"

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"ldap", "ldaps"}:
        raise ValueError("invalid_scheme")

    host = (parsed.hostname or "").strip()
    if not host:
        raise ValueError("missing_host")

    use_ssl = scheme == "ldaps"
    port = parsed.port or (636 if use_ssl else 389)
    return host, port, use_ssl


def _normalize_username(username: str) -> str:
    return (username or "").strip().lower()


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    effective_salt = salt or base64.b64encode(os.urandom(16)).decode("ascii")
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        effective_salt.encode("utf-8"),
        200_000,
    )
    return digest.hex(), effective_salt


def _validate_role(role: str | None) -> str:
    normalized = (role or "staff").strip().lower()
    if normalized not in {"admin", "inspector", "staff"}:
        raise HTTPException(status_code=400, detail="Роль должна быть admin, inspector или staff")
    return normalized


def _fetch_local_user_row(db: Session, username: str):
    return db.execute(text("""
        SELECT
            u.username,
            COALESCE(u.display_name, u.username) AS display_name,
            COALESCE(r.name, 'staff') AS role,
            u.auth_source,
            u.is_ldap,
            u.ldap_dn,
            DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
            u.is_blocked,
            DATE_FORMAT(u.blocked_until, '%Y-%m-%d %H:%i:%s') AS blocked_until,
            u.block_reason
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.username = :username
        LIMIT 1
    """), {"username": _normalize_username(username)}).mappings().first()


def _map_cached_user_row(row) -> dict:
    return {
        "username": row["username"],
        "display_name": row["display_name"],
        "role": row["role"] or "staff",
        "auth_source": row["auth_source"],
        "is_ldap": bool(row["is_ldap"]),
        "ldap_dn": row["ldap_dn"],
        "last_login_at": row["last_login_at"] or "",
        "is_blocked": bool(row.get("is_blocked")),
        "blocked_until": row.get("blocked_until"),
        "block_reason": row.get("block_reason"),
    }


def _ensure_users_table(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS roles (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(50) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))
    db.execute(text("INSERT IGNORE INTO roles (name) VALUES ('admin')"))
    db.execute(text("INSERT IGNORE INTO roles (name) VALUES ('inspector')"))
    db.execute(text("INSERT IGNORE INTO roles (name) VALUES ('staff')"))

    db.execute(text("""
        CREATE TABLE IF NOT EXISTS users (
            id INT PRIMARY KEY AUTO_INCREMENT,
            username VARCHAR(255) NOT NULL UNIQUE,
            display_name VARCHAR(255) NULL,
            role_id INT NULL,
            auth_source VARCHAR(50) NOT NULL DEFAULT 'local',
            is_ldap TINYINT(1) NOT NULL DEFAULT 0,
            ldap_dn VARCHAR(512) NULL,
            password_hash VARCHAR(255) NULL,
            password_salt VARCHAR(255) NULL,
            is_blocked TINYINT(1) NOT NULL DEFAULT 0,
            blocked_until DATETIME NULL,
            block_reason VARCHAR(255) NULL,
            last_login_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_users_last_login_at (last_login_at),
            KEY idx_users_role_id (role_id),
            KEY idx_users_blocked_until (blocked_until),
            CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))

    role_column = db.execute(text("""
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id'
        LIMIT 1
    """)).first()
    if not role_column:
        db.execute(text("ALTER TABLE users ADD COLUMN role_id INT NULL"))
        db.execute(text("ALTER TABLE users ADD KEY idx_users_role_id (role_id)"))

    blocked_column = db.execute(text("""
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_blocked'
        LIMIT 1
    """)).first()
    if not blocked_column:
        db.execute(text("ALTER TABLE users ADD COLUMN is_blocked TINYINT(1) NOT NULL DEFAULT 0"))

    blocked_until_column = db.execute(text("""
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'blocked_until'
        LIMIT 1
    """)).first()
    if not blocked_until_column:
        db.execute(text("ALTER TABLE users ADD COLUMN blocked_until DATETIME NULL"))

    block_reason_column = db.execute(text("""
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'block_reason'
        LIMIT 1
    """)).first()
    if not block_reason_column:
        db.execute(text("ALTER TABLE users ADD COLUMN block_reason VARCHAR(255) NULL"))

    blocked_index = db.execute(text("""
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = 'idx_users_blocked_until'
        LIMIT 1
    """)).first()
    if not blocked_index:
        db.execute(text("ALTER TABLE users ADD KEY idx_users_blocked_until (blocked_until)"))

    fk_exists = db.execute(text("""
        SELECT 1
        FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'users'
          AND CONSTRAINT_NAME = 'fk_users_role'
          AND CONSTRAINT_TYPE = 'FOREIGN KEY'
        LIMIT 1
    """)).first()
    if not fk_exists:
        db.execute(text("ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)"))

    db.execute(text("""
        UPDATE users
        SET role_id = (SELECT id FROM roles WHERE name = 'staff' LIMIT 1)
        WHERE role_id IS NULL
    """))
    db.commit()


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

    return data if isinstance(data, dict) else {}


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


def _sync_local_ldap_display_names(db: Session, rows: list[dict]) -> bool:
    candidates = [row for row in rows if bool(row["is_ldap"]) and _looks_like_login(row["display_name"], row["username"])]
    if not candidates:
        return False

    profiles = _load_ldap_directory_profiles(db)
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
        _ensure_users_table(db)

        rows = db.execute(text("""
            SELECT
                u.username,
                COALESCE(u.display_name, u.username) AS display_name,
                COALESCE(r.name, 'staff') AS role,
                u.auth_source,
                u.is_ldap,
                u.ldap_dn,
                DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
                u.is_blocked,
                DATE_FORMAT(u.blocked_until, '%Y-%m-%d %H:%i:%s') AS blocked_until,
                u.block_reason
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            ORDER BY last_login_at DESC
        """)).mappings().all()

        if _sync_local_ldap_display_names(db, list(rows)):
            rows = db.execute(text("""
                SELECT
                    u.username,
                    COALESCE(u.display_name, u.username) AS display_name,
                    COALESCE(r.name, 'staff') AS role,
                    u.auth_source,
                    u.is_ldap,
                    u.ldap_dn,
                    DATE_FORMAT(u.last_login_at, '%Y-%m-%d %H:%i:%s') AS last_login_at,
                    u.is_blocked,
                    DATE_FORMAT(u.blocked_until, '%Y-%m-%d %H:%i:%s') AS blocked_until,
                    u.block_reason
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                ORDER BY last_login_at DESC
            """)).mappings().all()

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
    __: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
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
        connection.search(
            search_base=base_dn,
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=["sAMAccountName", "userPrincipalName", "displayName", "cn"],
            size_limit=5000,
        )

        result: dict[str, dict] = {}
        for entry in connection.entries:
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


@router.patch("/local/{username}/role", response_model=CachedUserOut)
def update_local_user_role(
    username: str,
    body: UserRoleUpdateIn,
    request: Request,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    client_ip = get_client_ip(request)
    role = _validate_role(body.role)

    try:
        _ensure_users_table(db)

        target = db.execute(
            text("""
                SELECT id FROM users WHERE username = :username LIMIT 1
            """),
            {"username": username.strip().lower()},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        db.execute(
            text("""
                UPDATE users
                SET role_id = (SELECT id FROM roles WHERE name = :role LIMIT 1)
                WHERE username = :username
            """),
            {"role": role, "username": username.strip().lower()},
        )
        db.commit()

        row = _fetch_local_user_row(db, username)

        if not row:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        audit_event(
            action="admin.users.role.update",
            outcome="success",
            actor=context.get("username"),
            details={"target": username.strip().lower(), "role": role},
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
    if len((body.password or "").strip()) < 4:
        raise HTTPException(status_code=400, detail="Пароль должен быть не короче 4 символов")

    role = _validate_role(body.role)
    password_hash, password_salt = _hash_password(body.password)

    try:
        _ensure_users_table(db)

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
        db.commit()

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
        if len(body.password.strip()) < 4:
            raise HTTPException(status_code=400, detail="Пароль должен быть не короче 4 символов")
        password_hash, password_salt = _hash_password(body.password)
        updates["password_hash"] = password_hash
        updates["password_salt"] = password_salt

    role = None
    if body.role is not None:
        role = _validate_role(body.role)

    if not updates and role is None:
        raise HTTPException(status_code=400, detail="Нет данных для обновления")

    try:
        _ensure_users_table(db)
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if updates:
            set_parts = ", ".join([f"{field} = :{field}" for field in updates.keys()])
            db.execute(
                text(f"UPDATE users SET {set_parts} WHERE username = :username"),
                {**updates, "username": normalized},
            )

        if role is not None:
            db.execute(
                text("""
                    UPDATE users
                    SET role_id = (SELECT id FROM roles WHERE name = :role LIMIT 1)
                    WHERE username = :username
                """),
                {"role": role, "username": normalized},
            )

        db.commit()

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
        _ensure_users_table(db)

        target = db.execute(
            text("""
                SELECT u.id, COALESCE(r.name, 'staff') AS role
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                WHERE u.username = :username
                LIMIT 1
            """),
            {"username": normalized},
        ).mappings().first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if (target.get("role") or "staff") == "admin":
            admins_count = db.execute(
                text("""
                    SELECT COUNT(*)
                    FROM users u
                    LEFT JOIN roles r ON r.id = u.role_id
                    WHERE COALESCE(r.name, 'staff') = 'admin'
                """),
            ).scalar() or 0
            if int(admins_count) <= 1:
                raise HTTPException(status_code=400, detail="Нельзя удалить последнего администратора")

        db.execute(
            text("DELETE FROM users WHERE username = :username"),
            {"username": normalized},
        )
        db.commit()

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
        _ensure_users_table(db)
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

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
        _ensure_users_table(db)
        target = db.execute(
            text("SELECT id FROM users WHERE username = :username LIMIT 1"),
            {"username": normalized},
        ).first()
        if not target:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

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