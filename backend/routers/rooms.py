import asyncio
import os
import subprocess
import uuid
from urllib.parse import quote
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import (
    HTTPBasicAuthHandler,
    HTTPDigestAuthHandler,
    HTTPPasswordMgrWithDefaultRealm,
    Request as UrlRequest,
    build_opener,
    urlopen,
)

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import case, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models.room import Room
from models.room_inventory import RoomInventoryItem
from models.violation_evidence import ViolationEvidence
from services import ROLE_ADMIN, ROLE_DEAN, ROLE_SUPERADMIN, require_roles
from services.faculty_scope import dean_faculty_id, forbid_other_faculty
from services.schedule_service import faculty_has_lesson_in_room_today
from services.audit_log import audit_event
from services.camera_settings import get_live_max_streams, live_streams as _live_streams
from services.room_sync_service import new_qr_code, sync_rooms_from_platonus
from services.secret_box import decrypt_secret, encrypt_secret

router = APIRouter(prefix="/rooms", tags=["rooms"])

# Каждая трансляция — отдельный ffmpeg с перекодированием. Лимит одновременных трансляций задаётся
# в «Настройках системы» (services/camera_settings.py), по умолчанию — CAMERA_LIVE_MAX_STREAMS.


async def _stop_ffmpeg(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=2)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()


class RoomIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    building: str = Field(default="", max_length=150)
    floor: str = Field(default="", max_length=30)
    capacity: int = Field(default=0, ge=0, le=10000)
    area: float = Field(default=0, ge=0, le=100000)
    equipment: str = Field(default="", max_length=10000)
    notes: str = Field(default="", max_length=10000)
    camera_enabled: bool = False
    camera_api_url: str = Field(default="", max_length=1000)
    camera_stream_url: str = Field(default="", max_length=1000)
    camera_username: str = Field(default="", max_length=255)
    camera_api_key: str = Field(default="", max_length=4000)

    @field_validator("camera_api_url", "camera_stream_url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        value = value.strip()
        if value and urlparse(value).scheme.lower() not in {"http", "https", "rtsp", "rtsps"}:
            raise ValueError("Разрешены URL со схемой http, https, rtsp или rtsps")
        return value


class RoomOut(BaseModel):
    id: int
    name: str
    building: str
    floor: str
    capacity: int
    area: float = 0
    equipment: str
    notes: str
    room_type: str
    platonus_auditory_id: int | None
    qr_code: str | None = None
    camera_enabled: bool
    camera_api_url: str
    camera_stream_url: str
    camera_username: str
    camera_api_key_configured: bool
    # Инвентаризация: число позиций и стоимость оснащения без списанного (тенге)
    inventory_count: int = 0
    inventory_total: float = 0


class CameraTestOut(BaseModel):
    success: bool
    message: str
    status_code: int | None = None


class CameraEvidenceOut(BaseModel):
    id: int
    media_type: str
    url: str


# Шифрование секретов в БД — общий модуль (камеры, AI, LDAP)
_encrypt_secret = encrypt_secret
_decrypt_secret = decrypt_secret


def _ensure_dean_room(db: Session, context: dict, room: Room) -> None:
    """Деканат смотрит камеры только тех аудиторий, где сегодня идут занятия его факультета."""
    faculty_id = dean_faculty_id(context)
    if faculty_id is not None and not faculty_has_lesson_in_room_today(db, room.id, faculty_id):
        raise forbid_other_faculty("Камера доступна только в аудиториях, где сегодня занятия вашего факультета")


class InventoryItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    category: str = Field(default="", max_length=100)
    inventory_number: str = Field(default="", max_length=100)
    quantity: int = Field(default=1, ge=0, le=100000)
    unit_price: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("999999999999.99"), decimal_places=2)
    condition: Literal["good", "repair", "written_off"] = "good"
    acquired_year: int | None = Field(default=None, ge=1950, le=2100)
    notes: str = Field(default="", max_length=5000)


class InventoryItemOut(BaseModel):
    id: int
    room_id: int
    name: str
    category: str
    inventory_number: str
    quantity: int
    unit_price: float
    total: float
    condition: str
    acquired_year: int | None
    notes: str
    from_platonus: bool
    updated_by: str | None


