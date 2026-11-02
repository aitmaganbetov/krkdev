"""PDF приказа о составе комитета КРК — в оформлении СЭД университета (как служебные записки).

Документ на одном языке — не больше двух страниц A4: размер текста — самый крупный, при котором он помещается.
У подписанного ЭЦП приказа на каждой странице — водяной знак, отметка электронного документа на правом поле,
внизу слева QR-код проверки подлинности (/verify/<token>) с нормой о равнозначности; в строке подписи — QR-код подписанта.
Текст в PDF — настоящий (выделяется и ищется), шрифт Liberation Serif (метрики Times New Roman, казахские буквы).
"""
import io
import os
import threading
from datetime import datetime, timedelta
from typing import Optional
from xml.sax.saxutils import escape

import segno
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, Image, KeepTogether, PageBreak, PageTemplate, Paragraph,
                                Spacer, Table, TableStyle)

SYSTEM_NAME = "Sapa Monitoring"
BRAND_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "brand")
NAVY = colors.HexColor("#1f3864")
STAMP_BLUE = colors.HexColor("#1f3d8a")
UTC_PLUS_5 = timedelta(hours=5)

LETTERHEAD = {
    "kz": ["Қ.ҚҰЛАЖАНОВ АТЫНДАҒЫ ҚАЗАҚ", "ТЕХНОЛОГИЯ ЖӘНЕ БИЗНЕС УНИВЕРСИТЕТІ", "Қазақстан Республикасы, Астана қ-сы, Нұра ауданы,",
           "Қайым Мұхамедханов көшесі, 37 А", "Тел.: +7 (7172) 69-70-50, 69-70-60", "E-mail: info@kaztbu.edu.kz"],
    "en": ["K. KULAZHANOV KAZAKH UNIVERSITY OF", "TECHNOLOGY AND BUSINESS", "Republic of Kazakhstan, Astana, Nura district,",
           "Kaiym Mukhamedkhanov street, 37 A", "Tel.: +7 (7172) 69-70-50, 69-70-60", "E-mail: info@kaztbu.edu.kz"],
}
LEGAL_NOTE = ('Осы құжат "Электрондық құжат және электрондық цифрлық қолтаңба туралы" Қазақстан Республикасының 2003 жылғы '
              '7 қаңтардағы №370-II Заңы 7 бабының 1 тармағына сәйкес қағаз тасығыштағы құжатпен бірдей. Данный документ согласно '
              'пункту 1 статьи 7 ЗРК от 7 января 2003 года №370-II "Об электронном документе и электронной цифровой подписи", '
              'равнозначен документу на бумажном носителе.')
DOC = {
    "ru": {
        "title": lambda number, date: f"Приказ № {number or '________'} от {date or '«____» ____________ 20___ г.'}",
        "city": "город Астана",
        "command": "ПРИКАЗЫВАЮ:",
        "item": "1. Создать комитет Ректорского контроля для проведения проверки и оценки качества учебных занятий ППС "
                "в течение учебного года в следующем составе:",
        "basis": "Примечание:",
        "position": "Должность",
        "name": "Ф.И.О.",
    },
    "kz": {
        "title": lambda number, date: f"{date + ' ж.' if date else '«____» ____________ 20___ ж.'} № {number or '________'} бұйрық",
        "city": "Астана қаласы",
        "command": "БҰЙЫРАМЫН:",
        "item": "1. Оқу жылы ішінде профессор-оқытушылар құрамының оқу сабақтарының сапасын тексеру және бағалау үшін "
                "келесі құрамда Ректорлық бақылау комитетін құру:",
        "basis": "Негіздеме:",
        "position": "Лауазымы",
        "name": "Аты-жөні",
    },
}
# Должность подписанта на казахском листе (как SIGNER_POSITIONS во фронтенде)
SIGNER_POSITION_KZ = {
    "Ректор": "Ректор",
    "И.о. ректора": "Ректордың м.а.",
    "Первый проректор": "Бірінші проректор",
    "Проректор по академическим вопросам": "Академиялық мәселелер жөніндегі проректор",
}

