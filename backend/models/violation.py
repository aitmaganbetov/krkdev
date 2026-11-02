from sqlalchemy import JSON, Column, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.mysql import LONGTEXT
from sqlalchemy.sql import func

from database import Base


class Violation(Base):
    """Наблюдение ситуационного видеомониторинга — чек-лист Ф. ДСР-9.1.3-2026-16-02 (services/video_checklist.py).
    Записи до формы 16-02 (checklist IS NULL) — нарушения по виду: violation_type, статусы pending/confirmed/rejected."""

    __tablename__ = "violations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_ref = Column(String(100), nullable=False, index=True)
    teacher = Column(String(255), nullable=False, index=True)
    # Логин преподавателя из Platonus (tutors.login): кому уведомление и кто видит нарушение в «Моих нарушениях»
    teacher_login = Column(String(255), nullable=True, index=True)
    # Факультет преподавателя (кафедра в справочнике Platonus): по нему деканат видит нарушения
    faculty_id = Column(Integer, nullable=True, index=True)
    room = Column(String(255), nullable=False, default="")
    subject = Column(String(255), nullable=False, default="")
    violation_type = Column(String(150), nullable=False, index=True)
    violation_date = Column(Date, nullable=False, index=True)
    description = Column(Text, nullable=False, default="")
    status = Column(String(30), nullable=False, default="pending", index=True)
    created_by = Column(String(255), nullable=False)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    review_comment = Column(Text, nullable=False, default="")
    act_filename = Column(String(255), nullable=True)
    act_uploaded_by = Column(String(255), nullable=True)
    act_uploaded_at = Column(DateTime, nullable=True)
    # Чек-лист 16-02: ответы на проверочные вопросы {ключ: yes|no|unclear|not_visible|na}
    checklist = Column(JSON, nullable=True)
    # Карточка наблюдения
    camera = Column(String(255), nullable=False, default="")
    scheduled_time = Column(String(50), nullable=False, default="")
    observed_from = Column(String(5), nullable=False, default="")
    observed_to = Column(String(5), nullable=False, default="")
    group_name = Column(String(500), nullable=False, default="")
    # Отчетность: сверка расписания и замен, повторное наблюдение, очная верификация, техническая заявка
    schedule_check = Column(Text, nullable=True)
    repeat_observation_at = Column(DateTime, nullable=True)
    onsite_verification = Column(String(255), nullable=False, default="")
    tech_ticket = Column(String(100), nullable=False, default="")
    # Подпись нарушения ЭЦП (status violation → confirmed): отпечаток содержимого и присоединённая CMS
    document_hash = Column(String(64), nullable=True)
    signed_at = Column(DateTime, nullable=True)
    signature_cms = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=True)
    signature_info = Column(JSON, nullable=True)
    # Код в QR-коде проверки подлинности подписанного чек-листа (/verify/<код>)
    verify_token = Column(String(32), nullable=True, unique=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)


class ViolationResponse(Base):
    """Пояснение преподавателя по подписанному нарушению: объяснительная или оправдательная справка —
    подписанная ЭЦП в системе (текст и/или файл) либо скан бумажного документа."""

    __tablename__ = "violation_responses"

    id = Column(Integer, primary_key=True, autoincrement=True)
    violation_id = Column(Integer, ForeignKey("violations.id", ondelete="CASCADE"), nullable=False, index=True)
    # explanation — объяснительная, certificate — оправдательная справка
    kind = Column(String(20), nullable=False)
    # ecp — подписано ЭЦП в системе, scan — скан бумажного документа
    method = Column(String(10), nullable=False)
    text = Column(Text, nullable=True)
    file_name = Column(String(64), nullable=True)
    file_type = Column(String(50), nullable=True)
    original_name = Column(String(255), nullable=True)
    document_hash = Column(String(64), nullable=True)
    signature_cms = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=True)
    signature_info = Column(JSON, nullable=True)
    created_by = Column(String(255), nullable=False)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
