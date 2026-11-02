from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock
import logging
import os
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from schemas.auth import EcpLoginRequest, LoginRequest, TokenOut
from services import kalkan_service
from services.request_meta import get_client_ip
from services.auth_service import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH_COOKIE_NAME,
    authenticate_user_details,
    create_access_token,
    get_current_user_context,
    resolve_ecp_account,
)
from services.audit_log import audit_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_ATTEMPT_WINDOW_SECONDS = int(os.getenv("LOGIN_ATTEMPT_WINDOW_SECONDS", "300"))
LOGIN_MAX_FAILED_ATTEMPTS = int(os.getenv("LOGIN_MAX_FAILED_ATTEMPTS", "5"))
# Лимит на IP выше лимита на пару: за NAT/прокси университета несколько человек делят один адрес
LOGIN_MAX_FAILED_PER_IP = int(os.getenv("LOGIN_MAX_FAILED_PER_IP", "50"))
LOGIN_LOCKOUT_SECONDS = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "900"))
AUTH_COOKIE_SECURE = (os.getenv("AUTH_COOKIE_SECURE", "true").strip().lower() in {"1", "true", "yes", "on"})
AUTH_COOKIE_SAMESITE = (os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower() or "lax")

# Неудачные попытки считаются по паре «логин + IP» и по IP, а не по одному логину:
# иначе любой мог бы заблокировать чужую учётную запись (в том числе admin), просто
# вводя неверный пароль. Блокируется источник подбора, сама учётная запись — нет.
# Счётчики в памяти процесса (backend запускается одним воркером uvicorn).
_failed_attempts: dict[str, deque[datetime]] = defaultdict(deque)
_locked_until: dict[str, datetime] = {}
_attempts_lock = Lock()


def _attempt_keys(username: str, client_ip: str) -> tuple[str, str]:
    normalized_username = (username or "").strip().lower()
    ip = (client_ip or "unknown").strip()
    return f"user:{normalized_username}|ip:{ip}", f"ip:{ip}"


def _is_rate_limited(keys: tuple[str, ...], now: datetime) -> bool:
    with _attempts_lock:
        for key in keys:
            until = _locked_until.get(key)
            if until is None:
                continue
            if now < until:
                return True
            _locked_until.pop(key, None)
        return False


def _register_failed_attempt(pair_key: str, ip_key: str, now: datetime) -> bool:
    """Регистрирует неудачную попытку; True — источник заблокирован на LOGIN_LOCKOUT_SECONDS."""
    window_start = now - timedelta(seconds=LOGIN_ATTEMPT_WINDOW_SECONDS)
    locked = False
    with _attempts_lock:
        for key, limit in ((pair_key, LOGIN_MAX_FAILED_ATTEMPTS), (ip_key, LOGIN_MAX_FAILED_PER_IP)):
            attempts = _failed_attempts[key]
            while attempts and attempts[0] < window_start:
                attempts.popleft()
            attempts.append(now)
            if len(attempts) >= limit:
                attempts.clear()
                _locked_until[key] = now + timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
                locked = True
        # Ограничиваем рост словаря при переборе множества логинов
        if len(_failed_attempts) > 10000:
            for key in [k for k, v in _failed_attempts.items() if not v or v[-1] < window_start]:
                _failed_attempts.pop(key, None)
        if len(_locked_until) > 10000:
            for key in [k for k, until in _locked_until.items() if until <= now]:
                _locked_until.pop(key, None)
    return locked


def _block_message(reason: str | None, blocked_until: datetime | None) -> str:
    # too_many_failed_attempts остаётся только у старых автоблокировок, созданных до перехода на лимит по IP
    if reason == "too_many_failed_attempts":
        return "Слишком много попыток входа. Попробуйте позже."
    if blocked_until:
        return "Пользователь временно заблокирован администратором"
    return "Пользователь заблокирован администратором"


def _clear_attempts(key: str) -> None:
    with _attempts_lock:
        _failed_attempts.pop(key, None)


