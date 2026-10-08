from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from schemas.auth import LoginRequest, TokenOut
from services.request_meta import get_client_ip
from services.auth_service import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH_COOKIE_NAME,
    _ensure_users_table,
    authenticate_user_details,
    create_access_token,
    get_current_user_context,
    _resolve_access_token,
)
from services.audit_log import audit_event

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

    _ensure_users_table(db)

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
    token = create_access_token({"sub": normalized_username, "role": role, "auth_source": source})
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
    return context
