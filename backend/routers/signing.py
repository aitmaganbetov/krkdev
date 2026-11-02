from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from routers.peer_visit_schedule import schedule_pdf_response
from services import committee_service, get_current_user_context
from services import schedule_approval_service as approvals
from services import situational_monitoring as monitoring
from services.audit_log import audit_event
from services.request_meta import get_client_ip

# Документы на подпись ЭЦП (любая роль: подписант определяется по логину Platonus), проверка по QR-коду
# и личный дашборд «Мои показатели».
# Приказ о комитете КРК подписывается через /committee/signing, график взаимопосещения — здесь.
router = APIRouter(tags=["signing"])


class SignIn(BaseModel):
    # CMS из NCALayer (base64 или PEM)
    cms: str = Field(min_length=1, max_length=65536)


@router.get("/signing")
def signing_list(db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    """Все документы, ожидающие подписи текущего пользователя."""
    committee = [{"kind": "committee", "id": o["id"], "title": f"Приказ № {o['number']} о составе комитета ректорского контроля",
                  "subtitle": o["academic_year"], "sent_at": o["sent_at"]}
                 for o in committee_service.pending_for(db, context["username"])]
    return sorted(committee + approvals.pending_for(db, context["username"]), key=lambda item: item["sent_at"])


def _schedule_for_signer(db: Session, approval_id: int, context: dict):
    approval = approvals.get(db, approval_id)
    if approval.status == "draft" or not approvals.my_signer(db, approval, context["username"]):
        raise HTTPException(status_code=403, detail="Документ адресован другому подписанту")
    return approval


@router.get("/signing/schedule/{approval_id}")
def schedule_document(approval_id: int, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    approval = _schedule_for_signer(db, approval_id, context)
    mine = approvals.my_signer(db, approval, context["username"])
    data = approvals.detail(db, approval, approval.academic_year, approval.period, approval.faculty_id)
    can_sign = approval.status == "on_signing" and not mine.signed_at and mine.stage == approval.stage
    data.update(my_signer_id=mine.id, sign_data=approvals.sign_data(approval) if can_sign else None)
    return data


@router.post("/signing/schedule/{approval_id}")
def sign_schedule(approval_id: int, body: SignIn, request: Request, db: Session = Depends(get_db),
                  context: dict = Depends(get_current_user_context)):
    approval = _schedule_for_signer(db, approval_id, context)
    try:
        approval = approvals.sign(db, approval, context["username"], body.cms)
    except HTTPException as exc:
        audit_event(action="peer_visit_schedule.approval.sign", outcome="failure", actor=context["username"],
                    details={"approval_id": approval_id, "reason": exc.detail}, db=db, ip_address=get_client_ip(request))
        raise
    audit_event(action="peer_visit_schedule.approval.sign", outcome="success", actor=context["username"],
                details={"approval_id": approval.id, "status": approval.status}, db=db, ip_address=get_client_ip(request))
    return schedule_document(approval_id, db, context)


@router.get("/signing/schedule/{approval_id}/pdf")
def schedule_document_pdf(approval_id: int, request: Request, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    return schedule_pdf_response(db, _schedule_for_signer(db, approval_id, context), request)


@router.get("/dashboard/me")
def my_dashboard(academic_year: Optional[str] = None, db: Session = Depends(get_db), context: dict = Depends(get_current_user_context)):
    """«Мои показатели»: только данные текущего пользователя (services/personal_dashboard.py)."""
    from services.personal_dashboard import personal_dashboard

    return personal_dashboard(db, context["username"], context["role"], academic_year or None)


@router.get("/verify/{token}")
def verify_document(token: str, db: Session = Depends(get_db)):
    """Проверка подлинности документа по QR-коду — без входа в систему."""
    if not token.isalnum() or len(token) != 32:
        raise HTTPException(status_code=404, detail="Документ не найден")
    schedule = approvals.verification(db, token)
    if schedule:
        return schedule
    # Чек-лист ситуационного видеомониторинга, подписанный ЭЦП наблюдателя
    checklist = monitoring.verification(db, token)
    if checklist:
        return checklist
    return {"kind": "committee", **committee_service.verification(db, token)}
