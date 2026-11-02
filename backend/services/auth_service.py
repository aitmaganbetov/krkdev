import logging
from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from sqlalchemy import bindparam, text
from database import SessionLocal
from services.secret_box import decode_ldap_settings
import hashlib
import base64
import json
import os
import hmac
import re
import ssl
import site
import sys
from urllib.parse import urlparse
from threading import Lock
from time import monotonic

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()

ACCESS_TOKEN_EXPIRE_MINUTES_DEFAULT = 60
ACCESS_TOKEN_EXPIRE_MINUTES_MIN = 5
ACCESS_TOKEN_EXPIRE_MINUTES_MAX = 240


def _read_access_token_expire_minutes() -> int:
    raw_value = (os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES") or "").strip()
    try:
        ttl = int(raw_value) if raw_value else ACCESS_TOKEN_EXPIRE_MINUTES_DEFAULT
    except ValueError:
        ttl = ACCESS_TOKEN_EXPIRE_MINUTES_DEFAULT

    if ttl < ACCESS_TOKEN_EXPIRE_MINUTES_MIN:
        return ACCESS_TOKEN_EXPIRE_MINUTES_MIN
    if ttl > ACCESS_TOKEN_EXPIRE_MINUTES_MAX:
        return ACCESS_TOKEN_EXPIRE_MINUTES_MAX
    return ttl


ACCESS_TOKEN_EXPIRE_MINUTES = _read_access_token_expire_minutes()

if not SECRET_KEY:
    raise RuntimeError("Environment variable SECRET_KEY is required")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)
AUTH_COOKIE_NAME = (os.getenv("AUTH_COOKIE_NAME") or "krk_access_token").strip() or "krk_access_token"

logger = logging.getLogger(__name__)

# Суперадминистратор: все права, включая системные разделы (настройки, LDAP, кабинеты и камеры,
# журнал аудита). Им становится встроенный аккаунт ADMIN_USERNAME; назначить роль может только он сам.
ROLE_SUPERADMIN = "superadmin"
# Администратор: рабочая область, дашборд, справочник и пользователи
ROLE_ADMIN = "admin"
# Инспектор КРК: расписание, записи КРК (проверка всех записей), комитет КРК, справочник вопросов и учебных лет
ROLE_INSPECTOR = "inspector"
# Инспектор взаимопосещения: расписание, отзывы о взаимопосещении (проверка всех отзывов), график взаимопосещения
ROLE_PEER_INSPECTOR = "peer_inspector"
ROLE_STAFF = "staff"
# Деканат: работает только с данными своего факультета (users.faculty_id = faculties.FacultyID)
ROLE_DEAN = "dean"
# Пользователь: базовая роль с минимальными правами — уведомления, свои нарушения, свой план
# взаимопосещений и отзывы по нему. Её получают новые пользователи; остальные роли назначает администратор.
ROLE_USER = "user"
# Студент: только отметка посещаемости по QR-коду аудитории и свои отметки. Назначается, если логин
# совпадает с логином активного обучающегося Platonus (platonus_students).
ROLE_STUDENT = "student"
# Преподаватель: права базовой роли «Пользователь». Назначается, если логин есть в справочнике преподавателей Platonus.
ROLE_TEACHER = "teacher"
# Член комитета ректорского контроля: права «Сотрудника» (проверки занятий — свои записи КРК, расписание).
# Назначается по составу действующего приказа о комитете (раздел «Комитет КРК», committee_service.py).
ROLE_COMMITTEE = "committee"
ALL_ROLES = {ROLE_SUPERADMIN, ROLE_ADMIN, ROLE_INSPECTOR, ROLE_PEER_INSPECTOR, ROLE_STAFF, ROLE_DEAN, ROLE_USER, ROLE_TEACHER, ROLE_STUDENT, ROLE_COMMITTEE}
# Роли, которые система выставляет сама (см. _AUTO_ROLE_SOURCES); остальные назначает администратор,
# и автоматически они не меняются
AUTO_ROLES = (ROLE_USER, ROLE_TEACHER, ROLE_STUDENT, ROLE_COMMITTEE)
# Проводят проверки занятий и видят только свои записи КРК
RECORD_AUTHOR_ROLES = (ROLE_STAFF, ROLE_COMMITTEE)


def _import_ldap3_for_auth():
    try:
        from ldap3 import ALL, BASE, SUBTREE, Connection, Server, Tls
        from ldap3.core.exceptions import LDAPBindError, LDAPException, LDAPSocketOpenError
        return ALL, BASE, SUBTREE, Connection, Server, Tls, LDAPBindError, LDAPException, LDAPSocketOpenError
    except Exception as first_exc:
        user_site = site.getusersitepackages()
        if isinstance(user_site, str) and user_site and user_site not in sys.path:
            sys.path.append(user_site)
        vendor_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor"))
        if vendor_path not in sys.path:
            sys.path.append(vendor_path)
        try:
            from ldap3 import ALL, BASE, SUBTREE, Connection, Server, Tls
            from ldap3.core.exceptions import LDAPBindError, LDAPException, LDAPSocketOpenError
            return ALL, BASE, SUBTREE, Connection, Server, Tls, LDAPBindError, LDAPException, LDAPSocketOpenError
        except Exception:
            raise RuntimeError(
                "ldap3 dependency is unavailable. Install ldap3 during build/deploy; runtime installation is disabled."
            ) from first_exc


def _ensure_users_table(db) -> None:
    _ensure_roles_table(db)
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

    faculty_column = db.execute(text("""
        SELECT 1 FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'faculty_id'
        LIMIT 1
    """)).first()
    if not faculty_column:
        # Факультет пользователя с ролью «Деканат» (faculties.FacultyID)
        db.execute(text("ALTER TABLE users ADD COLUMN faculty_id INT NULL"))

    # Пользователям без роли — базовая роль «Пользователь»
    db.execute(text("""
        UPDATE users
        SET role_id = (SELECT id FROM roles WHERE name = :role_name LIMIT 1)
        WHERE role_id IS NULL
    """), {"role_name": ROLE_USER})
    db.commit()


