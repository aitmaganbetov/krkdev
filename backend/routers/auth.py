from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from threading import Lock
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from schemas.auth import LoginRequest, TokenOut
from services.auth_service import (
    ACCESS_TOKEN_EXPIRE_MINUTES,
    AUTH_COOKIE_NAME,
    authenticate_user_details,
    create_access_token,
    get_current_user_context,
)

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


@router.post("/login", response_model=TokenOut)
def login(body: LoginRequest, request: Request, response: Response):
    now = datetime.now(timezone.utc)
    client_ip = request.client.host if request.client else "unknown"
    attempt_key = _make_attempt_key(body.username, client_ip)

    if _is_blocked(attempt_key, now):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many login attempts. Try again later.",
        )

    authenticated, normalized_username, source, role = authenticate_user_details(body.username, body.password)

    if not authenticated:
        blocked = _register_failed_attempt(attempt_key, now)
        if blocked:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
            )
        detail = "Invalid username or password"
        if source == "ldap_unavailable":
            detail = "LDAP недоступен. Вход возможен только для ранее авторизованных пользователей."
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )

    _clear_attempts(attempt_key)
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
def logout(response: Response):
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/me")
def me(context: dict[str, str] = Depends(get_current_user_context)):
    return context
