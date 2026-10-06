import asyncio
import base64
import hashlib
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

from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from models.room import Room
from models.violation_evidence import ViolationEvidence
from services import ROLE_ADMIN, ROLE_INSPECTOR, require_roles
from services.audit_log import audit_event

router = APIRouter(prefix="/rooms", tags=["rooms"])

# Каждая трансляция — отдельный ffmpeg с перекодированием; на 2 ядрах больше трёх сервер не тянет.
CAMERA_LIVE_MAX_STREAMS = int(os.getenv("CAMERA_LIVE_MAX_STREAMS", "3") or 3)
_live_streams: set[asyncio.subprocess.Process] = set()


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
    equipment: str
    notes: str
    camera_enabled: bool
    camera_api_url: str
    camera_stream_url: str
    camera_username: str
    camera_api_key_configured: bool


class CameraTestOut(BaseModel):
    success: bool
    message: str
    status_code: int | None = None


class CameraEvidenceOut(BaseModel):
    id: int
    media_type: str
    url: str


def _fernet() -> Fernet:
    secret = os.getenv("SECRET_KEY", "").encode("utf-8")
    if not secret:
        raise RuntimeError("SECRET_KEY is required")
    key = base64.urlsafe_b64encode(hashlib.sha256(secret).digest())
    return Fernet(key)


def _encrypt_secret(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii") if value else ""


def _decrypt_secret(value: str) -> str:
    if not value:
        return ""
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except InvalidToken:
        return ""


def _serialize(room: Room) -> RoomOut:
    return RoomOut(
        id=room.id,
        name=room.name,
        building=room.building or "",
        floor=room.floor or "",
        capacity=room.capacity or 0,
        equipment=room.equipment or "",
        notes=room.notes or "",
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


@router.get("", response_model=list[RoomOut])
def list_rooms(
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    return [_serialize(room) for room in db.query(Room).order_by(Room.building, Room.name).all()]


@router.post("", response_model=RoomOut, status_code=status.HTTP_201_CREATED)
def create_room(
    body: RoomIn,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = Room(**body.model_dump(exclude={"camera_api_key"}))
    room.name = body.name.strip()
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
    for key, value in body.model_dump(exclude={"camera_api_key"}).items():
        setattr(room, key, value)
    room.name = body.name.strip()
    if body.camera_api_key:
        room.camera_api_key_encrypted = _encrypt_secret(body.camera_api_key)
    try:
        db.commit()
        db.refresh(room)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Кабинет с таким названием уже существует") from exc
    audit_event("admin.rooms.update", actor=context.get("username"), details={"room_id": room.id, "name": room.name}, db=db)
    return _serialize(room)


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_room(
    room_id: int,
    db: Session = Depends(get_db),
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
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


@router.get("/{room_id}/camera/snapshot")
def get_room_camera_snapshot(
    room_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    if not room.camera_enabled or not room.camera_stream_url:
        raise HTTPException(status_code=400, detail="Камера для кабинета не настроена")

    parsed = urlparse(room.camera_stream_url)
    if parsed.scheme not in {"rtsp", "rtsps"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Укажите корректный RTSP URL камеры")

    secret = _decrypt_secret(room.camera_api_key_encrypted)

    snapshot_urls = []
    if room.camera_api_url and urlparse(room.camera_api_url).scheme in {"http", "https"}:
        snapshot_urls.append(room.camera_api_url)
    camera_host = parsed.hostname
    if camera_host:
        snapshot_urls.append(f"http://{camera_host}/images/snapshot.jpg")

    for snapshot_url in dict.fromkeys(snapshot_urls):
        try:
            request = UrlRequest(snapshot_url, headers={"Accept": "image/jpeg, */*"}, method="GET")
            if room.camera_username and secret:
                password_manager = HTTPPasswordMgrWithDefaultRealm()
                password_manager.add_password(None, snapshot_url, room.camera_username, secret)
                opener = build_opener(
                    HTTPDigestAuthHandler(password_manager),
                    HTTPBasicAuthHandler(password_manager),
                )
                response_context = opener.open(request, timeout=5)
            else:
                response_context = urlopen(request, timeout=5)
            with response_context as camera_response:
                image_data = camera_response.read(10 * 1024 * 1024)
                content_type = camera_response.headers.get_content_type()
            if image_data and (content_type.startswith("image/") or image_data.startswith(b"\xff\xd8")):
                return Response(
                    content=image_data,
                    media_type="image/jpeg",
                    headers={"Cache-Control": "no-store, max-age=0"},
                )
        except (HTTPError, URLError, TimeoutError, OSError):
            pass

    stream_url = _authenticated_stream_url(room)

    try:
        result = subprocess.run(
            [
                "ffmpeg",
                "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", stream_url,
                "-frames:v", "1",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "pipe:1",
            ],
            capture_output=True,
            timeout=10,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        raise HTTPException(status_code=504, detail="Камера не ответила вовремя") from exc

    if result.returncode != 0 or not result.stdout:
        raise HTTPException(status_code=502, detail="Не удалось получить изображение с камеры")

    return Response(
        content=result.stdout,
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@router.get("/{room_id}/camera/live")
async def get_room_camera_live(
    room_id: int,
    db: Session = Depends(get_db),
    _: dict[str, str] = Depends(require_roles(ROLE_ADMIN)),
):
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail="Кабинет не найден")
    if not room.camera_enabled or not room.camera_stream_url:
        raise HTTPException(status_code=400, detail="Камера для кабинета не настроена")

    # Завершившиеся ffmpeg не считаем
    _live_streams.difference_update({p for p in _live_streams if p.returncode is not None})
    if len(_live_streams) >= CAMERA_LIVE_MAX_STREAMS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Одновременно доступно не больше {CAMERA_LIVE_MAX_STREAMS} трансляций. Закройте другие и повторите.",
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
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    room = db.get(Room, room_id)
    if not room or not room.camera_enabled:
        raise HTTPException(status_code=404, detail="Камера кабинета не найдена")
    filename = f"{uuid.uuid4().hex}.jpg"
    path = os.path.join(_media_root(), filename)
    result = subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp",
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
    context: dict[str, str] = Depends(require_roles(ROLE_ADMIN, ROLE_INSPECTOR)),
):
    room = db.get(Room, room_id)
    if not room or not room.camera_enabled:
        raise HTTPException(status_code=404, detail="Камера кабинета не найдена")
    safe_duration = max(5, min(int(duration), 30))
    filename = f"{uuid.uuid4().hex}.mp4"
    path = os.path.join(_media_root(), filename)
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-loglevel", "error", "-rtsp_transport", "tcp",
                "-i", _authenticated_stream_url(room),
                "-t", str(safe_duration), "-an",
                "-c:v", "libx264", "-preset", "ultrafast",
                "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                "-y", path,
            ],
            capture_output=True,
            timeout=safe_duration + 15,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail="Запись камеры не завершилась вовремя") from exc
    if result.returncode != 0 or not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise HTTPException(status_code=502, detail="Не удалось записать видео")
    return _save_evidence_row(db, room, "video", filename, context.get("username") or "unknown")
