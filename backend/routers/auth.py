from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from database import get_db
from schemas.auth import LoginRequest, TokenOut
from services.auth_service import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH_COOKIE_NAME,
    authenticate_user_details,
    create_access_token,
    get_current_user_context,
    _resolve_access_token,
)
from services.audit_log import audit_event

router = APIRouter(prefix="/auth", tags=["auth"])

LOGIN_ATTEMPT_WINDOW_SECONDS = int(os.getenv("LOGIN_ATTEMPT_WINDOW_SECONDS", "300"))
LOGIN_MAX_FAILED_ATTEMPTS = int(os.getenv("LOGIN_MAX_FAILED_ATTEMPTS", "5"))
LOGIN_LOCKOUT_SECONDS = int(os.getenv("LOGIN_LOCKOUT_SECONDS", "900"))
AUTH_COOKIE_SECURE = (os.getenv("AUTH_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"})
AUTH_COOKIE_SAMESITE = (os.getenv("AUTH_COOKIE_SAMESITE", "lax").strip().lower() or "lax")

_failed_attempts: dict[str, deque[datetime]] = defaultdict(deque)
_blocked_until: dict[str, datetime] = {}
_attempts_lock = Lock()


def _make_attempt_key(username: str, client_ip: str) -> str:
    normalized_username = (username or "").strip().lower()
    normalized_ip = (client_ip or "unknown").strip()
    return f"{normalized_username}|{normalized_ip}"


def _is_blocked(key: str, now: datetime) -> bool:
    with _attempts_lock:
        blocked_until = _blocked_until.get(key)
        if not blocked_until:
            return False
        if now >= blocked_until:
            _blocked_until.pop(key, None)
            _failed_attempts.pop(key, None)
            return False
        return True


def _register_failed_attempt(key: str, now: datetime) -> bool:
    window_start = now - timedelta(seconds=LOGIN_ATTEMPT_WINDOW_SECONDS)
    with _attempts_lock:
        attempts = _failed_attempts[key]
        while attempts and attempts[0] < window_start:
            attempts.popleft()
        attempts.append(now)
        if len(attempts) >= LOGIN_MAX_FAILED_ATTEMPTS:
            _blocked_until[key] = now + timedelta(seconds=LOGIN_LOCKOUT_SECONDS)
            attempts.clear()
            return True
        return False


def _clear_attempts(key: str) -> None:
    with _attempts_lock:
        _failed_attempts.pop(key, None)
        _blocked_until.pop(key, None)


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
    client_ip = request.client.host if request.client else "unknown"
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
    client_ip = request.client.host if request.client else "unknown"
    attempt_key = _make_attempt_key(body.username, client_ip)
    username = (body.username or "").strip().lower()

    if _is_blocked(attempt_key, now):
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
            detail="Too many login attempts. Try again later.",
        )

    authenticated, normalized_username, source, role = authenticate_user_details(body.username, body.password)

    if not authenticated:
        blocked = _register_failed_attempt(attempt_key, now)
        if blocked:
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

    _clear_attempts(attempt_key)
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
    client_ip = request.client.host if request.client else "unknown"
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