def _ensure_roles_table(db) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS roles (
            id INT PRIMARY KEY AUTO_INCREMENT,
            name VARCHAR(50) NOT NULL UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))

    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_SUPERADMIN},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_ADMIN},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_INSPECTOR},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_PEER_INSPECTOR},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_STAFF},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_DEAN},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_USER},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_TEACHER},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_COMMITTEE},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_STUDENT},
    )
    db.commit()


def _get_role_id(db, role_name: str) -> int | None:
    normalized = (role_name or "").strip().lower()
    if normalized not in ALL_ROLES:
        normalized = ROLE_USER

    row = db.execute(
        text("SELECT id FROM roles WHERE name = :name LIMIT 1"),
        {"name": normalized},
    ).first()
    return int(row[0]) if row else None


def _get_ldap_settings(db) -> dict:
    row = db.execute(
        text("SELECT value_text FROM system_settings WHERE `key` = 'ldap' LIMIT 1")
    ).mappings().first()

    if not row:
        return {"enabled": False}

    try:
        data = json.loads(row["value_text"])
        if isinstance(data, dict):
            return decode_ldap_settings(data)
    except (TypeError, ValueError):
        pass

    return {"enabled": False}


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


def _verify_password(password: str, stored_hash: str | None, stored_salt: str | None) -> bool:
    if not stored_hash or not stored_salt:
        return False
    computed_hash, _ = _hash_password(password, stored_salt)
    return hmac.compare_digest(computed_hash, stored_hash)


def _upsert_user(
    db,
    username: str,
    display_name: str,
    auth_source: str,
    is_ldap: bool,
    ldap_dn: str | None,
    password: str | None,
    role_name: str | None = None,
) -> None:
    normalized_username = _normalize_username(username)
    password_hash = None
    password_salt = None
    if password:
        password_hash, password_salt = _hash_password(password)

    role_id = _get_role_id(db, role_name or ROLE_USER)

    db.execute(
        text("""
            INSERT INTO users
                (username, display_name, role_id, auth_source, is_ldap, ldap_dn, password_hash, password_salt, last_login_at)
            VALUES
                (:username, :display_name, :role_id, :auth_source, :is_ldap, :ldap_dn, :password_hash, :password_salt, NOW())
            ON DUPLICATE KEY UPDATE
                display_name = VALUES(display_name),
                role_id = COALESCE(VALUES(role_id), role_id),
                auth_source = VALUES(auth_source),
                is_ldap = VALUES(is_ldap),
                ldap_dn = VALUES(ldap_dn),
                password_hash = VALUES(password_hash),
                password_salt = VALUES(password_salt),
                last_login_at = NOW()
        """),
        {
            "username": normalized_username,
            "display_name": display_name,
            "role_id": role_id,
            "auth_source": auth_source,
            "is_ldap": 1 if is_ldap else 0,
            "ldap_dn": ldap_dn,
            "password_hash": password_hash,
            "password_salt": password_salt,
        },
    )
    db.commit()
    invalidate_account_state(normalized_username)


def _get_cached_user(db, username: str):
    normalized_username = _normalize_username(username)
    return db.execute(
        text("""
            SELECT
                u.username,
                u.display_name,
                u.auth_source,
                u.is_ldap,
                u.ldap_dn,
                u.password_hash,
                u.password_salt,
                r.name AS role_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE username = :username
            LIMIT 1
        """),
        {"username": normalized_username},
    ).mappings().first()


def _get_cached_users_by_usernames(db, usernames: list[str]) -> list[dict]:
    normalized = [u for u in {_normalize_username(v) for v in usernames if v and v.strip()} if u]
    if not normalized:
        return []

    placeholders = ",".join([f":u{i}" for i in range(len(normalized))])
    params = {f"u{i}": value for i, value in enumerate(normalized)}
    rows = db.execute(
        text(f"""
            SELECT
                u.username,
                u.display_name,
                u.auth_source,
                u.is_ldap,
                u.ldap_dn,
                u.password_hash,
                u.password_salt,
                r.name AS role_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.username IN ({placeholders})
        """),
        params,
    ).mappings().all()
    return list(rows)


def _build_ldap_filter(template: str, username: str) -> str:
    escaped = _escape_ldap_filter_value(username)
    raw = (template or "").strip()
    if not raw:
        return f"(sAMAccountName={escaped})"
    if "{username}" in raw:
        return raw.replace("{username}", escaped)
    if raw.startswith("(") and raw.endswith(")"):
        return raw
    return f"(sAMAccountName={escaped})"


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


def _short_ldap_username(username: str) -> str:
    raw = (username or "").strip()
    if "\\" in raw:
        raw = raw.split("\\", 1)[1]
    if "@" in raw:
        raw = raw.split("@", 1)[0]
    return _normalize_username(raw)


def _extract_upn_suffix(bind_dn: str, host: str, settings: dict) -> str:
    explicit = (settings.get("upn_suffix") or settings.get("domain") or "").strip().lower()
    if explicit:
        return explicit

    bind_raw = (bind_dn or "").strip()
    if "@" in bind_raw:
        return bind_raw.split("@", 1)[1].strip().lower()

    host_raw = (host or "").strip().lower()
    if "." in host_raw:
        # e.g. dc1.kaztbu.edu.kz -> kaztbu.edu.kz
        return host_raw.split(".", 1)[1]
    return ""


def _build_ldap_bind_candidates(username: str, bind_dn: str, host: str, settings: dict) -> list[str]:
    raw = (username or "").strip()
    short = _short_ldap_username(raw)
    upn_suffix = _extract_upn_suffix(bind_dn, host, settings)

    candidates: list[str] = []
    for value in [raw, short]:
        if value and value not in candidates:
            candidates.append(value)

    if short and upn_suffix:
        upn = f"{short}@{upn_suffix}"
        if upn not in candidates:
            candidates.append(upn)

        netbios = upn_suffix.split(".", 1)[0].upper()
        if netbios:
            sam = f"{netbios}\\{short}"
            if sam not in candidates:
                candidates.append(sam)

    return candidates