PAGE_W, PAGE_H = A4
MARGIN_X, MARGIN_TOP, MARGIN_BOTTOM = 15 * mm, 10 * mm, 10 * mm
# Документ на одном языке — не больше двух страниц: текст — самый крупный из подходящих
MAX_PAGES = 2
MAX_FONT, MIN_FONT = 12.0, 7.0
FONT = "DocSerif"
FONT_FILES = (
    ("/usr/share/fonts/truetype/liberation/LiberationSerif", ("-Regular", "-Bold", "-Italic", "-BoldItalic")),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSerif", ("", "-Bold", "-Italic", "-BoldItalic")),
)


_fonts_lock = threading.Lock()
_fonts_ready = False


def _register_fonts() -> None:
    # Под блокировкой и с флагом после регистрации семейства: при параллельных запросах PDF второй поток
    # видел уже зарегистрированное обычное начертание и строил документ без курсива («docserif-italic»)
    global _fonts_ready
    if _fonts_ready:
        return
    with _fonts_lock:
        if _fonts_ready:
            return
        for base, suffixes in FONT_FILES:
            paths = [f"{base}{suffix}.ttf" for suffix in suffixes]
            if all(os.path.isfile(path) for path in paths):
                for style, path in zip(("", "-Bold", "-Italic", "-BoldItalic"), paths):
                    pdfmetrics.registerFont(TTFont(FONT + style, path))
                pdfmetrics.registerFontFamily(FONT, normal=FONT, bold=FONT + "-Bold", italic=FONT + "-Italic", boldItalic=FONT + "-BoldItalic")
                _fonts_ready = True
                return
        raise RuntimeError("Нет шрифта для PDF: установите fonts-liberation")


def format_signed_at(value: Optional[datetime]) -> str:
    """Время подписи по Астане (UTC+5) с секундами — как в СЭД."""
    return (value + UTC_PLUS_5).strftime("%d.%m.%Y %H:%M:%S") if value else ""


def split_signer(value: Optional[str]) -> tuple[str, str]:
    """«Ректор Л. Байболова» → («Ректор», «Л. Байболова»)."""
    words = (value or "").split()
    for index, word in enumerate(words):
        if len(word) == 2 and word.endswith(".") and word[0].isupper():
            return " ".join(words[:index]), " ".join(words[index:])
    return value or "", ""


def _qr(text: str, error: str = "m") -> bytes:
    """QR-код как PNG: для строки подписи (Image) и нижнего поля (ImageReader)."""
    buffer = io.BytesIO()
    segno.make(text, error=error, micro=False).save(buffer, kind="png", scale=10, border=0)
    return buffer.getvalue()


def signer_qr_text(order: dict, verify_url: str) -> str:
    """QR-код подписанта — как в СЭД: кто (владелец сертификата) и когда подписал, и ссылка на проверку."""
    signer = (order.get("signature") or {}).get("subject") or order.get("signer_full_name") or split_signer(order.get("signed_by"))[1]
    return f"Подписано в системе {SYSTEM_NAME}. Подписант {signer}. Время подписи {order['signed_at_text']}.\n{verify_url}"


def _styles(size: float) -> dict:
    base = ParagraphStyle("body", fontName=FONT, fontSize=size, leading=size * 1.25)
    return {
        "title": ParagraphStyle("title", parent=base, fontName=FONT + "-Bold", fontSize=size * 1.2, leading=size * 1.45, alignment=TA_CENTER),
        "city": ParagraphStyle("city", parent=base, fontSize=size * 0.9, alignment=TA_CENTER),
        "bold": ParagraphStyle("bold", parent=base, fontName=FONT + "-Bold", spaceBefore=size * 0.8),
        "para": ParagraphStyle("para", parent=base, alignment=TA_JUSTIFY, firstLineIndent=size * 2.5, spaceBefore=size * 0.35),
        "cell": ParagraphStyle("cell", parent=base, leading=size * 1.15),
        "num": ParagraphStyle("num", parent=base, leading=size * 1.15, alignment=TA_CENTER),
        "cell_head": ParagraphStyle("cell_head", parent=base, fontName=FONT + "-Bold", leading=size * 1.15),
        "basis": ParagraphStyle("basis", parent=base, fontName=FONT + "-Italic", firstLineIndent=size * 2.5, spaceBefore=size * 0.6),
    }


