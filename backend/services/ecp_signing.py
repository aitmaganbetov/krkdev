"""Подпись документа ЭЦП конкретного сотрудника Platonus (приказ о комитете КРК, график взаимопосещения).

Подписывается строка «тип:verify_token:SHA-256 содержимого» (NCALayer → присоединённая CMS). Сервер проверяет
подпись и отзыв сертификата (Kalkan + OCSP), что подписаны именно эти данные и что ИИН сертификата совпадает
с ИИН выбранного подписанта в Platonus (tutors.iin).
"""
import logging
import re
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from services import kalkan_service
from services.notification_service import login_aliases

logger = logging.getLogger(__name__)


def short_dn(dn: str) -> str:
    """Из DN — CN («CN=ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ (GOST) 2022, C=KZ» → «ҰЛТТЫҚ … 2022»)."""
    match = re.search(r"CN\s*=\s*([^,/]+)", dn or "")
    return match.group(1).strip() if match else (dn or "")


def tutor_ids_for(db: Session, username: str) -> list[int]:
    """Сотрудники Platonus, чей логин совпадает с учётной записью (с доменом и без)."""
    logins = login_aliases(username)
    if not logins:
        return []
    return [row[0] for row in db.execute(
        # tutors.login без учёта регистра (unicode_ci) и обрезан при синхронизации — индекс используется
        text("SELECT tutor_id FROM tutors WHERE login IN :logins").bindparams(bindparam("logins", expanding=True)),
        {"logins": logins},
    )]


def check_signer_ready(db: Session, tutor_id: Optional[int], label: str) -> None:
    """У подписанта должны быть ИИН (сверка с сертификатом) и логин (вход в КРК), иначе подписать он не сможет."""
    row = db.execute(text("SELECT full_name, login, iin FROM tutors WHERE tutor_id = :id"), {"id": tutor_id}).mappings().first() if tutor_id else None
    if not row:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"{label}: подписант не выбран")
    if not row["iin"] or not (row["login"] or "").strip():
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"{label}: у «{row['full_name']}» нет ИИН или логина в Platonus — подписать ЭЦП в КРК он не сможет")


def tutor_login(db: Session, tutor_id: Optional[int]) -> Optional[str]:
    login = db.execute(text("SELECT login FROM tutors WHERE tutor_id = :id"), {"id": tutor_id}).scalar() if tutor_id else None
    return login.strip() if login and login.strip() else None


def verify_signature(db: Session, cms: str, expected_data: str, signer_tutor_id: int) -> dict:
    """Проверяет CMS подписанта и возвращает сведения о подписи для документа и страницы проверки."""
    try:
        result = kalkan_service.verify_cms(cms)
    except kalkan_service.KalkanError as exc:
        logger.info("ЭЦП документа отклонена: %s", str(exc)[-300:])
        reason = kalkan_service.rejection_reason(exc)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=reason[1] if reason else "Подпись не прошла проверку") from None
    if (result.data or b"").decode("utf-8", "replace") != expected_data:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="Подписаны не те данные — обновите страницу и подпишите снова")
    signer_iin = db.execute(text("SELECT iin FROM tutors WHERE tutor_id = :id"), {"id": signer_tutor_id}).scalar()
    if not signer_iin or result.cert.iin != signer_iin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Сертификат ЭЦП принадлежит не подписанту документа")
    cert = result.cert
    return {
        "certificate_serial": cert.extra.get("cert_sn", ""),
        "subject": cert.common_name or short_dn(cert.subject_dn),
        "issuer": short_dn(cert.issuer_dn),
        "valid_from": cert.not_before,
        "valid_to": cert.not_after,
        "ocsp": "good" if result.ocsp_status else "",
    }
