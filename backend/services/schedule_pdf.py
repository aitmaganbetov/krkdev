"""PDF графика взаимопосещения на утверждение (альбомный A4) — как утверждённые бумажные графики 2026-2027.

Подписи — по маршруту утверждения (schedule_approval_service): УТВЕРЖДАЮ (проректор), заведующие кафедрами,
«Согласовано» (декан, УОП, МО). Подписавший ЭЦП получает вместо линии QR-код подписанта; у отправленного
на подпись графика на каждой странице — QR-код проверки подлинности и норма о равнозначности, у утверждённого —
ещё водяной знак и отметка электронного документа.
"""
import io
import os
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import BaseDocTemplate, Frame, Image, KeepTogether, PageTemplate, Paragraph, Spacer, Table, TableStyle

from services.committee_pdf import BRAND_DIR, FONT, LEGAL_NOTE, STAMP_BLUE, SYSTEM_NAME, _qr, _register_fonts, format_signed_at

PAGE_W, PAGE_H = landscape(A4)
MARGIN_X, MARGIN_Y = 12 * mm, 10 * mm
SIZE = 9
MONTHS_BY_PERIOD = {1: [9, 10, 11, 12], 2: [1, 2, 3, 4, 5]}
MONTH_RU = {1: "январь", 2: "февраль", 3: "март", 4: "апрель", 5: "май", 9: "сентябрь", 10: "октябрь", 11: "ноябрь", 12: "декабрь"}
PERIOD_RU = {1: "первый", 2: "второй"}
UNIVERSITY = "АО «Казахский университет технологии и бизнеса им. К.Кулажанова»"


def _style(name: str, **kwargs) -> ParagraphStyle:
    return ParagraphStyle(name, **{"fontName": FONT, "fontSize": SIZE, "leading": SIZE * 1.2, **kwargs})


def _person(name, position) -> str:
    return ", ".join(part for part in (name, position) if part)


def _signer_qr(signer, verify_url: str) -> bytes:
    subject = (signer.signature_info or {}).get("subject") or signer.name
    return _qr(f"Подписано в системе {SYSTEM_NAME}. Подписант {subject}. Время подписи {format_signed_at(signer.signed_at)}.\n{verify_url}", "l")


def _mark(signer, verify_url, size: float):
    """Место подписи: QR-код подписанта (подписал ЭЦП) или линия для подписи от руки."""
    if signer is not None and signer.signed_at and verify_url:
        return Image(io.BytesIO(_signer_qr(signer, verify_url)), size, size)
    return Table([[""]], colWidths=[22 * mm], rowHeights=[5 * mm], style=[("LINEBELOW", (0, 0), (-1, -1), 0.6, colors.black)])


