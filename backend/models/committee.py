from database import Base
from sqlalchemy import JSON, Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql import func


class CommitteeOrder(Base):
    """Состав комитета ректорского контроля на учебный год (приказ о создании комитета). Пока номера и даты
    нет — это проект на утверждение. Действует один приказ (is_active): члены его состава получают роль
    «Член комитета КРК» и проводят проверки занятий."""

    __tablename__ = "committee_orders"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # Номер и дата вносятся после подписания приказа
    number = Column(String(50), nullable=True, unique=True)
    order_date = Column(Date, nullable=True)
    academic_year = Column(String(20), nullable=False, index=True)
    title_ru = Column(String(500), nullable=False)
    title_kz = Column(String(500), nullable=True)
    # Вводная часть приказа (до «ПРИКАЗЫВАЮ:»)
    purpose_ru = Column(Text, nullable=True)
    purpose_kz = Column(Text, nullable=True)
    # Основание: представления, служебные записки
    basis_ru = Column(Text, nullable=True)
    basis_kz = Column(Text, nullable=True)
    # Подписант: должность и ФИО для приказа («Ректор Л. Байболова»); подписывает ЭЦП сотрудник signer_tutor_id
    signed_by = Column(String(255), nullable=True)
    signer_tutor_id = Column(Integer, nullable=True, index=True)
    signer_position = Column(String(255), nullable=True)
    # Электронная подпись: отправлен на подпись → подписан ЭЦП подписанта (CMS, проверенная Kalkan + OCSP).
    # document_hash — SHA-256 содержимого на момент отправки; verify_token — адрес проверки по QR-коду
    sent_at = Column(DateTime, nullable=True)
    signed_at = Column(DateTime, nullable=True)
    signature_cms = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=True)
    signature_info = Column(JSON, nullable=True)
    document_hash = Column(String(64), nullable=True)
    # Состав на момент подписания ЭЦП ([[position, tutor_id, name, position_ru, position_kz], …]) — сохраняется,
    # когда суперадмин удаляет члена из подписанного приказа: подпись и PDF относятся к подписанному составу
    signed_members = Column(JSON, nullable=True)
    verify_token = Column(String(32), nullable=True, unique=True)
    is_active = Column(Boolean, nullable=False, default=False, index=True)
    # Скан приказа (PDF) в COMMITTEE_FILES_DIR
    file_name = Column(String(64), nullable=True)

    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class CommitteeMember(Base):
    """Член комитета — преподаватель из справочника Platonus (tutors). ФИО («Фамилия И.О.») и должность —
    тексты для приказа: из карточки преподавателя или, у импортированного приказа, как в скане.
    Без привязки к преподавателю член комитета не получает роль: неизвестен его логин."""

    __tablename__ = "committee_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("committee_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    # Порядковый номер в составе
    position = Column(Integer, nullable=False, default=0)
    name = Column(String(255), nullable=False)
    position_ru = Column(String(500), nullable=False, default="")
    position_kz = Column(String(500), nullable=True)
    tutor_id = Column(Integer, nullable=True, index=True)

    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class CommitteeAssignment(Base):
    """Назначение проверки: член комитета (inspector_tutor_id) посещает занятие преподавателя (teacher_tutor_id)
    в семестре term. Распределение — services/committee_assignments.py; manual — назначено вручную
    (повторное распределение его сохраняет)."""

    __tablename__ = "committee_assignments"
    __table_args__ = (UniqueConstraint("order_id", "term", "teacher_tutor_id", name="uq_committee_assignment"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("committee_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    term = Column(Integer, nullable=False)
    teacher_tutor_id = Column(Integer, nullable=False, index=True)
    inspector_tutor_id = Column(Integer, nullable=False, index=True)
    manual = Column(Boolean, nullable=False, default=False)
    assigned_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class CommitteeInspectorExclusion(Base):
    """Член состава, не участвующий в проверках занятий. Отдельно от committee_members: состав входит
    в подписанное ЭЦП содержимое приказа и после подписания не меняется."""

    __tablename__ = "committee_inspector_exclusions"
    __table_args__ = (UniqueConstraint("order_id", "tutor_id", name="uq_committee_inspector_exclusion"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    order_id = Column(Integer, ForeignKey("committee_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    tutor_id = Column(Integer, nullable=False)
    excluded_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
