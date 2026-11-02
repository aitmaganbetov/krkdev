from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from models import AuditLog
from services import require_roles, ROLE_SUPERADMIN
from datetime import datetime, timedelta, timezone
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/audit-logs", tags=["admin-audit-logs"])


@router.get("")
def list_audit_logs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    action: str | None = None,
    outcome: str | None = None,
    actor: str | None = None,
    days_back: int = Query(7, ge=1, le=90),
    _: dict = Depends(require_roles(ROLE_SUPERADMIN)),
    db: Session = Depends(get_db),
):
    """List audit logs with optional filtering"""
    try:
        query = db.query(AuditLog)
        
        # Filter by date
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
        query = query.filter(AuditLog.timestamp >= cutoff)
        
        # Apply optional filters
        if action:
            query = query.filter(AuditLog.action.ilike(f"%{action}%"))
        if outcome:
            query = query.filter(AuditLog.outcome == outcome)
        if actor:
            query = query.filter(AuditLog.actor.ilike(f"%{actor}%"))
        
        # Count total
        total = query.count()
        
        # Order by timestamp descending and paginate
        logs = query.order_by(AuditLog.timestamp.desc()).offset(skip).limit(limit).all()
        
        return {
            "total": total,
            "skip": skip,
            "limit": limit,
            "logs": [log.to_dict() for log in logs],
        }
    except Exception as e:
        logger.error(f"Error in list_audit_logs: {e}", exc_info=True)
        raise


@router.get("/stats")
def audit_logs_stats(
    days_back: int = Query(7, ge=1, le=90),
    _: dict = Depends(require_roles(ROLE_SUPERADMIN)),
    db: Session = Depends(get_db),
):
    """Get statistics about audit logs"""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days_back)
        
        # Счётчики по итогам — одним запросом с группировкой
        by_outcome = dict(
            db.query(AuditLog.outcome, func.count(AuditLog.id))
            .filter(AuditLog.timestamp >= cutoff).group_by(AuditLog.outcome).all()
        )
        total_events = sum(by_outcome.values())

        # Уникальные авторы; записи без автора (NULL) считаются одним, как прежде в DISTINCT
        distinct_actors, has_anonymous = db.query(
            func.count(func.distinct(AuditLog.actor)), func.max(AuditLog.actor.is_(None))
        ).filter(AuditLog.timestamp >= cutoff).one()
        unique_actors = int(distinct_actors or 0) + (1 if has_anonymous else 0)

        # Get most common actions
        top_actions = db.query(
            AuditLog.action,
            func.count(AuditLog.id).label("count")
        ).filter(AuditLog.timestamp >= cutoff).group_by(AuditLog.action).order_by(func.count(AuditLog.id).desc()).limit(5).all()
        
        return {
            "days": days_back,
            "total_events": total_events,
            "success": by_outcome.get("success", 0),
            "failure": by_outcome.get("failure", 0),
            "blocked": by_outcome.get("blocked", 0),
            "unique_actors": unique_actors,
            "top_actions": [{"action": action, "count": count} for action, count in top_actions],
        }
    except Exception as e:
        logger.error(f"Error in audit_logs_stats: {e}", exc_info=True)
        raise


@router.get("/actions")
def get_audit_log_actions(
    _: dict = Depends(require_roles(ROLE_SUPERADMIN)),
    db: Session = Depends(get_db),
):
    """Get list of all unique actions in audit logs"""
    try:
        actions = db.query(AuditLog.action).distinct().order_by(AuditLog.action).all()
        return {"actions": [action[0] for action in actions]}
    except Exception as e:
        logger.error(f"Error in get_audit_log_actions: {e}", exc_info=True)
        raise


@router.get("/actors")
def get_audit_log_actors(
    _: dict = Depends(require_roles(ROLE_SUPERADMIN)),
    db: Session = Depends(get_db),
):
    """Get list of all unique actors in audit logs"""
    try:
        actors = db.query(AuditLog.actor).distinct().order_by(AuditLog.actor).all()
        return {"actors": [actor[0] for actor in actors if actor[0]]}
    except Exception as e:
        logger.error(f"Error in get_audit_log_actors: {e}", exc_info=True)
        raise