def _read_user_block_state(db: Session, username: str, now: datetime) -> tuple[bool, str | None, datetime | None]:
    row = db.execute(
        text("""
        SELECT is_blocked, blocked_until, block_reason
        FROM users
        WHERE username = :username
        LIMIT 1
        """),
        {"username": username},
    ).mappings().first()
    if not row:
        return False, None, None

    is_blocked = bool(row.get("is_blocked"))
    blocked_until = row.get("blocked_until")
    reason = row.get("block_reason")

    if not is_blocked:
        return False, reason, blocked_until

    # blocked_until хранится как naive UTC (UTC_TIMESTAMP), сравниваем в той же форме
    now_utc = now.astimezone(timezone.utc).replace(tzinfo=None) if now.tzinfo else now
    if blocked_until is not None and blocked_until.tzinfo is not None:
        blocked_until = blocked_until.astimezone(timezone.utc).replace(tzinfo=None)

    if blocked_until and now_utc >= blocked_until:
        db.execute(
            text("""
            UPDATE users
            SET is_blocked = 0,
                blocked_until = NULL,
                block_reason = NULL
            WHERE username = :username
            """),
            {"username": username},
        )
        db.commit()
        return False, None, None

    return True, reason, blocked_until


def _extract_access_token(request: Request) -> str | None:
    auth_header = request.headers.get("Authorization", "")
    if auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
        if token:
            return token

    cookie_token = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie_token:
        return cookie_token

    return None


def _get_request_context_if_valid(request: Request) -> dict[str, str] | None:
    token = _extract_access_token(request)
    if not token:
        return None

    try:
        return get_current_user_context(token)
    except HTTPException:
        return None


def _resolve_me_context(request: Request, db: Session) -> dict[str, str]:
    client_ip = get_client_ip(request)
    token = _extract_access_token(request)
    if not token:
        audit_event(
            action="auth.me",
            outcome="failure",
            actor="unknown",
            details={"ip": client_ip, "reason": "missing_credentials"},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        context = get_current_user_context(token)
    except HTTPException as exc:
        audit_event(
            action="auth.me",
            outcome="failure",
            actor="unknown",
            details={"ip": client_ip, "reason": "invalid_or_expired_token"},
            db=db,
            ip_address=client_ip,
        )
        raise exc

    audit_event(
        action="auth.me",
        outcome="success",
        actor=context.get("username"),
        details={"ip": client_ip, "role": context.get("role"), "source": context.get("auth_source")},
        db=db,
        ip_address=client_ip,
    )
    return context


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    client_ip = get_client_ip(request)
    pair_key, ip_key = _attempt_keys(body.username, client_ip)
    username = (body.username or "").strip().lower()

    if _is_rate_limited((pair_key, ip_key), now):
        audit_event(
            action="auth.login",
            outcome="blocked",
            actor=username,
            details={"ip": client_ip, "reason": "rate_limited"},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток входа. Попробуйте позже.",
        )


    blocked, block_reason, blocked_until = _read_user_block_state(db, username, now)
    if blocked:
        audit_event(
            action="auth.login",
            outcome="blocked",
            actor=username,
            details={
                "ip": client_ip,
                "reason": block_reason or "user_blocked",
                "blocked_until": blocked_until.isoformat() if blocked_until else None,
            },
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=_block_message(block_reason, blocked_until),
        )

    authenticated, normalized_username, source, role = authenticate_user_details(body.username, body.password)

    # Блокировка ищется по введённому логину, а LDAP приводит его к каноническому
    # (a.petrov -> a.petrov@domain): проверяем ещё раз уже по каноническому имени.
    if authenticated and normalized_username != username:
        blocked, block_reason, blocked_until = _read_user_block_state(db, normalized_username, now)
        if blocked:
            audit_event(
                action="auth.login",
                outcome="blocked",
                actor=normalized_username,
                details={
                    "ip": client_ip,
                    "reason": block_reason or "user_blocked",
                    "blocked_until": blocked_until.isoformat() if blocked_until else None,
                },
                db=db,
                ip_address=client_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=_block_message(block_reason, blocked_until),
            )

    if not authenticated:
        if _register_failed_attempt(pair_key, ip_key, now):
            audit_event(
                action="auth.login",
                outcome="blocked",
                actor=username,
                details={"ip": client_ip, "reason": "too_many_failed_attempts"},
                db=db,
                ip_address=client_ip,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
            )
        audit_event(
            action="auth.login",
            outcome="failure",
            actor=username,
            details={"ip": client_ip, "source": source},
            db=db,
            ip_address=client_ip,
        )
        detail = "Invalid username or password"
        if source == "ldap_unavailable":
            detail = "LDAP недоступен. Вход возможен только для ранее авторизованных пользователей."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )

    _clear_attempts(pair_key)
    audit_event(
        action="auth.login",
        outcome="success",
        actor=normalized_username,
        details={"ip": client_ip, "role": role, "source": source},
        db=db,
        ip_address=client_ip,
    )
    return _start_session(response, normalized_username, role, source)