def _body(order: dict, lang: str, size: float, width: float, signer_qr: Optional[bytes]) -> list:
    doc = DOC[lang]
    style = _styles(size)

    def text(field: str) -> str:
        return (lang == "kz" and order.get(f"{field}_kz")) or order.get(f"{field}_ru") or ""

    order_date = order.get("order_date")
    parts = [
        Letterhead(width),
        Spacer(1, 3 * mm),
        Paragraph(escape(doc["title"](order.get("number"), order_date.strftime("%d.%m.%Y") if order_date else "")), style["title"]),
        Paragraph(escape(doc["city"]), style["city"]),
        Paragraph(escape(text("title")), style["bold"]),
        Paragraph(f"{escape(text('purpose'))} <b>{doc['command']}</b>", style["para"]),
        Paragraph(escape(doc["item"]), style["para"]),
    ]
    num_w, name_w = 9 * mm, 42 * mm
    rows = [[Paragraph("№", style["cell_head"]), Paragraph(doc["position"], style["cell_head"]), Paragraph(doc["name"], style["cell_head"])]]
    for index, member in enumerate(order["members"], start=1):
        position = (lang == "kz" and member.get("position_kz")) or member.get("position_ru") or ""
        rows.append([Paragraph(str(index), style["num"]), Paragraph(escape(position), style["cell"]),
                     Paragraph(escape(member.get("name") or ""), style["cell"])])
    # Шапка таблицы повторяется на второй странице
    table = Table(rows, colWidths=[num_w, width - num_w - name_w, name_w], repeatRows=1)
    pad = size * 0.2
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 0.5, colors.black),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), pad),
        ("BOTTOMPADDING", (0, 0), (-1, -1), pad + 1),
        ("LEFTPADDING", (0, 0), (-1, -1), size * 0.35),
        ("RIGHTPADDING", (0, 0), (-1, -1), size * 0.35),
    ]))
    table.spaceBefore = size * 0.5
    parts.append(table)

    # Примечание и строка подписи не отрываются друг от друга
    ending = [Spacer(1, size * 0.6)]
    if text("basis"):
        ending.append(Paragraph(f"{escape(doc['basis'])} {escape(text('basis'))}", style["basis"]))
    position, name = split_signer(order.get("signed_by"))
    if lang == "kz":
        position = SIGNER_POSITION_KZ.get(position, position)
    sign_style = ParagraphStyle("sign", parent=style["cell_head"], fontSize=size, leading=size * 1.2)
    middle = Image(io.BytesIO(signer_qr), 24 * mm, 24 * mm) if signer_qr else Paragraph("_" * 28, ParagraphStyle("line", parent=sign_style, alignment=TA_CENTER))
    signature = Table(
        [[Paragraph(escape(position), sign_style), middle, Paragraph(escape(name), ParagraphStyle("name", parent=sign_style, alignment=TA_RIGHT))]],
        colWidths=[(width - 30 * mm) / 2, 30 * mm, (width - 30 * mm) / 2],
    )
    signature.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (1, 0), (1, 0), "CENTER"),
                                   ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    ending += [Spacer(1, size * 1.2), signature]
    parts.append(KeepTogether(ending))
    return parts


class Letterhead(Flowable):
    """Шапка университета: казахский текст — логотип — английский текст, под ними синяя черта."""

    LOGO = 16 * mm
    HEIGHT = LOGO + 2.5 * mm

    def __init__(self, width: float):
        super().__init__()
        self.width = width

    def wrap(self, available_width, available_height):
        return self.width, self.HEIGHT

    def draw(self):
        c = self.canv
        logo, center = self.LOGO, self.width / 2
        top = self.HEIGHT
        c.drawImage(ImageReader(os.path.join(BRAND_DIR, "kaztbu-logo.png")), center - logo / 2, top - logo, logo, logo, mask="auto")
        size, leading = 6.5, 7.6
        start = top - (logo - leading * len(LETTERHEAD["kz"])) / 2 - size
        for side, lines in LETTERHEAD.items():
            for index, line in enumerate(lines):
                c.setFont(FONT + ("-Bold" if index < 2 else ""), size)
                c.setFillColor(NAVY if index < 2 else colors.black)
                y = start - index * leading
                if side == "kz":
                    c.drawRightString(center - logo / 2 - 4 * mm, y, line)
                else:
                    c.drawString(center + logo / 2 + 4 * mm, y, line)
        c.setStrokeColor(NAVY)
        c.setLineWidth(1.5)
        c.line(0, 0.5, self.width, 0.5)
        c.setFillColor(colors.black)
        c.setStrokeColor(colors.black)