def _clean_name_value(value: object) -> str:
    text_value = str(value or "").strip()
    return re.sub(r"\s+", " ", text_value)


def _contains_cyrillic(text: str) -> bool:
    return bool(re.search(r"[\u0400-\u04FF]", text or ""))


def _contains_latin(text: str) -> bool:
    return bool(re.search(r"[A-Za-z]", text or ""))


def _pick_ldap_display_name(attrs: dict, fallback_login: str) -> str:
    display_name = _clean_name_value((attrs.get("displayName") or [""])[0])
    cn_name = _clean_name_value((attrs.get("cn") or [""])[0])
    given_name = _clean_name_value((attrs.get("givenName") or [""])[0])
    surname = _clean_name_value((attrs.get("sn") or [""])[0])

    constructed_names = []
    if surname or given_name:
        constructed_names.append(_clean_name_value(f"{surname} {given_name}"))
        constructed_names.append(_clean_name_value(f"{given_name} {surname}"))

    candidates = [display_name, cn_name, *constructed_names]
    candidates = [name for name in candidates if name]

    for name in candidates:
        if _contains_cyrillic(name):
            return name

    for name in candidates:
        if _contains_latin(name):
            return name

    return fallback_login


def _parse_whoami_identity(whoami: str) -> tuple[str, str]:
    raw = (whoami or "").strip()
    if not raw:
        return "", ""
    if raw.lower().startswith("dn:"):
        return raw[3:].strip(), ""
    if raw.lower().startswith("u:"):
        return "", raw[2:].strip()
    return "", raw


def _escape_ldap_filter_value(value: str) -> str:
    raw = str(value or "")
    return (
        raw.replace("\\", "\\5c")
        .replace("*", "\\2a")
        .replace("(", "\\28")
        .replace(")", "\\29")
        .replace("\x00", "\\00")
    )


def _ldap_directory_profile_fallback(
    settings: dict,
    host: str,
    port: int,
    use_ssl: bool,
    aliases: list[str],
    expected_dn: str | None,
) -> dict:
    try:
        ALL, BASE, SUBTREE, Connection, Server, Tls, LDAPBindError, LDAPException, LDAPSocketOpenError = _import_ldap3_for_auth()
    except Exception:
        return {}

    base_dn = (settings.get("base_dn") or "").strip()
    bind_dn = (settings.get("bind_dn") or "").strip()
    bind_password = settings.get("bind_password") or ""
    cert_data = (settings.get("certificate_key") or "").strip()
    if not base_dn:
        return {}

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

        search_filter = "(&(objectClass=user)(!(objectClass=computer)))"
        connection.search(
            search_base=base_dn,
            search_filter=search_filter,
            search_scope=SUBTREE,
            attributes=["sAMAccountName", "userPrincipalName", "displayName", "cn", "givenName", "sn"],
            size_limit=5000,
        )

        alias_set = {_normalize_username(a) for a in aliases if a and str(a).strip()}
        expected_dn_norm = (expected_dn or "").strip().lower()
        best_match = None
        for entry in connection.entries:
            attrs = entry.entry_attributes_as_dict
            sam = _normalize_username((attrs.get("sAMAccountName") or [""])[0] or "")
            upn = _normalize_username((attrs.get("userPrincipalName") or [""])[0] or "")
            cn = _normalize_username((attrs.get("cn") or [""])[0] or "")
            entry_dn_norm = str(entry.entry_dn or "").strip().lower()

            keys = {k for k in [sam, upn, cn] if k}
            if sam:
                keys.add(_short_ldap_username(sam))
            if upn:
                keys.add(_short_ldap_username(upn))

            is_dn_match = bool(expected_dn_norm and entry_dn_norm == expected_dn_norm)
            is_alias_match = bool(alias_set.intersection(keys))
            if not is_dn_match and not is_alias_match:
                continue

            display_name = _pick_ldap_display_name(attrs, _short_ldap_username(upn or sam or cn))
            candidate = {
                "username": upn or sam or cn,
                "display_name": display_name,
                "ldap_dn": str(entry.entry_dn),
                "score": (2 if is_dn_match else 0) + (1 if is_alias_match else 0),
            }
            if best_match is None or candidate["score"] > best_match["score"]:
                best_match = candidate

        connection.unbind()
        if best_match:
            best_match.pop("score", None)
            return best_match
        return {}
    except Exception:
        return {}


def _merge_legacy_usernames(db, canonical_username: str, aliases: list[str]) -> None:
    canonical = _normalize_username(canonical_username)
    alias_set = {_normalize_username(a) for a in aliases if a and a.strip()}
    alias_set.discard(canonical)
    if not alias_set:
        return

    for alias in alias_set:
        db.execute(
            text("UPDATE records SET submitted_by = :canonical WHERE LOWER(submitted_by) = :alias"),
            {"canonical": canonical, "alias": alias},
        )
        db.execute(
            text("UPDATE records SET reviewed_by = :canonical WHERE LOWER(reviewed_by) = :alias"),
            {"canonical": canonical, "alias": alias},
        )
        db.execute(
            text("DELETE FROM users WHERE LOWER(username) = :alias"),
            {"alias": alias},
        )
    db.commit()
    for alias in alias_set:
        invalidate_account_state(alias)


