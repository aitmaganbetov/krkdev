from database import Base
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.sql import func


class PeerVisitSchedule(Base):
    """Строка графика взаимопосещения: кто (visitor) посещает занятие кого (visited) и в каком месяце.

    Выполнение не хранится, а считается по отзывам (peer_visits.schedule_id): строка выполнена,
    когда привязанный к ней отзыв принят.
    """

    __tablename__ = "peer_visit_schedule"

    id = Column(Integer, primary_key=True, autoincrement=True)
    academic_year = Column(String(20), nullable=False, index=True)
    # Академический период: 1 — осенний, 2 — весенний
    period = Column(Integer, nullable=False, default=1)
    # faculties.FacultyID (справочник Platonus)
    faculty_id = Column(Integer, nullable=False, index=True)
    cafedra_id = Column(Integer, nullable=True, index=True)
    cafedra_name = Column(String(255), nullable=False, default="")

    # Преподаватели — из справочника Platonus (tutors); ФИО и должность — как в графике
    visited_tutor_id = Column(Integer, nullable=True, index=True)
    visited_name = Column(String(255), nullable=False)
    visited_login = Column(String(255), nullable=True, index=True)
    visited_position = Column(String(255), nullable=True)
    visitor_tutor_id = Column(Integer, nullable=True, index=True)
    visitor_name = Column(String(255), nullable=False)
    visitor_login = Column(String(255), nullable=True, index=True)
    visitor_position = Column(String(255), nullable=True)

    # Плановый месяц посещения (1–12)
    month = Column(Integer, nullable=False)
    note = Column(Text, nullable=True)

    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, server_default=func.now(), nullable=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)
