from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from fastapi import HTTPException, status, Depends, Request
from fastapi.security import OAuth2PasswordBearer
from dotenv import load_dotenv
from sqlalchemy import text
from database import SessionLocal
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

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "").strip()
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480"))
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "").strip()
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "").strip()

if not SECRET_KEY:
    raise RuntimeError("Environment variable SECRET_KEY is required")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)
AUTH_COOKIE_NAME = (os.getenv("AUTH_COOKIE_NAME") or "krk_access_token").strip() or "krk_access_token"

ROLE_ADMIN = "admin"
ROLE_INSPECTOR = "inspector"
ROLE_STAFF = "staff"
ALL_ROLES = {ROLE_ADMIN, ROLE_INSPECTOR, ROLE_STAFF}


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
            last_login_at DATETIME NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_users_last_login_at (last_login_at),
            KEY idx_users_role_id (role_id),
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

    # Backfill existing users with staff role by default.
    db.execute(text("""
        UPDATE users
        SET role_id = (SELECT id FROM roles WHERE name = :role_name LIMIT 1)
        WHERE role_id IS NULL
    """), {"role_name": ROLE_STAFF})
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
        {"name": ROLE_ADMIN},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_INSPECTOR},
    )
    db.execute(
        text("INSERT IGNORE INTO roles (name) VALUES (:name)"),
        {"name": ROLE_STAFF},
    )
    db.commit()


def _get_role_id(db, role_name: str) -> int | None:
    normalized = (role_name or "").strip().lower()
    if normalized not in ALL_ROLES:
        normalized = ROLE_STAFF

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
            return data
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

    role_id = _get_role_id(db, role_name or ROLE_STAFF)

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
    raw = (template or "").strip()
    if not raw:
        return f"(sAMAccountName={username})"
    if "{username}" in raw:
        return raw.replace("{username}", username)
    if raw.startswith("(") and raw.endswith(")"):
        return raw
    return f"(sAMAccountName={username})"


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
                tls = Tls(validate=ssl.CERT_NONE)

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
    short_username = _short_ldap_username(username)
    user_filter = _build_ldap_filter("", short_username)

    try:
        server = Server(host, port=port, use_ssl=use_ssl, get_info=ALL, connect_timeout=5)

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
                upn_value = f"{short_username}@{upn_suffix}"
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
                f"(&(objectClass=user)(|(sAMAccountName={short_username})"
                f"(userPrincipalName={canonical_username})(mail={canonical_username})))"
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


def authenticate_user_details(username: str, password: str) -> tuple[bool, str, str, str]:
    normalized_username = _normalize_username(username)

    # Environment admin user still supported.
    if ADMIN_USERNAME and ADMIN_PASSWORD and hmac.compare_digest(username, ADMIN_USERNAME) and hmac.compare_digest(password, ADMIN_PASSWORD):
        db = SessionLocal()
        try:
            _ensure_users_table(db)
            _upsert_user(
                db,
                username=normalized_username,
                display_name=username,
                auth_source="local_admin",
                is_ldap=False,
                ldap_dn=None,
                password=password,
                role_name=ROLE_ADMIN,
            )
        finally:
            db.close()
        return True, normalized_username, "local_admin", ROLE_ADMIN

    db = SessionLocal()
    try:
        _ensure_users_table(db)
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
                effective_role = (existing or {}).get("role_name") or ROLE_STAFF
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
                    role_name=(cached.get("role_name") or ROLE_STAFF),
                )
                return True, cached["username"], "local_cache", (cached.get("role_name") or ROLE_STAFF)

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
                        role_name=(cached.get("role_name") or ROLE_STAFF),
                    )
                    return True, cached["username"], "ldap_cache", (cached.get("role_name") or ROLE_STAFF)

                return False, normalized_username, "ldap_unavailable", ROLE_STAFF

            return False, normalized_username, "invalid_credentials", ROLE_STAFF

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
                role_name=(cached.get("role_name") or ROLE_STAFF),
            )
            return True, cached["username"], "local_cache", (cached.get("role_name") or ROLE_STAFF)

        return False, normalized_username, "invalid_credentials", ROLE_STAFF
    finally:
        db.close()


def authenticate_user(username: str, password: str) -> bool:
    ok, _, _, _ = authenticate_user_details(username, password)
    return ok


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
        role = (payload.get("role") or ROLE_STAFF).strip().lower()
        if role not in ALL_ROLES:
            role = ROLE_STAFF
        auth_source = payload.get("auth_source") or "unknown"
    except JWTError:
        raise credentials_exception
    return {
        "username": username,
        "role": role,
        "auth_source": str(auth_source),
    }


def require_roles(*allowed_roles: str):
    allowed = {r.strip().lower() for r in allowed_roles if r and r.strip()}

    def _checker(context: dict[str, str] = Depends(get_current_user_context)) -> dict[str, str]:
        if context.get("role") not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Недостаточно прав")
        return context

    return _checker