def _start_session(response: Response, username: str, role: str, source: str) -> TokenOut:
    token = create_access_token({"sub": username, "role": role, "auth_source": source})
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=AUTH_COOKIE_SECURE,
        samesite=AUTH_COOKIE_SAMESITE,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    return TokenOut(access_token=token, role=role)


# Вход по ЭЦП НУЦ: браузер получает одноразовый nonce, подписывает его в NCALayer (CMS с данными),
# сервер проверяет подпись (цепочка до НУЦ, OCSP), гасит nonce и ищет учётную запись по ИИН из сертификата.
# Nonce хранится в памяти процесса, как и счётчики попыток (backend — один воркер uvicorn).
ECP_NONCE_TTL_SECONDS = 300
ECP_NONCE_PREFIX = "krk-ecp-login:"
_ecp_nonces: dict[str, datetime] = {}
_ecp_lock = Lock()

ECP_REJECT_MESSAGES = {
    "iin_not_found": "Владелец сертификата не найден среди преподавателей и студентов Platonus",
    "tutor_login_missing": "В Platonus не указан логин владельца сертификата — вход по ЭЦП невозможен",
    "tutor_ambiguous": "ИИН сертификата указан у нескольких человек в Platonus — обратитесь к администратору",
    "iin_unavailable": "Справочник преподавателей не синхронизирован с Platonus",
}


def _iin_hint(iin: str) -> str:
    # ИИН — персональные данные (в нём дата рождения): в журнал — только последние цифры
    return f"********{iin[-4:]}" if iin else ""


@router.get("/ecp")
def ecp_status():
    return {"enabled": kalkan_service.is_available()}


@router.post("/ecp/challenge")
def ecp_challenge(request: Request):
    now = datetime.now(timezone.utc)
    if not kalkan_service.is_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Вход по ЭЦП не настроен")
    if _is_rate_limited(_attempt_keys("ecp", get_client_ip(request)), now):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Слишком много попыток входа. Попробуйте позже.")
    nonce = ECP_NONCE_PREFIX + secrets.token_urlsafe(32)
    with _ecp_lock:
        for key in [k for k, expires in _ecp_nonces.items() if expires <= now]:
            _ecp_nonces.pop(key, None)
        if len(_ecp_nonces) >= 10000:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Слишком много попыток входа. Попробуйте позже.")
        _ecp_nonces[nonce] = now + timedelta(seconds=ECP_NONCE_TTL_SECONDS)
    return {"nonce": nonce, "expires_in": ECP_NONCE_TTL_SECONDS}


def _consume_ecp_nonce(nonce: str, now: datetime) -> bool:
    with _ecp_lock:
        expires = _ecp_nonces.pop(nonce, None)
    return expires is not None and now < expires


