import json
import os
import site
import socket
import ssl
import subprocess
import sys
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from services import ROLE_ADMIN, require_roles

router = APIRouter(prefix="/settings", tags=["settings"])


def _import_ldap3_for_settings():
    try:
        from ldap3 import Connection, Server, Tls
        from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError
        return Connection, Server, Tls, LDAPException, LDAPSocketOpenError
    except Exception as first_exc:
        user_site = site.getusersitepackages()
        if isinstance(user_site, str) and user_site and user_site not in sys.path:
            sys.path.append(user_site)
        vendor_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "vendor"))
        if vendor_path not in sys.path:
            sys.path.append(vendor_path)
        try:
            from ldap3 import Connection, Server, Tls
            from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError
            return Connection, Server, Tls, LDAPException, LDAPSocketOpenError
        except Exception:
            install_cmds = [
                [sys.executable, "-m", "pip", "install", "--user", "--break-system-packages", "ldap3"],
                [sys.executable, "-m", "pip", "install", "ldap3"],
                [sys.executable, "-m", "pip", "install", "--target", vendor_path, "ldap3"],
            ]
            for cmd in install_cmds:
                try:
                    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=35)
                    from ldap3 import Connection, Server, Tls
                    from ldap3.core.exceptions import LDAPException, LDAPSocketOpenError
                    return Connection, Server, Tls, LDAPException, LDAPSocketOpenError
                except Exception:
                    continue
            raise RuntimeError(str(first_exc)) from first_exc


class LdapSettings(BaseModel):
    server_url: str = ""
    base_dn: str = ""
    bind_dn: str = ""
    bind_password: str = ""
    certificate_key: str = ""


def _parse_ldap_server_url(server_url: str) -> tuple[str, int, bool]:
    raw = (server_url or "").strip()
    if not raw:
        raise ValueError("Укажите URL LDAP сервера")

    if "://" not in raw:
        raw = f"ldaps://{raw}"

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"ldap", "ldaps"}:
        raise ValueError("URL должен начинаться с ldap:// или ldaps://")

    host = (parsed.hostname or "").strip()
    if not host:
        raise ValueError("В URL LDAP сервера не указан host")

    use_ssl = scheme == "ldaps"
    port = parsed.port or (636 if use_ssl else 389)
    return host, port, use_ssl


class LdapTestResult(BaseModel):
    success: bool
    message: str
    details: str | None = None


def _ensure_settings_table(db: Session) -> None:
    db.execute(text("""
        CREATE TABLE IF NOT EXISTS system_settings (
            `key` VARCHAR(128) PRIMARY KEY,
            value_text LONGTEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    """))
    db.commit()


@router.get("/ldap", response_model=LdapSettings)
def get_ldap_settings(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    try:
        _ensure_settings_table(db)
        row = db.execute(
            text("SELECT value_text FROM system_settings WHERE `key` = 'ldap' LIMIT 1")
        ).mappings().first()

        if not row:
            return LdapSettings()

        data = json.loads(row["value_text"])
        if isinstance(data, dict) and "server_url" not in data:
            host = (data.get("host") or "").strip()
            if host:
                scheme = "ldaps" if data.get("use_ssl") else "ldap"
                port = int(data.get("port") or (636 if data.get("use_ssl") else 389))
                data["server_url"] = f"{scheme}://{host}:{port}"
        return LdapSettings(**data)
    except (SQLAlchemyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Не удалось загрузить LDAP настройки") from exc


@router.put("/ldap", response_model=LdapSettings)
def save_ldap_settings(
    body: LdapSettings,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    try:
        _ensure_settings_table(db)
        payload = body.model_dump()

        db.execute(
            text("""
                INSERT INTO system_settings (`key`, value_text)
                VALUES ('ldap', :value_text)
                ON DUPLICATE KEY UPDATE value_text = :value_text
            """),
            {"value_text": json.dumps(payload, ensure_ascii=False)},
        )
        db.commit()
        return body
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить LDAP настройки") from exc


@router.post("/ldap/test", response_model=LdapTestResult)
def test_ldap_settings(
    body: LdapSettings,
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    try:
        host, port, use_ssl = _parse_ldap_server_url(body.server_url)
    except ValueError as exc:
        return LdapTestResult(success=False, message="Некорректный URL LDAP сервера", details=str(exc))

    if not body.base_dn.strip() or not body.bind_dn.strip() or not body.bind_password:
        return LdapTestResult(
            success=False,
            message="Для теста укажите Base DN, Bind DN и пароль AD",
        )

    timeout_seconds = 5
    tls_details = ""

    try:
        with socket.create_connection((host, port), timeout=timeout_seconds) as raw_socket:
            if not use_ssl:
                return LdapTestResult(success=False, message="Используйте ldaps:// URL для безопасного подключения")

            context = ssl.create_default_context()
            certificate_key = body.certificate_key.strip()

            if certificate_key:
                context.load_verify_locations(cadata=certificate_key)
            else:
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

            server_hostname = host if context.check_hostname else None
            with context.wrap_socket(raw_socket, server_hostname=server_hostname) as secured_socket:
                cipher = secured_socket.cipher()
                cipher_name = cipher[0] if cipher else "unknown"
                tls_details = f"{host}:{port}, cipher={cipher_name}"

    except Exception as exc:  # pragma: no cover - network dependent
        return LdapTestResult(
            success=False,
            message="Тест LDAP подключения не пройден",
            details=str(exc),
        )

    try:
        Connection, Server, Tls, LDAPException, LDAPSocketOpenError = _import_ldap3_for_settings()
        ldap_errors = (LDAPSocketOpenError, LDAPException, OSError)
    except Exception as exc:
        return LdapTestResult(
            success=False,
            message="LDAP клиент недоступен",
            details=str(exc),
        )

    try:
        tls = None
        certificate_key = body.certificate_key.strip()
        if use_ssl:
            if certificate_key:
                tls = Tls(validate=ssl.CERT_REQUIRED, ca_certs_data=certificate_key)
            else:
                tls = Tls(validate=ssl.CERT_NONE)

        server = Server(host, port=port, use_ssl=use_ssl, tls=tls, connect_timeout=timeout_seconds)
        conn = Connection(server, user=body.bind_dn.strip(), password=body.bind_password, auto_bind=True)
        conn.search(
            search_base=body.base_dn.strip(),
            search_filter="(objectClass=*)",
            attributes=["distinguishedName"],
            size_limit=1,
        )
        conn.unbind()
        return LdapTestResult(
            success=True,
            message="LDAP bind выполнен успешно",
            details=tls_details or f"{host}:{port}",
        )
    except ldap_errors as exc:
        return LdapTestResult(
            success=False,
            message="LDAP bind не выполнен",
            details=str(exc),
        )
    except Exception as exc:
        return LdapTestResult(
            success=False,
            message="LDAP клиент недоступен",
            details=str(exc),
        )