def _ldap_authenticate(username: str, password: str, settings: dict) -> tuple[bool, dict, str]:
    try:
        ALL, BASE, SUBTREE, Connection, Server, Tls, LDAPBindError, LDAPException, LDAPSocketOpenError = _import_ldap3_for_auth()
    except Exception:
        return False, {}, "unavailable"

    server_url = (settings.get("server_url") or "").strip()
    if not server_url and settings.get("host"):
        # Backward compatibility with old LDAP settings format.
        legacy_scheme = "ldaps" if settings.get("use_ssl") else "ldap"
        legacy_port = int(settings.get("port") or (636 if settings.get("use_ssl") else 389))
        server_url = f"{legacy_scheme}://{settings.get('host')}:{legacy_port}"

    try:
        host, port, use_ssl = _parse_ldap_server_url(server_url)
    except ValueError:
        return False, {}, "unavailable"

    base_dn = (settings.get("base_dn") or "").strip()
    bind_dn = (settings.get("bind_dn") or "").strip()
    bind_password = settings.get("bind_password") or ""
    cert_data = (settings.get("certificate_key") or "").strip()
    short_username = _short_ldap_username(username)
    user_filter = _build_ldap_filter("", short_username)

    try:
        # Сертификат проверяется так же, как в каталоге пользователей и тесте LDAP:
        # без проверки пароли пользователей и bind-учётки можно перехватить подменой сервера.
        tls = None
        if use_ssl:
            if cert_data:
                tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_data=cert_data)
            else:
                tls = Tls(validate=ssl.CERT_REQUIRED)

        server = Server(host, port=port, use_ssl=use_ssl, tls=tls, get_info=ALL, connect_timeout=5)

        search_connection = None
        if bind_dn:
            search_connection = Connection(server, user=bind_dn, password=bind_password, auto_bind=True)
        else:
            search_connection = Connection(server, auto_bind=True)

        user_dn = None
        canonical_username = short_username
        upn_suffix = _extract_upn_suffix(bind_dn, host, settings)
        display_name = short_username or _normalize_username(username)
        effective_base_dn = base_dn
        if not effective_base_dn:
            info_other = getattr(getattr(search_connection.server, "info", None), "other", {}) or {}
            for key in ("defaultNamingContext", "namingContexts"):
                values = info_other.get(key)
                if isinstance(values, list) and values:
                    effective_base_dn = str(values[0]).strip()
                    if effective_base_dn:
                        break

        if effective_base_dn:
            search_filters = [user_filter]
            if upn_suffix:
                upn_value = f"{_escape_ldap_filter_value(short_username)}@{_escape_ldap_filter_value(upn_suffix)}"
                search_filters.append(f"(userPrincipalName={upn_value})")
                search_filters.append(f"(mail={upn_value})")

            entry = None
            attrs = {}
            for search_filter in search_filters:
                search_ok = search_connection.search(
                    search_base=effective_base_dn,
                    search_filter=search_filter,
                    attributes=["displayName", "cn", "givenName", "sn", "sAMAccountName", "userPrincipalName"],
                    size_limit=1,
                )
                if search_ok and search_connection.entries:
                    entry = search_connection.entries[0]
                    attrs = entry.entry_attributes_as_dict
                    break

            if entry is not None:
                user_dn = entry.entry_dn
                display_name = _pick_ldap_display_name(attrs, short_username)
                sam = _normalize_username((attrs.get("sAMAccountName") or [short_username])[0] or short_username)
                upn_attr = _normalize_username((attrs.get("userPrincipalName") or [""])[0] or "")
                if upn_attr:
                    canonical_username = upn_attr
                elif sam and upn_suffix:
                    canonical_username = f"{sam}@{upn_suffix}"
                else:
                    canonical_username = sam

        if "@" not in canonical_username and upn_suffix:
            canonical_username = f"{canonical_username}@{upn_suffix}"

        bind_candidates = [user_dn] if user_dn else _build_ldap_bind_candidates(username, bind_dn, host, settings)
        user_connection = None
        selected_bind_candidate = ""
        for candidate in bind_candidates:
            if not candidate:
                continue
            try:
                user_connection = Connection(server, user=candidate, password=password, auto_bind=True)
                selected_bind_candidate = candidate
                break
            except LDAPBindError:
                user_connection = None

        if user_connection is None:
            raise LDAPBindError("invalid credentials")

        # Most reliable source: resolve currently bound LDAP identity and read profile by DN.
        try:
            whoami = user_connection.extend.standard.who_am_i() or ""
            bound_dn, bound_principal = _parse_whoami_identity(str(whoami))

            if bound_dn:
                profile_ok = user_connection.search(
                    search_base=bound_dn,
                    search_filter="(objectClass=*)",
                    search_scope=BASE,
                    attributes=["displayName", "cn", "givenName", "sn", "sAMAccountName", "userPrincipalName"],
                    size_limit=1,
                )
                if profile_ok and user_connection.entries:
                    bound_entry = user_connection.entries[0]
                    bound_attrs = bound_entry.entry_attributes_as_dict
                    display_name = _pick_ldap_display_name(bound_attrs, short_username)
                    user_dn = bound_dn

                    sam_bound = _normalize_username((bound_attrs.get("sAMAccountName") or [short_username])[0] or short_username)
                    upn_bound = _normalize_username((bound_attrs.get("userPrincipalName") or [""])[0] or "")
                    if upn_bound:
                        canonical_username = upn_bound
                    elif sam_bound and upn_suffix:
                        canonical_username = f"{sam_bound}@{upn_suffix}"
                    elif sam_bound:
                        canonical_username = sam_bound

            # If who_am_i returned principal (u:DOMAIN\\user), resolve profile by principal aliases.
            if effective_base_dn and (not display_name or display_name == short_username):
                principal_candidates = [bound_principal, selected_bind_candidate, canonical_username, username]
                principal_aliases: list[str] = []
                for principal in principal_candidates:
                    if not principal:
                        continue
                    p = str(principal).strip()
                    if p and p not in principal_aliases:
                        principal_aliases.append(p)
                    short_p = _short_ldap_username(p)
                    if short_p and short_p not in principal_aliases:
                        principal_aliases.append(short_p)

                for principal in principal_aliases:
                    escaped_principal = _escape_ldap_filter_value(principal)
                    profile_filter = (
                        f"(&(objectClass=user)(|(sAMAccountName={escaped_principal})"
                        f"(userPrincipalName={escaped_principal})(mail={escaped_principal})))"
                    )
                    try:
                        profile_ok = user_connection.search(
                            search_base=effective_base_dn,
                            search_filter=profile_filter,
                            attributes=["displayName", "cn", "givenName", "sn", "sAMAccountName", "userPrincipalName"],
                            size_limit=1,
                        )
                        if not profile_ok or not user_connection.entries:
                            continue

                        profile_entry = user_connection.entries[0]
                        profile_attrs = profile_entry.entry_attributes_as_dict
                        display_name = _pick_ldap_display_name(profile_attrs, short_username)
                        if not user_dn:
                            user_dn = profile_entry.entry_dn

                        sam_profile = _normalize_username((profile_attrs.get("sAMAccountName") or [short_username])[0] or short_username)
                        upn_profile = _normalize_username((profile_attrs.get("userPrincipalName") or [""])[0] or "")
                        if upn_profile:
                            canonical_username = upn_profile
                        elif sam_profile and upn_suffix:
                            canonical_username = f"{sam_profile}@{upn_suffix}"
                        elif sam_profile:
                            canonical_username = sam_profile
                        break
                    except Exception:
                        continue

                # Final fallback for alias-heavy directories: ANR + wildcard token search.
                if not display_name or display_name == short_username:
                    token = re.sub(r"[^a-z0-9]", "", short_username.lower())
                    fallback_filters: list[str] = []
                    if short_username:
                        fallback_filters.append(f"(&(objectClass=user)(anr={_escape_ldap_filter_value(short_username)}))")
                    if token and len(token) >= 3:
                        esc_token = _escape_ldap_filter_value(token)
                        fallback_filters.append(
                            "(&(objectClass=user)(|"
                            f"(sAMAccountName=*{esc_token}*)"
                            f"(userPrincipalName=*{esc_token}*)"
                            f"(mail=*{esc_token}*)"
                            f"(cn=*{esc_token}*)"
                            f"(displayName=*{esc_token}*)"
                            "))"
                        )

                    for fallback_filter in fallback_filters:
                        try:
                            profile_ok = user_connection.search(
                                search_base=effective_base_dn,
                                search_filter=fallback_filter,
                                attributes=["displayName", "cn", "givenName", "sn", "sAMAccountName", "userPrincipalName"],
                                size_limit=1,
                            )
                            if not profile_ok or not user_connection.entries:
                                continue

                            profile_entry = user_connection.entries[0]
                            profile_attrs = profile_entry.entry_attributes_as_dict
                            display_name = _pick_ldap_display_name(profile_attrs, short_username)
                            if not user_dn:
                                user_dn = profile_entry.entry_dn

                            sam_profile = _normalize_username((profile_attrs.get("sAMAccountName") or [short_username])[0] or short_username)
                            upn_profile = _normalize_username((profile_attrs.get("userPrincipalName") or [""])[0] or "")
                            if upn_profile:
                                canonical_username = upn_profile
                            elif sam_profile and upn_suffix:
                                canonical_username = f"{sam_profile}@{upn_suffix}"
                            elif sam_profile:
                                canonical_username = sam_profile
                            break
                        except Exception:
                            continue
        except Exception:
            pass

        # Fallback profile lookup: after successful bind, fetch user attributes again
        # to ensure display_name is populated with FIO from LDAP.
        if effective_base_dn and (not display_name or display_name == short_username):
            profile_filter = (
                f"(&(objectClass=user)(|(sAMAccountName={_escape_ldap_filter_value(short_username)})"
                f"(userPrincipalName={_escape_ldap_filter_value(canonical_username)})(mail={_escape_ldap_filter_value(canonical_username)})))"
            )

            for profile_conn in [search_connection, user_connection]:
                try:
                    profile_ok = profile_conn.search(
                        search_base=effective_base_dn,
                        search_filter=profile_filter,
                        attributes=["displayName", "cn", "givenName", "sn", "sAMAccountName", "userPrincipalName"],
                        size_limit=1,
                    )
                    if not profile_ok or not profile_conn.entries:
                        continue

                    profile_entry = profile_conn.entries[0]
                    profile_attrs = profile_entry.entry_attributes_as_dict
                    display_name = _pick_ldap_display_name(profile_attrs, short_username)

                    if not user_dn:
                        user_dn = profile_entry.entry_dn

                    sam_profile = _normalize_username((profile_attrs.get("sAMAccountName") or [short_username])[0] or short_username)
                    upn_profile = _normalize_username((profile_attrs.get("userPrincipalName") or [""])[0] or "")
                    if upn_profile:
                        canonical_username = upn_profile
                    elif sam_profile and upn_suffix:
                        canonical_username = f"{sam_profile}@{upn_suffix}"
                    elif sam_profile:
                        canonical_username = sam_profile
                    break
                except Exception:
                    continue

        user_connection.unbind()
        search_connection.unbind()

        # Last-resort fallback: resolve profile via directory listing strategy (same approach as /users/ldap page).
        if display_name == short_username or display_name == canonical_username:
            fallback = _ldap_directory_profile_fallback(
                settings=settings,
                host=host,
                port=port,
                use_ssl=use_ssl,
                aliases=[username, short_username, canonical_username],
                expected_dn=user_dn,
            )
            if fallback:
                display_name = fallback.get("display_name") or display_name
                canonical_username = _normalize_username(fallback.get("username") or canonical_username)
                user_dn = fallback.get("ldap_dn") or user_dn

        return True, {"username": canonical_username, "display_name": display_name, "ldap_dn": user_dn}, ""
    except LDAPBindError:
        return False, {}, "invalid"
    except (LDAPSocketOpenError, LDAPException, OSError):
        return False, {}, "connection"
    except Exception:
        return False, {}, "connection"


