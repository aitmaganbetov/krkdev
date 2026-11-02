from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, DateTime, JSON
from database import Base


class AuditLog(Base):
    """Stores audit log entries for all security-sensitive actions"""
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    action = Column(String(255), nullable=False, index=True)
    outcome = Column(String(50), nullable=False, index=True)
    actor = Column(String(255), nullable=True, index=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(45), nullable=True, index=True)

    def to_dict(self):
        return {
            'id': self.id,
            'timestamp': self.timestamp.isoformat() if self.timestamp else None,
            'action': self.action,
            'outcome': self.outcome,
            'actor': self.actor,
            'details': self.details,
            'ip_address': self.ip_address,
        }
