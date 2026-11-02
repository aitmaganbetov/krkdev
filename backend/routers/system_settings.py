import json
import os
import site
import socket
import ssl
import sys
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from database import get_db
from services import ROLE_SUPERADMIN, require_roles
from services.audit_log import audit_event
from services.camera_settings import (
    LIVE_MAX_STREAMS_RANGE,
    active_live_streams,
    default_live_max_streams,
    get_live_max_streams,
    save_live_max_streams,
)
from services.secret_box import encrypt_secret, decode_ldap_settings

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
            raise RuntimeError(
                "ldap3 dependency is unavailable. Install ldap3 during build/deploy; runtime installation is disabled."
            ) from first_exc


class LdapSettings(BaseModel):
    server_url: str = ""
    base_dn: str = ""
    bind_dn: str = ""
    # Пустой пароль при сохранении и тесте означает «оставить сохранённый»
    bind_password: str = ""
    certificate_key: str = ""


class LdapSettingsOut(BaseModel):
    # Пароль bind-учётки наружу не отдаётся, только признак, что он задан
    server_url: str = ""
    base_dn: str = ""
    bind_dn: str = ""
    bind_password: str = ""
    bind_password_configured: bool = False
    certificate_key: str = ""


def _load_stored_ldap(db: Session) -> dict:
    row = db.execute(
        text("SELECT value_text FROM system_settings WHERE `key` = 'ldap' LIMIT 1")
    ).mappings().first()
    if not row:
        return {}
    data = json.loads(row["value_text"])
    if not isinstance(data, dict):
        return {}
    if "server_url" not in data:
        host = (data.get("host") or "").strip()
        if host:
            scheme = "ldaps" if data.get("use_ssl") else "ldap"
            port = int(data.get("port") or (636 if data.get("use_ssl") else 389))
            data["server_url"] = f"{scheme}://{host}:{port}"
    return decode_ldap_settings(data)


def _ldap_out(data: dict) -> LdapSettingsOut:
    return LdapSettingsOut(
        server_url=data.get("server_url") or "",
        base_dn=data.get("base_dn") or "",
        bind_dn=data.get("bind_dn") or "",
        bind_password_configured=bool(data.get("bind_password")),
        certificate_key=data.get("certificate_key") or "",
    )


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


