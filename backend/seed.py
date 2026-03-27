"""
Seed script — populates the database with mock records for development.
Run once: python seed.py
"""
from datetime import datetime
import random
from database import SessionLocal, engine, Base
import models  # noqa: F401
from models.record import Record

Base.metadata.create_all(bind=engine)

TEACHERS = [
    "Иваненко О.М.", "Петренко В.С.", "Сидоренко Л.А.",
    "Коваленко Р.П.", "Мельник Т.И.",
]
SUBJECTS = [
    "Математический анализ", "Линейная алгебра", "Программирование",
    "Базы данных", "Сетевые технологии",
]
FACULTIES = ["ФТИ", "ФЭМ", "ФИОТ"]
OPS = ["122 Компьютерные науки", "121 Инженерия ПО", "126 ИСТ"]
GROUPS = ["КН-11", "КН-12", "ИС-21", "ИС-22", "ПО-31"]
ROOMS = ["401", "402", "501", "502", "Онлайн"]
LESSON_TYPES = ["Лекция", "Практика", "Лабораторная"]
FORMATS = ["Очная", "Дистанционная", "Смешанная"]
STATUSES = ["draft", "submitted", "approved"]
RATING_KEYS = [
    *[f"1.{c}" for c in range(1, 8)],
    *[f"2.{c}" for c in range(1, 7)],
    *[f"3.{c}" for c in range(1, 5)],
]


def random_ratings() -> dict:
    return {k: random.randint(4, 10) for k in RATING_KEYS}


def compute_score(ratings: dict) -> float:
    return round(sum(ratings.values()) / len(ratings), 2)


def compute_attendance(plan: int, fact: int) -> float:
    return round((fact / plan) * 100, 1) if plan else 0.0


def seed():
    db = SessionLocal()
    try:
        if db.query(Record).count() > 0:
            print("Database already seeded, skipping.")
            return

        records = []
        for i in range(30):
            plan = random.randint(20, 30)
            fact = random.randint(10, plan)
            ratings = random_ratings()
            score = compute_score(ratings)
            dt = datetime(2025, random.randint(9, 12), random.randint(1, 28),
                          random.choice([8, 10, 12, 14, 16]), 0)
            records.append(Record(
                teacher=random.choice(TEACHERS),
                subject=random.choice(SUBJECTS),
                faculty=random.choice(FACULTIES),
                op=random.choice(OPS),
                group_name=random.choice(GROUPS),
                room=random.choice(ROOMS),
                lesson_type=random.choice(LESSON_TYPES),
                format=random.choice(FORMATS),
                topic=f"Тема занятия {i + 1}",
                datetime=dt,
                students_plan=plan,
                students_fact=fact,
                attendance=compute_attendance(plan, fact),
                academic_year="2025/2026",
                ratings=ratings,
                score=score,
                status=random.choice(STATUSES),
                comment="Комментарий к занятию" if random.random() > 0.6 else None,
                submitted_by="admin",
            ))

        db.add_all(records)
        db.commit()
        print(f"Seeded {len(records)} records.")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
