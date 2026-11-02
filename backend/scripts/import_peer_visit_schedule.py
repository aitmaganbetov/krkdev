"""Импорт графика взаимопосещения из JSON (перенос бумажного графика в систему).

Запуск в контейнере бэкенда:
    python scripts/import_peer_visit_schedule.py data/peer_visit_schedule_2026-2027_p1.json

Перед импортом синхронизируйте справочники Platonus (кафедры и преподаватели с логинами):
по ним ФИО из графика сопоставляются с учётными записями. Повторный запуск заменяет строки
факультета за тот же год и период, по которым ещё нет отзывов.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from services.peer_visit_schedule_service import import_rows  # noqa: E402


def main(path: str) -> None:
    with open(path, encoding="utf-8") as source:
        data = json.load(source)
    db = SessionLocal()
    try:
        for faculty in data["faculties"]:
            result = import_rows(
                db, faculty["rows"],
                academic_year=data["academic_year"], period=int(data.get("period", 1)),
                faculty_id=int(faculty["faculty_id"]), created_by="import",
            )
            print(f"{faculty.get('code', faculty['faculty_id'])}: {result}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python scripts/import_peer_visit_schedule.py <file.json>")
    main(sys.argv[1])
