import json
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session


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


def audit_event(action: str, outcome: str = "success", actor: str | None = None, details: dict | None = None, db: Session | None = None, ip_address: str | None = None) -> None:
    """Log an audit event to both logger and database
    
    Args:
        action: The action that was performed (e.g., "auth.login", "admin.users.create")
        outcome: The result of the action ("success", "failure", "blocked")
        actor: The user who performed the action
        details: Additional context about the action
        db: SQLAlchemy database session for storage
        ip_address: Client IP address
    """
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "outcome": outcome,
        "actor": actor or "unknown",
        "details": _sanitize(details or {}),
    }
    
    # Log to audit logger
    _AUDIT_LOGGER.info(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    
    # Also save to database if session provided
    if db:
        try:
            from models import AuditLog
            audit_entry = AuditLog(
                timestamp=datetime.now(timezone.utc),
                action=action,
                outcome=outcome,
                actor=actor or "unknown",
                details=payload.get("details"),
                ip_address=ip_address,
            )
            db.add(audit_entry)
            db.commit()
        except Exception as e:
            _AUDIT_LOGGER.error(f"Failed to save audit log to database: {str(e)}")
            db.rollback()