@router.post("/ecp/login", response_model=TokenOut)
def ecp_login(body: EcpLoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    client_ip = get_client_ip(request)
    pair_key, ip_key = _attempt_keys("ecp", client_ip)

    def reject(reason: str, detail: str, code: int = status.HTTP_401_UNAUTHORIZED, actor: str = "unknown", **extra):
        if code == status.HTTP_401_UNAUTHORIZED and _register_failed_attempt(pair_key, ip_key, now):
            reason, code, detail = "too_many_failed_attempts", status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток входа. Попробуйте позже."
        audit_event(
            action="auth.ecp_login",
            outcome="blocked" if code in (status.HTTP_403_FORBIDDEN, status.HTTP_429_TOO_MANY_REQUESTS) else "failure",
            actor=actor,
            details={"ip": client_ip, "reason": reason, **extra},
            db=db,
            ip_address=client_ip,
        )
        raise HTTPException(status_code=code, detail=detail)

    if _is_rate_limited((pair_key, ip_key), now):
        reject("rate_limited", "Слишком много попыток входа. Попробуйте позже.", status.HTTP_429_TOO_MANY_REQUESTS)
    if not kalkan_service.is_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Вход по ЭЦП не настроен")

    try:
        result = kalkan_service.verify_cms(body.cms)
    except kalkan_service.KalkanError as exc:
        error = str(exc)
        logger.info("ЭЦП: подпись отклонена: %s", error[-300:])
        reason = kalkan_service.rejection_reason(exc)
        if reason:
            # Издатель и срок — без ИИН: только реквизиты удостоверяющего центра
            reject(reason[0], reason[1], issuer=(exc.cert.issuer_dn if exc.cert else "")[:200],
                   valid_to=exc.cert.not_after if exc.cert else "")
        if "OCSP" in error and ("connect" in error.lower() or "0x8f00031" in error.lower()):
            reject("ocsp_unavailable", "Сервис проверки сертификатов НУЦ недоступен. Попробуйте позже.",
                   status.HTTP_503_SERVICE_UNAVAILABLE)
        reject("signature_invalid", "Подпись не прошла проверку", error=error[-200:])

    cert = result.cert
    extra = {"cert_sn": cert.extra.get("cert_sn", ""), "iin_hint": _iin_hint(cert.iin)}
    if not _consume_ecp_nonce((result.data or b"").decode("utf-8", "replace"), now):
        reject("nonce_invalid", "Запрос на вход устарел. Попробуйте ещё раз.", **extra)
    if not cert.iin:
        reject("no_iin", "В сертификате нет ИИН", **extra)

    username, role, source = resolve_ecp_account(db, cert.iin)
    if not username:
        reject(source, ECP_REJECT_MESSAGES.get(source, "Вход по ЭЦП невозможен"), **extra)

    blocked, block_reason, blocked_until = _read_user_block_state(db, username, now)
    if blocked:
        reject(block_reason or "user_blocked", _block_message(block_reason, blocked_until), status.HTTP_403_FORBIDDEN,
               actor=username, **extra)

    _clear_attempts(pair_key)
    audit_event(
        action="auth.ecp_login",
        outcome="success",
        actor=username,
        details={"ip": client_ip, "role": role, "source": source, **extra},
        db=db,
        ip_address=client_ip,
    )
    return _start_session(response, username, role, source)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    client_ip = get_client_ip(request)
    logout_reason = request.headers.get("X-Logout-Reason") or "manual"
    context = _get_request_context_if_valid(request)
    audit_event(
        action="auth.logout",
        outcome="success",
        actor=(context or {}).get("username") or "unknown",
        details={
            "ip": client_ip,
            "role": (context or {}).get("role"),
            "source": (context or {}).get("auth_source"),
            "reason": logout_reason,
        },
        db=db,
        ip_address=client_ip,
    )
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(request: Request, db: Session = Depends(get_db)):
    context = _resolve_me_context(request, db)
    # ФИО для шапки интерфейса; у учётной записи без имени (или где имя = логин) — пусто
    name = db.execute(
        text("SELECT display_name FROM users WHERE username = :username LIMIT 1"),
        {"username": context.get("username")},
    ).scalar()
    return {**context, "display_name": name if name and name != context.get("username") else ""}