# Источники автоматических ролей, от старшей к младшей: член действующего комитета ректорского контроля
# (committee_members → tutors.login), преподаватель (tutors), обучающийся (platonus_students)
_AUTO_ROLE_SOURCES = (
    (ROLE_COMMITTEE, """SELECT LOWER(TRIM(t.login)) AS login FROM committee_members m
        JOIN committee_orders o ON o.id = m.order_id AND o.is_active = 1
        JOIN tutors t ON t.tutor_id = m.tutor_id WHERE TRIM(t.login) <> ''"""),
    (ROLE_TEACHER, "SELECT LOWER(TRIM(login)) AS login FROM tutors WHERE TRIM(login) <> ''"),
    (ROLE_STUDENT, "SELECT LOWER(TRIM(login)) AS login FROM platonus_students WHERE TRIM(login) <> ''"),
)


# Те же источники для проверки одного входа: сравнение по индексированному login без LOWER/TRIM —
# tutors.login сравнивается без учёта регистра (unicode_ci), platonus_students.login хранится в нижнем регистре
_AUTO_ROLE_LOOKUPS = (
    (ROLE_COMMITTEE, """SELECT 1 FROM committee_members m
        JOIN committee_orders o ON o.id = m.order_id AND o.is_active = 1
        JOIN tutors t ON t.tutor_id = m.tutor_id WHERE t.login IN :logins LIMIT 1"""),
    (ROLE_TEACHER, "SELECT 1 FROM tutors WHERE login IN :logins LIMIT 1"),
    (ROLE_STUDENT, "SELECT 1 FROM platonus_students WHERE login IN :logins LIMIT 1"),
)


