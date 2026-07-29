from datetime import date, datetime, timezone

import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models.violation import Violation
from models.violation_evidence import ViolationEvidence
from services import ROLE_ADMIN, ROLE_INSPECTOR, require_roles
from services.audit_log import audit_event

router = APIRouter(prefix="/violations", tags=["violations"])


class ViolationCreate(BaseModel):
    lesson_ref: str = Field(min_length=1, max_length=100)
    teacher: str = Field(min_length=1, max_length=255)
    room: str = Field(default="", max_length=255)
    subject: str = Field(default="", max_length=255)
    violation_type: str = Field(min_length=1, max_length=150)
    violation_date: date
    description: str = Field(default="", max_length=10000)
    evidence_ids: list[int] = Field(default_factory=list, max_length=20)


class EvidenceSummary(BaseModel):
    id: int
    media_type: str
    url: str


class ViolationOut(BaseModel):
    id: int
    lesson_ref: str
    teacher: str
    room: str
    subject: str
    violation_type: str
    violation_date: date
    description: str
    status: str
    created_by: str
    created_at: datetime
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str = ""
    act_url: str | None = None
    act_uploaded_by: str | None = None
    act_uploaded_at: datetime | None = None
    evidence_ids: list[int] = Field(default_factory=list)
    evidence: list[EvidenceSummary] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ViolationReview(BaseModel):
    status: str
    comment: str = Field(default="", max_length=5000)


def _set_act_url(item: ViolationOut, violation: Violation) -> None:
    if violation.act_filename:
        item.act_url = f"/api/violations/{violation.id}/act"