class RoomInventoryOut(BaseModel):
    room_id: int
    items: list[InventoryItemOut]
    total: float
    written_off_total: float


def _active_value():
    """Стоимость позиции для итога кабинета: списанное оснащение не учитывается."""
    return case(
        (RoomInventoryItem.condition != "written_off", RoomInventoryItem.quantity * RoomInventoryItem.unit_price),
        else_=0,
    )


def _inventory_totals(db: Session, room_ids: list[int] | None = None) -> dict[int, tuple[int, float]]:
    query = db.query(RoomInventoryItem.room_id, func.count(RoomInventoryItem.id), func.coalesce(func.sum(_active_value()), 0))
    if room_ids is not None:
        query = query.filter(RoomInventoryItem.room_id.in_(room_ids))
    return {room_id: (int(count), float(total)) for room_id, count, total in query.group_by(RoomInventoryItem.room_id).all()}


def _serialize_item(item: RoomInventoryItem) -> InventoryItemOut:
    unit_price = float(item.unit_price or 0)
    return InventoryItemOut(
        id=item.id,
        room_id=item.room_id,
        name=item.name,
        category=item.category or "",
        inventory_number=item.inventory_number or "",
        quantity=item.quantity or 0,
        unit_price=unit_price,
        total=round(unit_price * (item.quantity or 0), 2),
        condition=item.condition or "good",
        acquired_year=item.acquired_year,
        notes=item.notes or "",
        from_platonus=item.platonus_equipment_id is not None,
        updated_by=item.updated_by,
    )


def _serialize(room: Room, totals: tuple[int, float] | None = None) -> RoomOut:
    count, total = totals or (0, 0.0)
    return RoomOut(
        inventory_count=count,
        inventory_total=total,
        id=room.id,
        name=room.name,
        building=room.building or "",
        floor=room.floor or "",
        capacity=room.capacity or 0,
        area=float(room.area or 0),
        equipment=room.equipment or "",
        notes=room.notes or "",
        room_type=room.room_type or "",
        platonus_auditory_id=room.platonus_auditory_id,
        qr_code=room.qr_code,
        camera_enabled=bool(room.camera_enabled),
        camera_api_url=room.camera_api_url or "",
        camera_stream_url=room.camera_stream_url or "",
        camera_username=room.camera_username or "",
        camera_api_key_configured=bool(room.camera_api_key_encrypted),
    )


