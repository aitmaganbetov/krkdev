from sqlalchemy import Column, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from database import Base


class RoomInventoryItem(Base):
    """Позиция оснащения кабинета (инвентаризация): количество × цена за единицу = стоимость позиции."""
    __tablename__ = "room_inventory_items"
    # Оснащение из Platonus (auditory_equipments) импортируется по одной позиции на тип в кабинете
    __table_args__ = (UniqueConstraint("room_id", "platonus_equipment_id", name="uq_room_inventory_platonus"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    room_id = Column(Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    category = Column(String(100), nullable=False, default="")
    inventory_number = Column(String(100), nullable=False, default="")
    quantity = Column(Integer, nullable=False, default=1)
    unit_price = Column(Numeric(14, 2), nullable=False, default=0)  # тенге
    condition = Column(String(20), nullable=False, default="good")  # good | repair | written_off
    acquired_year = Column(Integer, nullable=True)
    notes = Column(Text, nullable=False, default="")
    platonus_equipment_id = Column(Integer, nullable=True)
    updated_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
