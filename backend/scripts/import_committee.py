"""Импорт приказа о составе комитета ректорского контроля из JSON (перенос бумажного приказа в систему).

Запуск в контейнере бэкенда:
    python scripts/import_committee.py data/krk_committee_2026-2027.json [скан.pdf]

Перед импортом синхронизируйте справочники Platonus: по ним ФИО из приказа сопоставляются с преподавателями.
Импортированный приказ становится действующим, члены состава получают роль «Член комитета КРК».
Несопоставленных членов привяжите к преподавателям в разделе «Комитет КРК».
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import SessionLocal  # noqa: E402
from services import committee_service  # noqa: E402


def main(path: str, pdf_path: str | None) -> None:
    with open(path, encoding="utf-8") as source:
        data = json.load(source)
    db = SessionLocal()
    try:
        order, unmatched = committee_service.import_order(db, data, created_by="import")
        if pdf_path:
            with open(pdf_path, "rb") as scan:
                committee_service.save_file(db, order, scan.read())
        print(f"Приказ № {order.number}: членов {len(data['members'])}, не сопоставлено {len(unmatched)}")
        for name in unmatched:
            print(f"  не найден в справочнике: {name}")
    finally:
        db.close()


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("usage: python scripts/import_committee.py <file.json> [scan.pdf]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