@router.get("", response_model=list[ViolationOut])
def list_violations(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    violations = db.query(Violation).order_by(Violation.created_at.desc()).limit(500).all()
    if not violations:
        return []
    evidence_rows = db.query(ViolationEvidence).filter(
        ViolationEvidence.violation_id.in_([item.id for item in violations])
    ).all()
    evidence_by_violation: dict[int, list[ViolationEvidence]] = {}
    for evidence in evidence_rows:
        evidence_by_violation.setdefault(evidence.violation_id, []).append(evidence)
    result = []
    for violation in violations:
        item = ViolationOut.model_validate(violation)
        rows = evidence_by_violation.get(violation.id, [])
        item.evidence_ids = [row.id for row in rows]
        item.evidence = [
            EvidenceSummary(id=row.id, media_type=row.media_type, url=f"/api/violations/evidence/{row.id}")
            for row in rows
        ]
        _set_act_url(item, violation)
        result.append(item)
    return result


@router.post("", response_model=ViolationOut, status_code=status.HTTP_201_CREATED)
def create_violation(
    body: ViolationCreate,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    payload = body.model_dump(exclude={"evidence_ids"})
    violation = Violation(**payload, created_by=context.get("username") or "unknown")
    db.add(violation)
    db.commit()
    db.refresh(violation)
    if body.evidence_ids:
        db.query(ViolationEvidence).filter(
            ViolationEvidence.id.in_(body.evidence_ids),
            ViolationEvidence.violation_id.is_(None),
            ViolationEvidence.created_by == (context.get("username") or "unknown"),
        ).update({"violation_id": violation.id}, synchronize_session=False)
        db.commit()
    audit_event(
        "monitoring.violation.create",
        actor=context.get("username"),
        details={"violation_id": violation.id, "lesson_ref": body.lesson_ref, "type": body.violation_type},
        db=db,
    )
    result = ViolationOut.model_validate(violation)
    result.evidence_ids = body.evidence_ids
    result.evidence = [
        EvidenceSummary(id=row.id, media_type=row.media_type, url=f"/api/violations/evidence/{row.id}")
        for row in db.query(ViolationEvidence).filter(ViolationEvidence.violation_id == violation.id).all()
    ]
    _set_act_url(result, violation)
    return result


@router.patch("/{violation_id}/review", response_model=ViolationOut)
def review_violation(
    violation_id: int,
    body: ViolationReview,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    decision = body.status.strip().lower()
    if decision not in {"confirmed", "rejected"}:
        raise HTTPException(status_code=400, detail="Статус должен быть confirmed или rejected")
    violation = db.get(Violation, violation_id)
    if not violation:
        raise HTTPException(status_code=404, detail="Нарушение не найдено")
    if violation.status != "pending":
        raise HTTPException(status_code=409, detail="Решение по нарушению уже принято и не может быть изменено")
    if decision == "confirmed" and not violation.act_filename:
        raise HTTPException(status_code=400, detail="Для подтверждения нарушения прикрепите АКТ в формате PDF")
    violation.status = decision
    violation.reviewed_by = context.get("username") or "unknown"
    violation.reviewed_at = datetime.now(timezone.utc)
    violation.review_comment = body.comment.strip()
    db.commit()
    db.refresh(violation)
    result = ViolationOut.model_validate(violation)
    evidence_rows = db.query(ViolationEvidence).filter(ViolationEvidence.violation_id == violation.id).all()
    result.evidence_ids = [row.id for row in evidence_rows]
    result.evidence = [
        EvidenceSummary(id=row.id, media_type=row.media_type, url=f"/api/violations/evidence/{row.id}")
        for row in evidence_rows
    ]
    _set_act_url(result, violation)
    audit_event(
        "admin.violation.review",
        actor=context.get("username"),
        details={"violation_id": violation.id, "decision": decision},
        db=db,
    )
    return result


@router.post("/{violation_id}/act", response_model=ViolationOut)
async def upload_violation_act(
    violation_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    violation = db.get(Violation, violation_id)
    if not violation:
        raise HTTPException(status_code=404, detail="Нарушение не найдено")
    if violation.status != "pending":
        raise HTTPException(status_code=409, detail="После принятия решения заменить АКТ невозможно")
    original_name = (file.filename or "").strip()
    if not original_name.lower().endswith(".pdf") or file.content_type not in {"application/pdf", "application/octet-stream"}:
        raise HTTPException(status_code=400, detail="Можно прикрепить только PDF-файл")
    content = await file.read(20 * 1024 * 1024 + 1)
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Размер PDF не должен превышать 20 МБ")
    if not content.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="Файл не является корректным PDF")
    act_root = os.getenv("VIOLATION_ACT_DIR", "/app/media/acts")
    os.makedirs(act_root, mode=0o750, exist_ok=True)
    filename = f"{uuid.uuid4().hex}.pdf"
    path = os.path.join(act_root, filename)
    with open(path, "wb") as target:
        target.write(content)
    violation.act_filename = filename
    violation.act_uploaded_by = context.get("username") or "unknown"
    violation.act_uploaded_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(violation)
    result = ViolationOut.model_validate(violation)
    evidence_rows = db.query(ViolationEvidence).filter(ViolationEvidence.violation_id == violation.id).all()
    result.evidence_ids = [row.id for row in evidence_rows]
    result.evidence = [
        EvidenceSummary(id=row.id, media_type=row.media_type, url=f"/api/violations/evidence/{row.id}")
        for row in evidence_rows
    ]
    _set_act_url(result, violation)
    audit_event(
        "admin.violation.act.upload",
        actor=context.get("username"),
        details={"violation_id": violation.id, "size": len(content)},
        db=db,
    )
    return result


@router.get("/{violation_id}/act")
def get_violation_act(
    violation_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    violation = db.get(Violation, violation_id)
    if not violation or not violation.act_filename:
        raise HTTPException(status_code=404, detail="АКТ не найден")
    act_root = os.getenv("VIOLATION_ACT_DIR", "/app/media/acts")
    path = os.path.join(act_root, violation.act_filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл АКТа не найден")
    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"act-violation-{violation.id}.pdf",
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/evidence/{evidence_id}")
def get_violation_evidence(
    evidence_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    evidence = db.get(ViolationEvidence, evidence_id)
    if not evidence:
        raise HTTPException(status_code=404, detail="Медиафайл не найден")
    media_root = os.getenv("VIOLATION_MEDIA_DIR", "/app/media/violations")
    path = os.path.join(media_root, evidence.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Файл доказательства не найден")
    media_type = "image/jpeg" if evidence.media_type == "photo" else "video/mp4"
    return FileResponse(path, media_type=media_type, filename=evidence.filename)
