"""Ситуационный мониторинг: наблюдение по чек-листу Ф. ДСР-9.1.3-2026-16-02 (services/video_checklist.py).

По каждому наблюдению формируется PDF формы 16-02 (с фото и кадрами видео). Преподаватель ищется в справочнике
Platonus (tutors) по ФИО; логин берётся из tutors.login. Нарушение подписывается ЭЦП: подписывается строка
«krk-violation:<id>:<SHA-256 содержимого и файлов доказательств>»; после подписи преподаватель получает уведомление
и прикладывает пояснение (объяснительная или справка — ЭЦП в системе или скан).
"""
import hashlib
import io
import json
import logging
import os
import re
import subprocess
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import segno
from fpdf import FPDF
from PIL import Image
from sqlalchemy import text
from sqlalchemy.orm import Session

from models.violation import Violation, ViolationResponse
from models.violation_evidence import ViolationEvidence
from services.notification_service import normalize_login, notify
from services.committee_pdf import LEGAL_NOTE, SYSTEM_NAME
from services.record_service import _get_user_display_map
from services.video_checklist import ANSWERS, LEGACY_STATUSES, OUTCOMES, QUESTIONS

logger = logging.getLogger(__name__)

ORG_NAME = "АО «Казахский университет технологии и бизнеса им. К.Кулажанова»"
FONTS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "fonts")
UTC_PLUS_5 = timedelta(hours=5)
RESPONSE_KINDS = {"explanation": "объяснительная", "certificate": "оправдательная справка"}
RESPONSE_METHODS = {"ecp": "подписано ЭЦП", "scan": "скан бумажного документа"}


def act_dir() -> str:
    return os.getenv("VIOLATION_ACT_DIR", "/app/media/acts")


def evidence_dir() -> str:
    return os.getenv("VIOLATION_MEDIA_DIR", "/app/media/violations")


def responses_dir() -> str:
    return os.path.join(act_dir(), "responses")


def _file_sha256(path: str) -> str:
    digest = hashlib.sha256()
    try:
        with open(path, "rb") as source:
            for chunk in iter(lambda: source.read(1 << 20), b""):
                digest.update(chunk)
    except OSError:
        return ""
    return digest.hexdigest()


def _evidence(db: Session, violation_id: int) -> list[ViolationEvidence]:
    return db.query(ViolationEvidence).filter(ViolationEvidence.violation_id == violation_id).order_by(ViolationEvidence.id).all()