def _auto_role(db, usernames: list[str], current: str) -> str:
    """Автоматическая роль для логинов (с доменом и без) по _AUTO_ROLE_LOOKUPS. Кого нет ни в одном источнике,
    роль не меняется — кроме «Члена комитета»: исключённый из состава становится «Пользователем»."""
    logins = sorted(({_short_ldap_username(name) for name in usernames if name}
                     | {(name or "").strip().lower() for name in usernames if name}) - {""})
    for role, query in _AUTO_ROLE_LOOKUPS:
        try:
            if logins and db.execute(
                text(query).bindparams(bindparam("logins", expanding=True)),
                {"logins": logins},
            ).first():
                return role
        except Exception:
            # Таблицы появляются после первой синхронизации справочников и расписания
            db.rollback()
    return ROLE_USER if current == ROLE_COMMITTEE else current


def sync_auto_roles() -> int:
    """Выставляет автоматические роли (AUTO_ROLES) всем учётным записям: член действующего комитета →
    «Член комитета КРК», преподаватель → «Преподаватель», обучающийся → «Студент». Кого нет в источниках,
    не трогает (неполная синхронизация не сбрасывает роли); исключённый из комитета становится «Пользователем».
    Вызывается при старте, после синхронизации справочников и расписания и после изменения состава комитета.
    Возвращает число изменённых учётных записей."""
    db = SessionLocal()
    try:
        _ensure_users_table(db)
        # Младшие источники читаются первыми, старшие перекрывают их для того же логина
        role_by_login: dict[str, str] = {}
        loaded = set()
        for role, source in reversed(_AUTO_ROLE_SOURCES):
            try:
                logins = db.execute(text(source)).scalars().all()
            except Exception:
                db.rollback()
                continue
            loaded.add(role)
            role_by_login.update(dict.fromkeys(logins, role))

        users = db.execute(
            text("SELECT u.username, r.name AS role_name FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name IN :roles")
            .bindparams(bindparam("roles", expanding=True)),
            {"roles": list(AUTO_ROLES)},
        ).mappings().all()
        rank = {role: index for index, (role, _) in enumerate(_AUTO_ROLE_SOURCES)}
        changes: dict[str, list[str]] = {}
        for row in users:
            found = {role_by_login.get(row["username"].lower()), role_by_login.get(_short_ldap_username(row["username"]))} - {None}
            target = min(found, key=rank.get) if found else None
            if target is None and row["role_name"] == ROLE_COMMITTEE and ROLE_COMMITTEE in loaded:
                target = ROLE_USER
            if target and target != row["role_name"]:
                changes.setdefault(target, []).append(row["username"])
        for role, usernames in changes.items():
            db.execute(
                text("UPDATE users SET role_id = :role_id WHERE username IN :usernames").bindparams(bindparam("usernames", expanding=True)),
                {"role_id": _get_role_id(db, role), "usernames": usernames},
            )
        db.commit()
        changed = sum(len(usernames) for usernames in changes.values())
        if changed:
            invalidate_account_state()
            logger.info("Auto roles: %s", {role: len(usernames) for role, usernames in changes.items()})
        return changed
    finally:
        db.close()