def _signature_row(label: str, signer, verify_url, width: float) -> Table:
    table = Table([[Paragraph(escape(label), _style("label")), _mark(signer, verify_url, 16 * mm),
                    Paragraph(escape(signer.name if signer else ""), _style("name"))]],
                  colWidths=[width * 0.55, 30 * mm, width * 0.45 - 30 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                               ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    return table


def _group(rows) -> list[dict]:
    """Строки графика → кафедры → посещаемые; у посещаемого — посещающие по месяцам (как в бумажном графике)."""
    cafedras, by_key = [], {}
    for row in rows:
        key = row.cafedra_id if row.cafedra_id is not None else row.cafedra_name
        if key not in by_key:
            by_key[key] = {"name": row.cafedra_name, "teachers": [], "by_teacher": {}}
            cafedras.append(by_key[key])
        group = by_key[key]
        teacher_key = row.visited_tutor_id or row.visited_name
        if teacher_key not in group["by_teacher"]:
            group["by_teacher"][teacher_key] = {"name": _person(row.visited_name, row.visited_position), "months": {}}
            group["teachers"].append(group["by_teacher"][teacher_key])
        group["by_teacher"][teacher_key]["months"].setdefault(row.month, []).append(_person(row.visitor_name, row.visitor_position))
    return cafedras


def _page_marks(approval, doc_qr):
    def draw(c, _doc):
        if not doc_qr:
            return
        c.saveState()
        if approval.status == "approved":
            wm = 130 * mm
            c.drawImage(ImageReader(os.path.join(BRAND_DIR, "kaztbu-watermark-faint.png")), (PAGE_W - wm) / 2, (PAGE_H - wm) / 2, wm, wm)
            c.setFont(FONT, 9.5)
            c.setFillColor(STAMP_BLUE)
            c.translate(PAGE_W - 5 * mm, PAGE_H / 2)
            c.rotate(-90)
            c.drawCentredString(0, 0, f"Дата: {format_signed_at(approval.approved_at)}. Система: {SYSTEM_NAME}. Электронный документ.")
        c.restoreState()
        qr = 15 * mm
        c.drawImage(ImageReader(io.BytesIO(doc_qr)), MARGIN_X, MARGIN_Y, qr, qr)
        note = Paragraph(escape(LEGAL_NOTE), ParagraphStyle("note", fontName=FONT, fontSize=6.5, leading=8))
        note.wrap(PAGE_W - 2 * MARGIN_X - qr - 4 * mm, PAGE_H)
        note.drawOn(c, MARGIN_X + qr + 4 * mm, MARGIN_Y)
    return draw


def render_schedule_pdf(approval, rows, signers, verify_url) -> bytes:
    _register_fonts()
    width = PAGE_W - 2 * MARGIN_X
    doc_qr = _qr(verify_url) if verify_url else None
    approver = next((s for s in signers if s.role == "approver"), None)
    year = (approval.academic_year or "").split("-")[0] or "20__"
    bold = _style("bold", fontName=FONT + "-Bold")

    story = [Paragraph(escape(UNIVERSITY), _style("university", fontName=FONT + "-Bold", alignment=TA_CENTER)), Spacer(1, 4 * mm)]
    # УТВЕРЖДАЮ — справа
    approved_date = format_signed_at(approver.signed_at)[:10] + " г." if approver and approver.signed_at else f"«____» ______________ {year} г."
    approve_block = [
        [Paragraph("УТВЕРЖДАЮ", bold)],
        [Paragraph(escape(approver.label if approver else "Проректор по АВ"), _style("approver_label"))],
        [Table([[_mark(approver, verify_url, 18 * mm), Paragraph(escape(approver.name if approver else ""), _style("approver_name"))]],
               colWidths=[24 * mm, 46 * mm], style=[("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 0)])],
        [Paragraph(approved_date, _style("approver_date"))],
    ]
    story.append(Table(approve_block, colWidths=[72 * mm], hAlign="RIGHT",
                       style=[("LEFTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1)]))
    story += [
        Spacer(1, 4 * mm),
        Paragraph(f"График взаимопосещения занятий ППС {escape(approval.title)}",
                  _style("title", fontName=FONT + "-Bold", fontSize=11, leading=14, alignment=TA_CENTER)),
        Paragraph(f"на {PERIOD_RU.get(approval.period, '')} академический период {escape(approval.academic_year)} учебного года",
                  _style("subtitle", fontName=FONT + "-Bold", alignment=TA_CENTER)),
        Spacer(1, 3 * mm),
    ]

    months = MONTHS_BY_PERIOD.get(approval.period, MONTHS_BY_PERIOD[1])
    cell, head = _style("cell", leading=SIZE * 1.15), _style("head", fontName=FONT + "-Bold", alignment=TA_CENTER, leading=SIZE * 1.15)
    data = [
        [Paragraph("№ п/п", head), Paragraph("Ф.И.О. посещаемого преподавателя, должность, ученая/академическая степень, ученое звание", head),
         Paragraph("Ф.И.О., посещающего занятие, должность/ученая степень", head)] + [""] * (len(months) - 1),
        ["", ""] + [Paragraph(MONTH_RU[m], head) for m in months],
    ]
    spans = [("SPAN", (0, 0), (0, 1)), ("SPAN", (1, 0), (1, 1)), ("SPAN", (2, 0), (-1, 0))]
    number = 0
    for cafedra in _group(rows):
        spans.append(("SPAN", (0, len(data)), (-1, len(data))))
        data.append([Paragraph(f"Кафедра «{escape(cafedra['name'])}»", head)] + [""] * (len(months) + 1))
        for teacher in cafedra["teachers"]:
            number += 1
            data.append([Paragraph(f"{number}.", cell), Paragraph(escape(teacher["name"]), cell)]
                        + [Paragraph("<br/>".join(escape(v) for v in teacher["months"].get(m, [])), cell) for m in months])
    first_w, name_w = 10 * mm, width * 0.26
    month_w = (width - first_w - name_w) / len(months)
    table = Table(data, colWidths=[first_w, name_w] + [month_w] * len(months), repeatRows=2)
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                               ("VALIGN", (0, 0), (-1, 1), "MIDDLE"), *spans]))
    story.append(table)

    story.append(Spacer(1, 5 * mm))
    for signer in [s for s in signers if s.stage == 1]:
        story.append(_signature_row(signer.label, signer, verify_url, width * 0.75))
    agreed = [Spacer(1, 4 * mm), Paragraph("Согласовано:", bold)]
    agreed += [_signature_row(signer.label, signer, verify_url, width * 0.75) for signer in signers if signer.stage == 2]
    story.append(KeepTogether(agreed))

    buffer = io.BytesIO()
    bottom = MARGIN_Y + (18 * mm if doc_qr else 0)
    frame = Frame(MARGIN_X, bottom, width, PAGE_H - MARGIN_Y - bottom, leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(buffer, pagesize=landscape(A4), title=f"График взаимопосещения {approval.title} {approval.academic_year}", author=SYSTEM_NAME)
    doc.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=_page_marks(approval, doc_qr))])
    doc.build(story)
    return buffer.getvalue()