def document_hash(db: Session, violation: Violation) -> str:
    """SHA-256 подписываемого содержимого нарушения: карточка, ответы чек-листа, комментарий, отчетность
    и сами файлы фото/видео (их SHA-256) — подмена доказательства после подписи обнаруживается."""
    payload = {
        "id": violation.id,
        **{key: getattr(violation, key) for key in (
            "teacher", "room", "subject", "group_name", "camera", "scheduled_time", "observed_from", "observed_to",
            "checklist", "description", "schedule_check", "onsite_verification", "tech_ticket", "created_by",
        )},
        "date": violation.violation_date.isoformat(),
        "repeat": violation.repeat_observation_at.isoformat() if violation.repeat_observation_at else None,
        "evidence": [[row.media_type, _file_sha256(os.path.join(evidence_dir(), row.filename))] for row in _evidence(db, violation.id)],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def sign_data(violation: Violation) -> str:
    return f"krk-violation:{violation.id}:{violation.document_hash}"


def response_sign_data(violation_id: int, kind: str, digest: str) -> str:
    """Подписываемые данные пояснения: digest — SHA-256 текста (UTF-8) и следом байтов файла."""
    return f"krk-violation-response:{violation_id}:{kind}:{digest}"


def _local(value: Optional[datetime]) -> str:
    if not value:
        return ""
    if value.tzinfo is not None:
        value = value.astimezone(timezone.utc).replace(tzinfo=None)
    return f"{value + UTC_PLUS_5:%d.%m.%Y %H:%M}"


def _normalize_name(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").replace("ё", "е").replace("Ё", "Е")).strip().lower()


def find_teacher(db: Session, full_name: str) -> Optional[dict]:
    """Преподаватель из справочника Platonus по точному ФИО (без учёта регистра, ё/е и пробелов).
    Несколько разных преподавателей с одинаковым ФИО — неоднозначно, возвращается None."""
    target = _normalize_name(full_name)
    if not target:
        return None
    first_word = target.split(" ", 1)[0]
    rows = db.execute(text("""
        SELECT t.tutor_id, t.full_name, t.login, c.cafedraNameRU AS cafedra
        FROM tutors t
        LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        WHERE t.full_name LIKE :prefix
    """), {"prefix": f"{first_word}%"}).mappings().all()
    matches = [row for row in rows if _normalize_name(row["full_name"]) == target]
    if len(matches) != 1:
        return None
    return dict(matches[0])


def bind_teacher(db: Session, violation: Violation) -> Optional[dict]:
    """ФИО — как в справочнике Platonus (если найден), иначе введённое без лишних пробелов; логин — для уведомления."""
    teacher = find_teacher(db, violation.teacher)
    violation.teacher = teacher["full_name"] if teacher else re.sub(r"\s+", " ", violation.teacher).strip()
    violation.teacher_login = normalize_login(teacher["login"]) if teacher and teacher.get("login") else None
    return teacher


def _video_still(path: str) -> Optional[str]:
    """Кадр из записи для PDF (временный JPEG; удаляет вызывающий)."""
    handle, still = tempfile.mkstemp(suffix=".jpg")
    os.close(handle)
    try:
        result = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", path, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2",
                                 "-y", still], capture_output=True, timeout=20, check=False)
    except (subprocess.TimeoutExpired, OSError):
        result = None
    if result is None or result.returncode != 0 or not os.path.getsize(still):
        os.remove(still)
        return None
    return still


def _qr_png(text: str, error: str = "m") -> Image.Image:
    """QR-код для fpdf: одноцветный PNG segno fpdf рисует шумом, поэтому — RGB-картинка Pillow."""
    buffer = io.BytesIO()
    segno.make(text, error=error, micro=False).save(buffer, kind="png", scale=10, border=0)
    buffer.seek(0)
    return Image.open(buffer).convert("RGB")


class _ChecklistPdf(FPDF):
    """Подписанный ЭЦП чек-лист — как приказ комитета КРК (services/committee_pdf.py): внизу каждой страницы
    QR-код проверки подлинности и норма о равнозначности, на правом поле — отметка электронного документа."""

    verify_url: Optional[str] = None
    stamp: str = ""

    def footer(self):
        if not self.verify_url:
            return
        size = 18
        top = self.h - 10 - size
        self.image(_qr_png(self.verify_url), x=self.l_margin, y=top, w=size, h=size)
        self.set_xy(self.l_margin + size + 4, top)
        self.set_font("DejaVu", "", 6.5)
        self.multi_cell(self.w - self.l_margin - self.r_margin - size - 4, 3.2, LEGAL_NOTE)
        self.set_font("DejaVu", "", 8)
        self.set_text_color(31, 61, 138)
        with self.rotation(-90, self.w - 6, self.h / 2):
            self.text(self.w - 6 - self.get_string_width(self.stamp) / 2, self.h / 2, self.stamp)
        self.set_text_color(0, 0, 0)


def signer_card(info: dict) -> tuple[str, str]:
    """(должность, «Фамилия И.О.») подписанта из сведений о подписи; у ранних подписей — владелец сертификата."""
    return info.get("signer_position") or "", info.get("signer_name") or info.get("subject") or ""