def _authenticated_stream_url(room: Room) -> str:
    parsed = urlparse(room.camera_stream_url or "")
    if parsed.scheme not in {"rtsp", "rtsps"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Укажите корректный RTSP URL камеры")

    secret = _decrypt_secret(room.camera_api_key_encrypted)
    if not room.camera_username or not secret or parsed.username is not None:
        return room.camera_stream_url

    credentials = f"{quote(room.camera_username, safe='')}:{quote(secret, safe='')}@"
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    port = f":{parsed.port}" if parsed.port else ""
    result = f"{parsed.scheme}://{credentials}{host}{port}{parsed.path or ''}"
    if parsed.query:
        result += f"?{parsed.query}"
    return result


def _media_root() -> str:
    path = os.getenv("VIOLATION_MEDIA_DIR", "/app/media/violations")
    os.makedirs(path, mode=0o750, exist_ok=True)
    return path


def _save_evidence_row(db: Session, room: Room, media_type: str, filename: str, actor: str) -> CameraEvidenceOut:
    evidence = ViolationEvidence(
        room_id=room.id,
        media_type=media_type,
        filename=filename,
        created_by=actor,
    )
    db.add(evidence)
    db.commit()
    db.refresh(evidence)
    return CameraEvidenceOut(
        id=evidence.id,
        media_type=media_type,
        url=f"/api/violations/evidence/{evidence.id}",
    )


def _ensure_unique_name(db: Session, name: str, building: str, room_id: int | None = None) -> None:
    query = db.query(Room.id).filter(Room.name == name, Room.building == building)
    if room_id is not None:
        query = query.filter(Room.id != room_id)
    if query.first():
        raise HTTPException(status_code=409, detail="Кабинет с таким названием в этом корпусе уже существует")


@router.get("", response_model=list[RoomOut])
def list_rooms(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    totals = _inventory_totals(db)
    return [_serialize(room, totals.get(room.id)) for room in db.query(Room).order_by(Room.building, Room.name).all()]


# Настройку камеры (включение, адреса, учётные данные) меняет только суперадминистратор,
# чтобы администратор, работающий с кабинетами, случайно её не сбил
CAMERA_FIELDS = ("camera_enabled", "camera_api_url", "camera_stream_url", "camera_username")


def _ensure_camera_unchanged(context: dict, room: Room | None, body: RoomIn) -> None:
    if context.get("role") == ROLE_SUPERADMIN:
        return
    incoming = body.model_dump(include=set(CAMERA_FIELDS), exclude_unset=True)
    current = {
        "camera_enabled": bool(room.camera_enabled) if room else False,
        "camera_api_url": (room.camera_api_url or "") if room else "",
        "camera_stream_url": (room.camera_stream_url or "") if room else "",
        "camera_username": (room.camera_username or "") if room else "",
    }
    if body.camera_api_key or any(value != current[key] for key, value in incoming.items()):
        raise HTTPException(status_code=403, detail="Настройки камеры меняет только суперадминистратор")


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
def create_room(
    body: RoomIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    _ensure_camera_unchanged(context, None, body)
    room = Room(**body.model_dump(exclude={"camera_api_key"}))
    room.name = body.name.strip()
    room.qr_code = new_qr_code()
    _ensure_unique_name(db, room.name, room.building)
    room.camera_api_key_encrypted = _encrypt_secret(body.camera_api_key)
    db.add(room)
    try:
        db.commit()
        db.refresh(room)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Кабинет с таким названием уже существует") from exc
    audit_event("admin.rooms.create", actor=context.get("username"), details={"room_id": room.id, "name": room.name}, db=db)
    return _serialize(room)


@router.patch("/{room_id}", response_model=RoomOut)
def update_room(
    room_id: int,
    body: RoomIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    _ensure_camera_unchanged(context, room, body)
    # Только переданные поля: иначе частичный PATCH обнулял бы остальные значениями по умолчанию
    previous = (room.name, room.building)
    for key, value in body.model_dump(exclude={"camera_api_key"}, exclude_unset=True).items():
        setattr(room, key, value)
    room.name = body.name.strip()
    # Дубли номеров внутри корпуса бывают в самом Platonus — проверяем только при переименовании
    if (room.name, room.building) != previous:
        _ensure_unique_name(db, room.name, room.building, room.id)
    if body.camera_api_key:
        room.camera_api_key_encrypted = _encrypt_secret(body.camera_api_key)
    try:
        db.commit()
        db.refresh(room)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Кабинет с таким названием уже существует") from exc
    audit_event("admin.rooms.update", actor=context.get("username"), details={"room_id": room.id, "name": room.name}, db=db)
    return _serialize(room, _inventory_totals(db, [room.id]).get(room.id))


@router.post("/platonus-sync")
def sync_rooms(
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    result = sync_rooms_from_platonus(db)
    if result["status"] != "success":
        raise HTTPException(status_code=502, detail=result["message"])
    audit_event(
        "admin.rooms.platonus_sync",
        actor=context.get("username"),
        details={key: result[key] for key in ("total", "created", "updated", "linked")} | {"missing": len(result["missing"])},
        db=db,
    )
    return result


def _get_room(db: Session, room_id: int) -> Room:
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    return room


def _room_inventory(db: Session, room_id: int) -> RoomInventoryOut:
    items = (
        db.query(RoomInventoryItem)
        .filter(RoomInventoryItem.room_id == room_id)
        .order_by(RoomInventoryItem.category, RoomInventoryItem.name, RoomInventoryItem.id)
        .all()
    )
    serialized = [_serialize_item(item) for item in items]
    return RoomInventoryOut(
        room_id=room_id,
        items=serialized,
        total=round(sum(item.total for item in serialized if item.condition != "written_off"), 2),
        written_off_total=round(sum(item.total for item in serialized if item.condition == "written_off"), 2),
    )


@router.get("/{room_id}/inventory", response_model=RoomInventoryOut)
def get_room_inventory(
    room_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    _get_room(db, room_id)
    return _room_inventory(db, room_id)


@router.post("/{room_id}/inventory", response_model=InventoryItemOut, status_code=status.HTTP_201_CREATED)
def add_inventory_item(
    room_id: int,
    body: InventoryItemIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = _get_room(db, room_id)
    item = RoomInventoryItem(room_id=room.id, **body.model_dump(), updated_by=context.get("username"))
    item.name = body.name.strip()
    db.add(item)
    db.commit()
    db.refresh(item)
    audit_event("admin.rooms.inventory.create", actor=context.get("username"),
                details={"room_id": room.id, "item_id": item.id, "name": item.name}, db=db)
    return _serialize_item(item)


@router.patch("/inventory/{item_id}", response_model=InventoryItemOut)
def update_inventory_item(
    item_id: int,
    body: InventoryItemIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    item = db.get(RoomInventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Позиция оснащения не найдена")
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    item.name = body.name.strip()
    item.updated_by = context.get("username")
    db.commit()
    db.refresh(item)
    audit_event("admin.rooms.inventory.update", actor=context.get("username"),
                details={"room_id": item.room_id, "item_id": item.id, "name": item.name}, db=db)
    return _serialize_item(item)


@router.delete("/inventory/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_inventory_item(
    item_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    item = db.get(RoomInventoryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Позиция оснащения не найдена")
    details = {"room_id": item.room_id, "item_id": item.id, "name": item.name}
    db.delete(item)
    db.commit()
    audit_event("admin.rooms.inventory.delete", actor=context.get("username"), details=details, db=db)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    # Удаление кабинета стёрло бы и настройку его камеры
    if context.get("role") != ROLE_SUPERADMIN and (room.camera_enabled or room.camera_stream_url or room.camera_api_url):
        raise HTTPException(status_code=403, detail="Кабинет с настроенной камерой удаляет только суперадминистратор")
    name = room.name
    db.delete(room)
    db.commit()
    audit_event("admin.rooms.delete", actor=context.get("username"), details={"room_id": room_id, "name": name}, db=db)


@router.post("/{room_id}/camera/test", response_model=CameraTestOut)
def test_room_camera(
    room_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    target = (room.camera_api_url or "").strip()
    parsed = urlparse(target)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return CameraTestOut(success=False, message="Для проверки укажите HTTP(S) API URL камеры")

    headers = {"Accept": "application/json, image/jpeg, */*"}
    api_key = _decrypt_secret(room.camera_api_key_encrypted)
    if api_key and not room.camera_username:
        headers["Authorization"] = f"Bearer {api_key}"
        headers["X-API-Key"] = api_key

    try:
        request = UrlRequest(target, headers=headers, method="GET")
        if room.camera_username and api_key:
            password_manager = HTTPPasswordMgrWithDefaultRealm()
            password_manager.add_password(None, target, room.camera_username, api_key)
            opener = build_opener(
                HTTPDigestAuthHandler(password_manager),
                HTTPBasicAuthHandler(password_manager),
            )
            response_context = opener.open(request, timeout=5)
        else:
            response_context = urlopen(request, timeout=5)
        with response_context as response:
            status_code = int(response.status)
        success = 200 <= status_code < 400
        message = "Камера доступна" if success else "API камеры вернул ошибку"
    except HTTPError as exc:
        status_code = exc.code
        success = False
        message = f"API камеры вернул HTTP {exc.code}"
    except (URLError, TimeoutError, OSError):
        status_code = None
        success = False
        message = "Не удалось подключиться к API камеры"

    audit_event(
        "admin.rooms.camera.test",
        outcome="success" if success else "failure",
        actor=context.get("username"),
        details={"room_id": room.id, "host": parsed.hostname, "status_code": status_code},
        db=db,
    )
    return CameraTestOut(success=success, message=message, status_code=status_code)


@router.get("/{room_id}/camera/live")
async def get_room_camera_live(
    room_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    _ensure_dean_room(db, context, room)
    if not room.camera_enabled or not room.camera_stream_url:
        raise HTTPException(status_code=400, detail="Камера для кабинета не настроена")

    # Завершившиеся ffmpeg не считаем
    _live_streams.difference_update({p for p in _live_streams if p.returncode is not None})
    max_streams = get_live_max_streams(db)
    if len(_live_streams) >= max_streams:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Одновременно доступно не больше {max_streams} трансляций. Закройте другие и повторите.",
        )

    stream_url = _authenticated_stream_url(room)
    try:
        process = await asyncio.create_subprocess_exec(
            "ffmpeg",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", stream_url,
            "-an",
            "-vf", "fps=8,scale=1280:-2",
            "-q:v", "5",
            "-f", "mpjpeg",
            "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Сервис трансляции недоступен") from exc
    _live_streams.add(process)

    async def generate():
        # Генератор асинхронный: когда браузер закрывает поток (переключение кабинета, уход
        # со страницы), Starlette отменяет его, и ffmpeg останавливается сразу, а не висит.
        try:
            while True:
                chunk = await process.stdout.read(64 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            _live_streams.discard(process)
            if process.returncode is None:
                process.terminate()
                # Ожидание вне отменённой задачи, чтобы гарантированно добить процесс
                asyncio.get_running_loop().create_task(_stop_ffmpeg(process))

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=ffmpeg",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate",
            "Pragma": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{room_id}/camera/photo", response_model=CameraEvidenceOut)
def capture_room_camera_photo(
    room_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    room = db.get(Room, room_id)
    if not room or not room.camera_enabled:
        raise HTTPException(status_code=404, detail="Камера кабинета не найдена")
    _ensure_dean_room(db, context, room)
    filename = f"{uuid.uuid4().hex}.jpg"
    path = os.path.join(_media_root(), filename)
    result = subprocess.run(
        [
            # Кадр до первого опорного (HEVC регистратора) декодируется серым — берём опорный
            "ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp", "-skip_frame", "nokey",
            "-i", _authenticated_stream_url(room),
            "-frames:v", "1", "-q:v", "2", "-y", path,
        ],
        capture_output=True,
        timeout=15,
        check=False,
    )
    if result.returncode != 0 or not os.path.isfile(path):
        raise HTTPException(status_code=502, detail="Не удалось сделать снимок")
    return _save_evidence_row(db, room, "photo", filename, context.get("username") or "unknown")


@router.post("/{room_id}/camera/video", response_model=CameraEvidenceOut)
def record_room_camera_video(
    room_id: int,
    duration: int = 10,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_DEAN)),
):
    room = db.get(Room, room_id)
    if not room or not room.camera_enabled:
        raise HTTPException(status_code=404, detail="Камера кабинета не найдена")
    _ensure_dean_room(db, context, room)
    safe_duration = max(5, min(int(duration), 30))
    filename = f"{uuid.uuid4().hex}.mp4"
    path = os.path.join(_media_root(), filename)
    # Сначала поток копируется как есть: при копировании ffmpeg начинает с опорного кадра (иначе начало
    # видео серое), затем перекодируется в H.264 — HEVC регистратора браузеры не воспроизводят
    raw_path = f"{path}.raw.mkv"
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp",
                "-i", _authenticated_stream_url(room),
                "-t", str(safe_duration), "-an", "-c:v", "copy", "-y", raw_path,
            ],
            capture_output=True,
            timeout=safe_duration + 15,
            check=False,
        )
        if result.returncode == 0 and os.path.isfile(raw_path):
            result = subprocess.run(
                [
                    "ffmpeg", "-loglevel", "error", "-i", raw_path,
                    # 1280 по ширине достаточно для доказательства; полное разрешение камеры — ~1 МБ/с
                    "-vf", "scale='min(1280,iw)':-2",
                    "-c:v", "libx264", "-preset", "ultrafast",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                    "-y", path,
                ],
                capture_output=True,
                timeout=safe_duration * 3 + 15,
                check=False,
            )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Запись камеры не завершилась вовремя") from exc
    finally:
        if os.path.exists(raw_path):
            os.remove(raw_path)
    if result.returncode != 0 or not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise HTTPException(status_code=502, detail="Не удалось записать видео")
    return _save_evidence_row(db, room, "video", filename, context.get("username") or "unknown")
