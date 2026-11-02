"""Кабинеты из Platonus: стартовая миграция таблицы rooms и импорт аудиторий.

Импорт обновляет только паспорт кабинета (номер, корпус, вместимость, тип). Настройки камеры,
оснащение и примечание ведутся в системе и при повторном импорте не затираются.
"""
import re
import secrets
from decimal import Decimal
from typing import Dict, Optional

import pymysql
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from migrations import get_remote_config
from models.room import Room
from models.room_inventory import RoomInventoryItem

_NAME_MAX, _BUILDING_MAX, _TYPE_MAX = 100, 150, 255


def ensure_room_schema(engine) -> None:
    """rooms.platonus_auditory_id и rooms.room_type; снять уникальность имени кабинета."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        if "rooms" not in inspector.get_table_names():
            return
        columns = {c["name"] for c in inspector.get_columns("rooms")}
        if "platonus_auditory_id" not in columns:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN platonus_auditory_id INT NULL"))
        if "room_type" not in columns:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN room_type VARCHAR(255) NOT NULL DEFAULT ''"))
        indexes = inspector.get_indexes("rooms")
        for ix in indexes:
            if ix["column_names"] == ["name"] and ix.get("unique"):
                conn.execute(text(f"ALTER TABLE rooms DROP INDEX `{ix['name']}`, ADD INDEX `{ix['name']}` (name)"))
        unique_cols = [ix["column_names"] for ix in indexes if ix.get("unique")]
        unique_cols += [uc["column_names"] for uc in inspector.get_unique_constraints("rooms")]
        if ["platonus_auditory_id"] not in unique_cols:
            conn.execute(text("ALTER TABLE rooms ADD UNIQUE KEY uq_rooms_platonus_auditory (platonus_auditory_id)"))
        if "area" not in columns:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN area DECIMAL(10,2) NOT NULL DEFAULT 0"))
        if "qr_code" not in columns:
            conn.execute(text("ALTER TABLE rooms ADD COLUMN qr_code VARCHAR(32) NULL, ADD UNIQUE KEY uq_rooms_qr_code (qr_code)"))
        # QR-код есть у каждого кабинета, в том числе созданного вручную или импортом
        for (room_id,) in conn.execute(text("SELECT id FROM rooms WHERE qr_code IS NULL")).all():
            conn.execute(text("UPDATE rooms SET qr_code = :code WHERE id = :id"), {"code": new_qr_code(), "id": room_id})


def new_qr_code() -> str:
    return secrets.token_urlsafe(9)


def _clean(value: Optional[str], limit: int) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()[:limit]


def building_key(value: Optional[str]) -> str:
    """«3», «3 », «3 блок» → «блок 3»: так вручную заведённые кабинеты находят пару в Platonus."""
    folded = re.sub(r"[\"'«»]", "", (value or "").lower())
    folded = re.sub(r"\s+", " ", folded).strip()
    match = re.fullmatch(r"(\d+)(?: ?блок)?", folded)
    return f"блок {match.group(1)}" if match else folded


def floor_from_name(name: str) -> str:
    """Этаж — первая цифра трёхзначного номера (305, 402а); для других форматов не угадываем."""
    match = re.fullmatch(r"(\d)\d{2}\D?", name)
    return match.group(1) if match else ""


def _fetch_auditories() -> tuple[list[dict], list[dict]]:
    conn = pymysql.connect(
        **get_remote_config(),
        connect_timeout=5,
        read_timeout=30,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cursor:
            # Действующие аудитории: не закрыты и не заблокированы
            cursor.execute("""
                SELECT a.auditoryID, a.auditoryName, a.capacity, a.area, b.buildingName, t.name AS typeName
                FROM auditories a
                LEFT JOIN buildings b ON b.buildingID = a.buildingID
                LEFT JOIN auditorytypes t ON t.typeID = a.auditoryType
                WHERE COALESCE(a.closed, 0) = 0 AND COALESCE(a.blocked, 0) = 0
                ORDER BY a.auditoryID
            """)
            auditories = cursor.fetchall()
            # Оснащение аудиторий: в Platonus только перечень типов, без количества и цены
            cursor.execute("""
                SELECT ae.auditoryID, e.id AS equipmentID, e.nameru
                FROM auditory_equipments ae
                JOIN equipments e ON e.id = ae.equipmentID
            """)
            return auditories, cursor.fetchall()
    finally:
        conn.close()


def sync_rooms_from_platonus(db: Session) -> Dict:
    try:
        remote_rows, equipment_rows = _fetch_auditories()
    except Exception as exc:
        return {"status": "error", "message": f"Не удалось получить аудитории Platonus: {type(exc).__name__}: {exc}"}

    auditories = {}
    for row in remote_rows:
        name = _clean(row["auditoryName"], _NAME_MAX)
        if not name:
            continue
        auditories[row["auditoryID"]] = {
            "name": name,
            "building": _clean(row["buildingName"], _BUILDING_MAX),
            "capacity": max(int(row["capacity"] or 0), 0),
            # Decimal с двумя знаками: так же хранится в rooms.area, сравнение не даёт ложных «обновлений»
            "area": Decimal(str(round(max(float(row["area"] or 0), 0), 2))),
            "room_type": _clean(row["typeName"], _TYPE_MAX),
        }

    rooms = db.query(Room).all()
    by_auditory = {room.platonus_auditory_id: room for room in rooms if room.platonus_auditory_id}

    # Вручную заведённые кабинеты привязываются, только если пара однозначна с обеих сторон
    def key(name, building):
        return (name.lower(), building_key(building))

    remote_by_key: dict = {}
    for auditory_id, item in auditories.items():
        if auditory_id not in by_auditory:
            remote_by_key.setdefault(key(item["name"], item["building"]), []).append(auditory_id)
    manual_by_key: dict = {}
    for room in rooms:
        if not room.platonus_auditory_id:
            manual_by_key.setdefault(key(room.name or "", room.building), []).append(room)
    linked = 0
    for room_key, local in manual_by_key.items():
        remote = remote_by_key.get(room_key, [])
        if len(local) == 1 and len(remote) == 1:
            local[0].platonus_auditory_id = remote[0]
            by_auditory[remote[0]] = local[0]
            linked += 1

    created = updated = 0
    for auditory_id, item in auditories.items():
        room = by_auditory.get(auditory_id)
        if room is None:
            db.add(Room(
                platonus_auditory_id=auditory_id,
                qr_code=new_qr_code(),
                floor=floor_from_name(item["name"]),
                equipment="",
                notes="",
                **item,
            ))
            created += 1
            continue
        if not item["capacity"]:
            # В Platonus вместимость часто не заполнена — не затираем указанную вручную
            item = {**item, "capacity": room.capacity or 0}
        if not item["area"]:
            # Площадь — так же: пустое значение Platonus не стирает введённую вручную
            item = {**item, "area": room.area or Decimal("0")}
        changed = any(getattr(room, field) != value for field, value in item.items())
        for field, value in item.items():
            setattr(room, field, value)
        if not room.floor:
            room.floor = floor_from_name(item["name"])
        updated += int(changed)

    # Кабинеты, исчезнувшие из Platonus, не удаляются: у них могут быть настройки камер и доказательства
    missing = sorted(
        f"{room.name} ({room.building})" if room.building else room.name
        for auditory_id, room in by_auditory.items() if auditory_id not in auditories
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        return {"status": "error", "message": f"Не удалось сохранить кабинеты: {type(exc).__name__}: {exc}"}

    try:
        equipment_added = _sync_equipment(db, equipment_rows)
    except Exception as exc:
        db.rollback()
        return {"status": "error", "message": f"Кабинеты сохранены, но не удалось импортировать оснащение: {type(exc).__name__}: {exc}"}

    return {
        "status": "success",
        "message": "Кабинеты Platonus импортированы",
        "total": len(auditories),
        "created": created,
        "updated": updated,
        "linked": linked,
        "missing": missing,
        "equipment_added": equipment_added,
    }


def _sync_equipment(db: Session, equipment_rows: list[dict]) -> int:
    """Добавляет позиции оснащения из Platonus, которых ещё нет у кабинета (количество 1, цена 0).
    Уже заведённые позиции не меняются: количество, цену и инвентарный номер ведут вручную."""
    room_by_auditory = {
        room.platonus_auditory_id: room.id
        for room in db.query(Room).filter(Room.platonus_auditory_id.isnot(None)).all()
    }
    existing = {
        (room_id, equipment_id)
        for room_id, equipment_id in db.query(RoomInventoryItem.room_id, RoomInventoryItem.platonus_equipment_id)
        .filter(RoomInventoryItem.platonus_equipment_id.isnot(None)).all()
    }
    added = 0
    for row in equipment_rows:
        room_id = room_by_auditory.get(row["auditoryID"])
        name = _clean(row["nameru"], 255)
        key = (room_id, row["equipmentID"])
        if room_id is None or not name or key in existing:
            continue
        db.add(RoomInventoryItem(
            room_id=room_id, name=name[:1].upper() + name[1:], platonus_equipment_id=row["equipmentID"],
            quantity=1, unit_price=0, condition="good", category="", inventory_number="", notes="",
        ))
        existing.add(key)
        added += 1
    db.commit()
    return added