def resolve_ecp_account(db, iin: str) -> tuple[str | None, str, str]:
    """Вход по ЭЦП: ИИН из сертификата НУЦ → преподаватель (tutors.iin) или обучающийся (platonus_students.iin)
    Platonus → учётная запись КРК. Преподаватель проверяется первым.

    Возвращает (username, роль, источник или причина отказа). Существующая запись ищется по логину Platonus
    с доменом и без (LDAP хранит user@domain); её пароль и LDAP-DN не меняются, роль — только из AUTO_ROLES.
    Кто ещё не входил в КРК, получает учётную запись с автоматической ролью (член комитета, преподаватель, студент).
    """
    people, default_role = [], ROLE_USER
    # ИИН заполняют синхронизация справочников (tutors) и расписания (platonus_students);
    # колонки добавляют стартовые миграции
    for table, role in (("tutors", ROLE_TEACHER), ("platonus_students", ROLE_STUDENT)):
        try:
            people = db.execute(text(f"SELECT full_name, login FROM {table} WHERE iin = :iin"), {"iin": iin}).mappings().all()
        except Exception:
            db.rollback()
            continue
        if people:
            default_role = role
            break
    if not people:
        return None, ROLE_USER, "iin_not_found"
    logins = {_normalize_username(row["login"]) for row in people if (row["login"] or "").strip()}
    if len(logins) != 1:
        return None, ROLE_USER, "tutor_ambiguous" if logins else "tutor_login_missing"
    login = logins.pop()

    rows = db.execute(
        text("""
            SELECT u.username, r.name AS role_name
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.username = :login OR SUBSTRING_INDEX(u.username, '@', 1) = :login
            ORDER BY u.is_ldap DESC, u.last_login_at DESC
        """),
        {"login": login},
    ).mappings().all()
    if rows:
        username, role = rows[0]["username"], rows[0]["role_name"] or ROLE_USER
        if role in AUTO_ROLES:
            role = _auto_role(db, [username, login], role)
        db.execute(
            text("UPDATE users SET last_login_at = NOW(), role_id = :role_id WHERE username = :username"),
            {"username": username, "role_id": _get_role_id(db, role)},
        )
        db.commit()
        invalidate_account_state(username)
        return username, role, "ecp"

    display_name = next((row["full_name"] for row in people if row["full_name"]), "") or login
    role = _auto_role(db, [login], default_role)
    _upsert_user(
        db,
        username=login,
        display_name=display_name,
        auth_source="ecp",
        is_ldap=False,
        ldap_dn=None,
        password=None,
        role_name=role,
    )
    return login, role, "ecp"


