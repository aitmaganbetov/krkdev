import json
import logging
from datetime import datetime, timezone


_AUDIT_LOGGER = logging.getLogger("audit")

_REDACT_KEYS = {
    "password",
    "bind_password",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "certificate_key",
}


def _sanitize(value):
    if isinstance(value, dict):
        sanitized = {}
        for key, item in value.items():
            key_str = str(key)
            if key_str.lower() in _REDACT_KEYS:
                sanitized[key_str] = "[REDACTED]"
            else:
                sanitized[key_str] = _sanitize(item)
        return sanitized
    if isinstance(value, (list, tuple, set)):
        return [_sanitize(item) for item in value]
    return value


def audit_event(action: str, outcome: str = "success", actor: str | None = None, details: dict | None = None) -> None:
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "outcome": outcome,
        "actor": actor or "unknown",
        "details": _sanitize(details or {}),
    }
    _AUDIT_LOGGER.info(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