def _page_marks(order: dict, doc_qr: Optional[bytes]):
    """Отметки электронного документа на каждой странице подписанного приказа: водяной знак,
    дата и система на правом поле, внизу — QR-код проверки и норма о равнозначности."""
    def draw(c: canvas.Canvas, _doc) -> None:
        if not doc_qr:
            return
        c.saveState()
        wm_w = 150 * mm
        c.drawImage(ImageReader(os.path.join(BRAND_DIR, "kaztbu-watermark-faint.png")), (PAGE_W - wm_w) / 2, (PAGE_H - wm_w) / 2, wm_w, wm_w)
        c.setFont(FONT, 9.5)
        c.setFillColor(STAMP_BLUE)
        c.translate(PAGE_W - 6 * mm, PAGE_H / 2)
        c.rotate(-90)
        c.drawCentredString(0, 0, f"Дата: {order['signed_at_text']}. Система: {SYSTEM_NAME}. Электронный документ.")
        c.restoreState()
        qr = 18 * mm
        c.drawImage(ImageReader(io.BytesIO(doc_qr)), MARGIN_X, MARGIN_BOTTOM, qr, qr)
        note = Paragraph(escape(LEGAL_NOTE), ParagraphStyle("note", fontName=FONT, fontSize=6.5, leading=8))
        note.wrap(PAGE_W - 2 * MARGIN_X - qr - 4 * mm, PAGE_H)
        note.drawOn(c, MARGIN_X + qr + 4 * mm, MARGIN_BOTTOM)
    return draw


def _document(buffer, order: dict, signed: bool, doc_qr: Optional[bytes]) -> BaseDocTemplate:
    footer = 22 * mm if signed else 0
    frame = Frame(MARGIN_X, MARGIN_BOTTOM + footer, PAGE_W - 2 * MARGIN_X, PAGE_H - MARGIN_TOP - MARGIN_BOTTOM - footer,
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(buffer, pagesize=A4, title=f"{order.get('title_ru') or 'Приказ'} № {order.get('number') or ''}".strip(),
                          author=SYSTEM_NAME)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=_page_marks(order, doc_qr))])
    return doc


def _fit_size(order: dict, lang: str, signed: bool, signer_qr, doc_qr) -> float:
    """Самый крупный размер текста, при котором документ на языке lang занимает не больше MAX_PAGES страниц."""
    width = PAGE_W - 2 * MARGIN_X
    size = MAX_FONT
    while size > MIN_FONT:
        doc = _document(io.BytesIO(), order, signed, doc_qr)
        doc.build(_body(order, lang, size, width, signer_qr))
        if doc.page <= MAX_PAGES:
            return size
        size -= 0.5
    return MIN_FONT


def render_order_pdf(order: dict, verify_url: Optional[str], languages: tuple[str, ...] = ("ru",)) -> bytes:
    """PDF приказа: на каждый язык — свой документ до двух страниц A4 (подряд в одном файле).
    order — как committee_service.order_detail, но order_date — date, signed_at — datetime (UTC).
    verify_url — у подписанного ЭЦП: QR-коды подписанта и проверки, отметки электронного документа."""
    _register_fonts()
    signed = bool(order.get("signed_at") and verify_url)
    order = {**order, "signed_at_text": format_signed_at(order.get("signed_at"))}
    signer_qr = _qr(signer_qr_text(order, verify_url), "l") if signed else None
    doc_qr = _qr(verify_url) if signed else None
    width = PAGE_W - 2 * MARGIN_X
    story = []
    for index, lang in enumerate(languages):
        if index:
            story.append(PageBreak())
        story += _body(order, lang, _fit_size(order, lang, signed, signer_qr, doc_qr), width, signer_qr)
    buffer = io.BytesIO()
    _document(buffer, order, signed, doc_qr).build(story)
    return buffer.getvalue()