def authenticate_user_details(username: str, password: str) -> tuple[bool, str, str, str]:
    normalized_username = _normalize_username(username)

    # Environment admin user still supported.
    is_env_admin_login = (
        bool(ADMIN_USERNAME and ADMIN_PASSWORD)
        and normalized_username == _normalize_username(ADMIN_USERNAME)
    )
    if is_env_admin_login and hmac.compare_digest((password or "").encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")):
        db = SessionLocal()
        try:
            _upsert_user(
                db,
                username=normalized_username,
                display_name=username,
                auth_source="local_admin",
                is_ldap=False,
                ldap_dn=None,
                password=password,
                role_name=ROLE_SUPERADMIN,
            )
        finally:
            db.close()
        return True, normalized_username, "local_admin", ROLE_SUPERADMIN

    # Env-админ входит только по актуальному ADMIN_PASSWORD: после ротации старый пароль
    # из локального кэша не должен подходить.
    if is_env_admin_login:
        return False, normalized_username, "invalid_credentials", ROLE_USER

    db = SessionLocal()
    try:
        ldap_settings = _get_ldap_settings(db)
        ldap_enabled = bool((ldap_settings.get("server_url") or "").strip())
        if not ldap_enabled and ldap_settings.get("host"):
            ldap_enabled = bool((ldap_settings.get("host") or "").strip())

        if ldap_enabled:
            ldap_ok, ldap_user, ldap_error = _ldap_authenticate(username, password, ldap_settings)
            if ldap_ok:
                short_alias = _short_ldap_username(ldap_user["username"])
                alias_candidates = [ldap_user["username"], short_alias, normalized_username]
                existing_rows = _get_cached_users_by_usernames(db, alias_candidates)
                existing = next((r for r in existing_rows if r.get("username") == ldap_user["username"]), None)
                if not existing:
                    existing = next(iter(existing_rows), None)
                effective_role = (existing or {}).get("role_name") or ROLE_USER
                # Преподаватель и обучающийся Platonus получают свою роль; назначенные администратором не меняются
                if effective_role in AUTO_ROLES:
                    effective_role = _auto_role(db, alias_candidates, effective_role)
                _upsert_user(
                    db,
                    username=ldap_user["username"],
                    display_name=ldap_user.get("display_name") or normalized_username,
                    auth_source="ldap",
                    is_ldap=True,
                    ldap_dn=ldap_user.get("ldap_dn"),
                    password=password,
                    role_name=effective_role,
                )
                _merge_legacy_usernames(db, ldap_user["username"], alias_candidates)
                return True, ldap_user["username"], "ldap", effective_role

            cached = _get_cached_user(db, username)
            # If LDAP is enabled, still allow local/manual users to sign in using local password.
            if cached and not bool(cached.get("is_ldap")) and _verify_password(password, cached.get("password_hash"), cached.get("password_salt")):
                _upsert_user(
                    db,
                    username=cached["username"],
                    display_name=cached.get("display_name") or cached["username"],
                    auth_source="local_cache",
                    is_ldap=False,
                    ldap_dn=None,
                    password=password,
                    role_name=(cached.get("role_name") or ROLE_USER),
                )
                return True, cached["username"], "local_cache", (cached.get("role_name") or ROLE_USER)

            if ldap_error in {"connection", "unavailable"}:
                if cached and _verify_password(password, cached.get("password_hash"), cached.get("password_salt")):
                    _upsert_user(
                        db,
                        username=cached["username"],
                        display_name=cached.get("display_name") or cached["username"],
                        auth_source="ldap_cache",
                        is_ldap=True,
                        ldap_dn=cached.get("ldap_dn"),
                        password=password,
                        role_name=(cached.get("role_name") or ROLE_USER),
                    )
                    return True, cached["username"], "ldap_cache", (cached.get("role_name") or ROLE_USER)

                return False, normalized_username, "ldap_unavailable", ROLE_USER

            return False, normalized_username, "invalid_credentials", ROLE_USER

        cached = _get_cached_user(db, username)
        if cached and _verify_password(password, cached.get("password_hash"), cached.get("password_salt")):
            _upsert_user(
                db,
                username=cached["username"],
                display_name=cached.get("display_name") or cached["username"],
                auth_source="local_cache",
                is_ldap=bool(cached.get("is_ldap")),
                ldap_dn=cached.get("ldap_dn"),
                password=password,
                role_name=(cached.get("role_name") or ROLE_USER),
            )
            return True, cached["username"], "local_cache", (cached.get("role_name") or ROLE_USER)

        return False, normalized_username, "invalid_credentials", ROLE_USER
    finally:
        db.close()


def create_access_token(data: dict) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _resolve_access_token(request: Request, bearer_token: str | None = Depends(oauth2_scheme)) -> str:
    if bearer_token:
        return bearer_token
    cookie_token = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie_token:
        return cookie_token
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(token: str = Depends(_resolve_access_token)) -> str:
    context = get_current_user_context(token)
    return context["username"]


def get_current_user_context(token: str = Depends(_resolve_access_token)) -> dict[str, str]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        auth_source = payload.get("auth_source") or "unknown"
    except JWTError:
        raise credentials_exception

    # JWT не отзывается сам по себе: удаление, блокировка администратором и смена роли
    # должны действовать сразу, поэтому роль берётся из БД, а не из токена.
    account = _get_account_state(username)
    if account is None or account["blocked"]:
        raise credentials_exception
    return {
        "username": username,
        "role": account["role"],
        "auth_source": str(auth_source),
        "faculty_id": account.get("faculty_id"),
    }


ACCOUNT_STATE_CACHE_SECONDS = 15
_account_state_cache: dict[str, tuple[float, dict]] = {}
_account_state_lock = Lock()
# Растёт при каждом сбросе: результат запроса, начатого до сброса, в кэш не попадёт
_account_state_generation = 0


def invalidate_account_state(username: str | None = None) -> None:
    global _account_state_generation
    with _account_state_lock:
        _account_state_generation += 1
        if username is None:
            _account_state_cache.clear()
        else:
            _account_state_cache.pop(_normalize_username(username), None)


def _get_account_state(username: str) -> dict | None:
    key = _normalize_username(username)
    now = monotonic()
    with _account_state_lock:
        cached = _account_state_cache.get(key)
        if cached and cached[0] > now:
            return cached[1]
        generation = _account_state_generation

    db = SessionLocal()
    try:
        row = db.execute(
            text("""
                SELECT u.is_blocked, u.blocked_until, u.block_reason, u.faculty_id, r.name AS role_name
                FROM users u
                LEFT JOIN roles r ON r.id = u.role_id
                WHERE u.username = :username
                LIMIT 1
            """),
            {"username": key},
        ).mappings().first()
    except Exception:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database unavailable")
    finally:
        db.close()

    state = None
    if row:
        role = (row.get("role_name") or ROLE_USER).strip().lower()
        blocked_until = row.get("blocked_until")
        # Автоблокировка за неверные пароли не обрывает уже открытые сессии,
        # иначе подбором пароля можно выбить пользователя из системы.
        blocked = (
            bool(row.get("is_blocked"))
            and row.get("block_reason") != "too_many_failed_attempts"
            and (blocked_until is None or blocked_until > datetime.utcnow())
        )
        role = role if role in ALL_ROLES else ROLE_USER
        faculty_id = row.get("faculty_id")
        # Деканат без факультета ничего не видит — права базовой роли «Пользователь»
        if role == ROLE_DEAN and not faculty_id:
            role = ROLE_USER
        state = {"role": role, "blocked": blocked, "faculty_id": faculty_id if role == ROLE_DEAN else None}

    # Отсутствие пользователя не кэшируется: иначе пересозданный или впервые вошедший
    # пользователь получал бы 401 до истечения TTL
    if state is not None:
        with _account_state_lock:
            if generation == _account_state_generation:
                _account_state_cache[key] = (now + ACCOUNT_STATE_CACHE_SECONDS, state)
    return state


def ensure_auth_schema() -> None:
    """Стартовая миграция таблиц users/roles (роли «Деканат» и «Пользователь», users.faculty_id)
    и разовый перевод сотрудников в «Пользователи»."""
    db = SessionLocal()
    try:
        _ensure_users_table(db)
        _migrate_staff_to_user(db)
        _promote_env_admin(db)
    finally:
        db.close()


def _promote_env_admin(db) -> None:
    """Встроенный аккаунт ADMIN_USERNAME — суперадминистратор (без ожидания его следующего входа)."""
    if not ADMIN_USERNAME:
        return
    username = _normalize_username(ADMIN_USERNAME)
    role_id = _get_role_id(db, ROLE_SUPERADMIN)
    changed = db.execute(
        text("UPDATE users SET role_id = :role_id WHERE username = :username AND COALESCE(role_id, 0) <> :role_id"),
        {"role_id": role_id, "username": username},
    ).rowcount
    db.commit()
    if changed:
        invalidate_account_state(username)


def _migrate_staff_to_user(db) -> None:
    """Разово: все «Сотрудники» становятся «Пользователями» (администраторы, инспекторы и деканаты — без изменений).
    Отметка в app_migrations не даёт повторить перевод и сбросить роли, назначенные позже."""
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS app_migrations (
            name VARCHAR(100) PRIMARY KEY,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))
    name = "2026_10_roles_staff_to_user"
    if db.execute(text("SELECT 1 FROM app_migrations WHERE name = :n"), {"n": name}).first():
        db.commit()
        return
    moved = db.execute(text("""
        UPDATE users
        SET role_id = (SELECT id FROM roles WHERE name = :user_role LIMIT 1)
        WHERE role_id = (SELECT id FROM (SELECT id FROM roles WHERE name = :staff_role LIMIT 1) AS r)
    """), {"user_role": ROLE_USER, "staff_role": ROLE_STAFF}).rowcount
    db.execute(text("INSERT INTO app_migrations (name) VALUES (:n)"), {"n": name})
    db.commit()
    invalidate_account_state()
    logger.info("Roles migration %s: %s staff users moved to %s", name, moved, ROLE_USER)


def require_roles(*allowed_roles: str):
    allowed = {r.strip().lower() for r in allowed_roles if r and r.strip()}

    def _checker(context: dict[str, str] = Depends(get_current_user_context)) -> dict[str, str]:
        # Суперадминистратор проходит любую проверку ролей
        if context.get("role") != ROLE_SUPERADMIN and context.get("role") not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return context

    return _checker