def build_checklist_pdf(violation: Violation, *, observer: str, cafedra: Optional[str],
                        evidence: list[ViolationEvidence], responses: list[ViolationResponse],
                        verify_url: Optional[str] = None) -> bytes:
    """PDF формы Ф. ДСР-9.1.3-2026-16-02: карточка, проверочные вопросы, отчетность, подпись ЭЦП,
    пояснения преподавателя и приложение с фото и кадрами видео. Подписанный — со строкой подписи
    (должность, QR-код подписанта, ФИО) и QR-кодом проверки подлинности на каждой странице."""
    info = violation.signature_info if violation.signed_at else None
    pdf = _ChecklistPdf(format="A4")
    pdf.verify_url = verify_url if info else None
    if pdf.verify_url:
        pdf.stamp = f"Дата: {_local(violation.signed_at)}. Система: {SYSTEM_NAME}. Электронный документ."
    pdf.set_margins(15, 14, 15)
    # Внизу подписанного — QR-код проверки и норма о равнозначности
    pdf.set_auto_page_break(auto=True, margin=34 if pdf.verify_url else 14)
    pdf.add_font("DejaVu", "", os.path.join(FONTS_DIR, "DejaVuSans.ttf"))
    pdf.add_font("DejaVu", "B", os.path.join(FONTS_DIR, "DejaVuSans-Bold.ttf"))
    pdf.set_title(f"Чек-лист ситуационного видеомониторинга № {violation.id}")
    pdf.add_page()

    pdf.set_font("DejaVu", "", 9)
    pdf.multi_cell(0, 4.5, ORG_NAME, align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.multi_cell(0, 4.5, "Ф. ДСР-9.1.3-2026-16-02", align="R", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(2)
    pdf.set_font("DejaVu", "B", 12)
    pdf.multi_cell(0, 6, f"ЧЕК-ЛИСТ СИТУАЦИОННОГО ВИДЕОМОНИТОРИНГА № {violation.id}", align="C", new_x="LMARGIN", new_y="NEXT")
    pdf.ln(3)

    def heading(value):
        pdf.set_font("DejaVu", "B", 10)
        pdf.multi_cell(0, 5, value, new_x="LMARGIN", new_y="NEXT")
        pdf.ln(1)

    def table(rows, widths, bold_columns=(0,), header=None):
        with pdf.table(col_widths=widths, text_align="LEFT", first_row_as_headings=bool(header), line_height=5) as tbl:
            for index, values in enumerate(([header] if header else []) + rows):
                row = tbl.row()
                for column, value in enumerate(values):
                    pdf.set_font("DejaVu", "B" if (header and index == 0) or column in bold_columns else "", 9)
                    row.cell(str(value if value not in (None, "") else "—"))
        pdf.ln(3)

    photos = sum(1 for row in evidence if row.media_type == "photo")
    window = "–".join(filter(None, [violation.observed_from, violation.observed_to]))
    subject = " · ".join(filter(None, [violation.subject, violation.group_name]))
    table([
        ("Дата", f"{violation.violation_date:%d.%m.%Y}", "Наблюдатель", observer),
        ("Корпус и аудитория", violation.room, "Камера", violation.camera),
        ("Расписание", violation.scheduled_time, "Фактическое окно наблюдения", window),
        ("Преподаватель", violation.teacher, "Дисциплина и группа", subject),
        ("Кафедра", cafedra, "Фото/видео",
         f"фото: {photos}, видео: {len(evidence) - photos} — в приложении" if evidence else "нет"),
    ], (34, 56, 34, 56), bold_columns=(0, 2))

    heading("Наблюдения устанавливаются по вопросам:")
    checklist = violation.checklist or {}
    table([(question, ANSWERS.get(checklist.get(key), "—")) for key, question, *_ in QUESTIONS],
          (150, 30), bold_columns=(), header=("Проверочный вопрос", "Статус"))

    heading("Отчетность")
    repeat = f"{violation.repeat_observation_at:%d.%m.%Y %H:%M}" if violation.repeat_observation_at else "не требуется"
    status = OUTCOMES.get(violation.status) or LEGACY_STATUSES.get(violation.status) or violation.status
    table([
        ("Статус", status),
        ("Проверка расписания и замен", violation.schedule_check),
        ("Повторное наблюдение", repeat),
        ("Очная верификация", violation.onsite_verification or "не требуется"),
        ("Техническая заявка", violation.tech_ticket or "нет"),
        # Комментарий наблюдателя и пояснение проверяющего при подведении итога
        ("Комментарий", "\n".join(filter(None, [violation.description, violation.review_comment]))),
    ], (60, 120))

    if responses:
        heading("Пояснения преподавателя")
        table([
            (_local(row.created_at), RESPONSE_KINDS.get(row.kind, row.kind),
             RESPONSE_METHODS.get(row.method, row.method)
             + (f": {row.signature_info.get('subject')}" if row.signature_info else "")
             + (f"; файл: {row.original_name}" if row.original_name else ""))
            for row in responses
        ], (35, 45, 100), bold_columns=(), header=("Дата", "Документ", "Способ"))

    pdf.set_font("DejaVu", "", 8)
    pdf.multi_cell(
        0, 4,
        "Видеомониторинг без звука подтверждает только организационные факты и не включается в итоговый балл "
        "качества занятия (п. 4.1). Технически некачественный сигнал не трактуется против преподавателя (п. 4.7). "
        "Нарушение подписывается ЭЦП; преподаватель вправе приложить объяснительную или оправдательную справку.",
        new_x="LMARGIN", new_y="NEXT",
    )
    if info:
        # Строка подписи: должность — QR-код подписанта (кто и когда подписал, ссылка на проверку) — ФИО
        position, name = signer_card(info)
        signer_qr = f"Подписано в системе {SYSTEM_NAME}. Подписант {info.get('subject', name)}. " \
                    f"Время подписи {_local(violation.signed_at)}."
        if pdf.verify_url:
            signer_qr += f"\n{pdf.verify_url}"
        qr, width = 24, pdf.w - pdf.l_margin - pdf.r_margin
        pdf.ln(6)
        if pdf.get_y() + qr > pdf.page_break_trigger:
            pdf.add_page()
        top = pdf.get_y()
        side = (width - qr - 6) / 2
        pdf.set_font("DejaVu", "B", 10)
        pdf.set_xy(pdf.l_margin, top + qr / 2 - 5)
        pdf.multi_cell(side, 5, position or "Наблюдатель")
        pdf.image(_qr_png(signer_qr, "l"), x=pdf.l_margin + side + 3, y=top, w=qr, h=qr)
        pdf.set_xy(pdf.l_margin + side + qr + 6, top + qr / 2 - 2.5)
        pdf.multi_cell(side, 5, name, align="R")
        pdf.set_xy(pdf.l_margin, top + qr + 2)
        # Сведения о подписи — мелко под строкой подписи (полностью — на странице проверки по QR-коду)
        pdf.set_font("DejaVu", "", 7.5)
        pdf.set_text_color(70, 70, 70)
        pdf.multi_cell(0, 3.6, f"Подписано ЭЦП: {info.get('subject', '')}; сертификат № {info.get('certificate_serial', '')}, "
                               f"{info.get('issuer', '')}; {_local(violation.signed_at)} (UTC+5). "
                               f"Отпечаток содержимого (SHA-256): {violation.document_hash}",
                       align="L", new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
    else:
        pdf.ln(8)
        pdf.set_font("DejaVu", "", 9)
        pdf.cell(0, 5, f"Наблюдатель: ____________________  {observer}", new_x="LMARGIN", new_y="NEXT")

    # Приложение: фото и кадр начала каждой видеозаписи
    if evidence:
        pdf.add_page()
        heading(f"Приложение к чек-листу № {violation.id}: фото и видео")
        width = pdf.w - pdf.l_margin - pdf.r_margin
        for number, row in enumerate(evidence, start=1):
            path = os.path.join(evidence_dir(), row.filename)
            still = path if row.media_type == "photo" else _video_still(path)
            pdf.set_font("DejaVu", "", 9)
            caption = (f"{number}. Фото" if row.media_type == "photo" else f"{number}. Видео (кадр начала записи; запись — в системе)")
            pdf.multi_cell(0, 5, f"{caption}, {_local(row.created_at)}", new_x="LMARGIN", new_y="NEXT")
            try:
                if still and os.path.isfile(still):
                    pdf.image(still, w=width)
                else:
                    pdf.multi_cell(0, 5, "файл недоступен", new_x="LMARGIN", new_y="NEXT")
            finally:
                if still and still != path and os.path.exists(still):
                    os.remove(still)
            pdf.ln(3)
    return bytes(pdf.output())


def checklist_pdf_bytes(db: Session, violation: Violation, base_url: Optional[str] = None) -> bytes:
    """PDF формы 16-02; base_url — адрес сайта для QR-кода проверки подписанного чек-листа (как у приказа)."""
    login = (violation.created_by or "").strip().lower()
    observer = _get_user_display_map(db, [violation.created_by]).get(login) or violation.created_by
    teacher = find_teacher(db, violation.teacher)
    responses = (db.query(ViolationResponse).filter(ViolationResponse.violation_id == violation.id)
                 .order_by(ViolationResponse.id).all()) if violation.id else []
    verify_url = f"{base_url.rstrip('/')}/verify/{violation.verify_token}" if base_url and violation.verify_token else None
    return build_checklist_pdf(violation, observer=observer, cafedra=teacher.get("cafedra") if teacher else None,
                               evidence=_evidence(db, violation.id), responses=responses, verify_url=verify_url)


def save_checklist_pdf(db: Session, violation: Violation) -> str:
    """Записывает PDF формы 16-02 (заново при каждом изменении). Подписанный отдаётся собранным заново
    с QR-кодами по адресу запроса (GET /violations/{id}/act). Возвращает путь к файлу:
    при ошибке commit новой записи вызывающий удаляет его."""
    content = checklist_pdf_bytes(db, violation)
    os.makedirs(act_dir(), mode=0o750, exist_ok=True)
    violation.act_filename = violation.act_filename or f"{uuid.uuid4().hex}.pdf"
    path = os.path.join(act_dir(), violation.act_filename)
    with open(path, "wb") as target:
        target.write(content)
    violation.act_uploaded_by = "system"
    violation.act_uploaded_at = datetime.now(timezone.utc)
    return path


def notify_teacher(db: Session, violation: Violation) -> bool:
    """Уведомление преподавателю о подписанном чек-листе: нарушение (с правом приложить пояснение) или
    наблюдение без замечаний. True — уведомление создано."""
    if not violation.teacher_login:
        logger.info("Violation %s: teacher %r not found in Platonus catalog, notification skipped",
                    violation.id, violation.teacher)
        return False
    details = [f"{violation.violation_date:%d.%m.%Y}"]
    if violation.subject:
        details.append(violation.subject)
    if violation.room:
        details.append(f"ауд. {violation.room}")
    if violation.status == "confirmed":
        title = f"Зафиксировано нарушение: {violation.violation_type}"
        tail = "Вы можете приложить объяснительную или оправдательную справку."
    else:
        title = "Ситуационный видеомониторинг: замечаний нет"
        tail = ""
    notify(
        db, violation.teacher_login, f"violation.{violation.status}",
        title=title,
        body=f"{', '.join(details)}. Чек-лист видеомониторинга № {violation.id} подписан ЭЦП. {tail}".strip(),
        link="/my-violations",
    )
    return True


def verification(db: Session, token: str) -> Optional[dict]:
    """Проверка подлинности подписанного чек-листа по QR-коду (открытая страница). Преподаватель, итог и
    содержимое не раскрываются — только реквизиты документа, подписант, сертификат и целостность."""
    violation = db.query(Violation).filter(Violation.verify_token == token).first()
    if not violation or not violation.signed_at:
        return None
    info = violation.signature_info or {}
    position, name = signer_card(info)
    return {
        "kind": "checklist",
        "number": violation.id,
        "observation_date": violation.violation_date.isoformat(),
        "signed_by": " ".join(filter(None, [position, name])),
        "signed_at": violation.signed_at.isoformat(),
        "signature": {key: info.get(key) for key in ("subject", "certificate_serial", "issuer", "valid_from", "valid_to", "ocsp")},
        "document_hash": violation.document_hash,
        "intact": document_hash(db, violation) == violation.document_hash,
    }