@router.get("/ldap", response_model=LdapSettingsOut)
def get_ldap_settings(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    try:
        return _ldap_out(_load_stored_ldap(db))
    except (SQLAlchemyError, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Не удалось загрузить LDAP настройки") from exc


@router.put("/ldap", response_model=LdapSettingsOut)
def save_ldap_settings(
    body: LdapSettings,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    try:
        payload = body.model_dump(exclude={"bind_password"})
        bind_password = body.bind_password
        if not bind_password:
            bind_password = _load_stored_ldap(db).get("bind_password") or ""
        payload["bind_password_encrypted"] = encrypt_secret(bind_password)

        db.execute(
            text("""
                INSERT INTO system_settings (`key`, value_text)
                VALUES ('ldap', :value_text)
                ON DUPLICATE KEY UPDATE value_text = :value_text
            """),
            {"value_text": json.dumps(payload, ensure_ascii=False)},
        )
        db.commit()
        audit_event(
            action="admin.settings.ldap.save",
            outcome="success",
            actor=context.get("username"),
            details={"has_server_url": bool((body.server_url or "").strip())},
        )
        return _ldap_out({**payload, "bind_password": bind_password})
    except SQLAlchemyError as exc:
        db.rollback()
        audit_event(
            action="admin.settings.ldap.save",
            outcome="failure",
            actor=context.get("username"),
            details={"error": type(exc).__name__},
        )
        raise HTTPException(status_code=500, detail="Не удалось сохранить LDAP настройки") from exc


@router.post("/ldap/test", response_model=LdapTestResult)
def test_ldap_settings(
    body: LdapSettings,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    if not body.bind_password:
        try:
            stored_password = _load_stored_ldap(db).get("bind_password") or ""
        except (SQLAlchemyError, ValueError, TypeError):
            stored_password = ""
        body = body.model_copy(update={"bind_password": stored_password})
    try:
        host, port, use_ssl = _parse_ldap_server_url(body.server_url)
    except ValueError as exc:
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "invalid_server_url"},
        )
        return LdapTestResult(success=False, message="Некорректный URL LDAP сервера", details=str(exc))

    if not body.base_dn.strip() or not body.bind_dn.strip() or not body.bind_password:
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "missing_required_fields", "host": host, "port": port, "use_ssl": use_ssl},
        )
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

            ssl_ctx = ssl.create_default_context()
            certificate_key = body.certificate_key.strip()

            if certificate_key:
                ssl_ctx.load_verify_locations(cadata=certificate_key)

            with ssl_ctx.wrap_socket(raw_socket, server_hostname=host) as secured_socket:
                cipher = secured_socket.cipher()
                cipher_name = cipher[0] if cipher else "unknown"
                tls_details = f"{host}:{port}, cipher={cipher_name}"

    except Exception as exc:  # pragma: no cover - network dependent
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "tls_connection_failed", "host": host, "port": port, "use_ssl": use_ssl, "error": type(exc).__name__},
        )
        return LdapTestResult(
            success=False,
            message="Тест LDAP подключения не пройден",
            details=str(exc),
        )

    try:
        Connection, Server, Tls, LDAPException, LDAPSocketOpenError = _import_ldap3_for_settings()
        ldap_errors = (LDAPSocketOpenError, LDAPException, OSError)
    except Exception as exc:
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "ldap_client_unavailable", "error": type(exc).__name__},
        )
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
                tls = Tls(validate=ssl.CERT_REQUIRED)

        server = Server(host, port=port, use_ssl=use_ssl, tls=tls, connect_timeout=timeout_seconds)
        conn = Connection(server, user=body.bind_dn.strip(), password=body.bind_password, auto_bind=True)
        conn.search(
            search_base=body.base_dn.strip(),
            search_filter="(objectClass=*)",
            attributes=["distinguishedName"],
            size_limit=1,
        )
        conn.unbind()
        audit_event(
            action="admin.settings.ldap.test",
            outcome="success",
            actor=context.get("username"),
            details={"host": host, "port": port, "use_ssl": use_ssl},
        )
        return LdapTestResult(
            success=True,
            message="LDAP bind выполнен успешно",
            details=tls_details or f"{host}:{port}",
        )
    except ldap_errors as exc:
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "ldap_bind_failed", "host": host, "port": port, "use_ssl": use_ssl, "error": type(exc).__name__},
        )
        return LdapTestResult(
            success=False,
            message="LDAP bind не выполнен",
            details=str(exc),
        )
    except Exception as exc:
        audit_event(
            action="admin.settings.ldap.test",
            outcome="failure",
            actor=context.get("username"),
            details={"reason": "ldap_client_exception", "host": host, "port": port, "use_ssl": use_ssl, "error": type(exc).__name__},
        )
        return LdapTestResult(
            success=False,
            message="LDAP клиент недоступен",
            details=str(exc),
        )

class CameraSettings(BaseModel):
    live_max_streams: int = Field(ge=LIVE_MAX_STREAMS_RANGE[0], le=LIVE_MAX_STREAMS_RANGE[1])


class CameraSettingsOut(CameraSettings):
    default_live_max_streams: int
    active_live_streams: int
    cpu_count: int


def _camera_out(db: Session) -> CameraSettingsOut:
    return CameraSettingsOut(
        live_max_streams=get_live_max_streams(db),
        default_live_max_streams=default_live_max_streams(),
        active_live_streams=active_live_streams(),
        cpu_count=os.cpu_count() or 1,
    )


@router.get("/cameras", response_model=CameraSettingsOut)
def get_camera_settings(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    return _camera_out(db)


@router.put("/cameras", response_model=CameraSettingsOut)
def save_camera_settings(
    body: CameraSettings,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_SUPERADMIN)),
):
    previous = get_live_max_streams(db)
    try:
        save_live_max_streams(db, body.live_max_streams)
    except SQLAlchemyError as exc:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить настройки камер") from exc
    audit_event(
        action="admin.settings.cameras.save",
        outcome="success",
        actor=context.get("username"),
        details={"live_max_streams": body.live_max_streams, "previous": previous},
    )
    return _camera_out(db)
