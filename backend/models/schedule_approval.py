from database import Base
from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql import func


class ScheduleApproval(Base):
    """Утверждение графика взаимопосещения факультета на год и период — маршрут подписания ЭЦП:
    этап 1 — заведующие кафедрами, этап 2 — согласующие (декан, УОП, МО), этап 3 — утверждающий (проректор).
    Следующий этап получает документ, когда подписали все на текущем. Содержимое фиксируется при отправке
    (document_hash) — график, изменённый после отправки, подписать нельзя."""

    __tablename__ = "peer_visit_schedule_approvals"
    __table_args__ = (UniqueConstraint("academic_year", "period", "faculty_id", name="uq_schedule_approval"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year = Column(String(20), nullable=False)
    period = Column(Integer, nullable=False)
    faculty_id = Column(Integer, nullable=False, index=True)
    # «технологического факультета» — в заголовке «График взаимопосещения занятий ППС …»
    title = Column(String(255), nullable=False, default="")
    # draft — проект; on_signing — на подписи (stage — текущий этап); approved — утверждён
    status = Column(String(20), nullable=False, default="draft")
    stage = Column(Integer, nullable=True)
    document_hash = Column(String(64), nullable=True)
    verify_token = Column(String(32), nullable=True, unique=True)
    sent_at = Column(DateTime, nullable=True)
    approved_at = Column(DateTime, nullable=True)

    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class ScheduleApprovalSigner(Base):
    """Подписант графика: сотрудник Platonus на своём этапе. label — строка подписи в документе
    («Заведующий кафедрой «…»», «Декан ТФ», «Проректор по АВ»), name — «Н.С. Машанова»."""

    __tablename__ = "peer_visit_schedule_approval_signers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    approval_id = Column(Integer, ForeignKey("peer_visit_schedule_approvals.id", ondelete="CASCADE"), nullable=False, index=True)
    stage = Column(Integer, nullable=False)
    # cafedra:<id>, dean, uop, mo, approver
    role = Column(String(40), nullable=False)
    position = Column(Integer, nullable=False, default=0)
    label = Column(String(500), nullable=False)
    tutor_id = Column(Integer, nullable=True, index=True)
    name = Column(String(255), nullable=False, default="")
    signed_at = Column(DateTime, nullable=True)
    signature_cms = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=True)
    signature_info = Column(JSON, nullable=True)
