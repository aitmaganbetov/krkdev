"""График взаимопосещения: строки графика, сопоставление ФИО со справочником Platonus,
расчёт выполнения по отзывам.

Статус строки (не хранится, считается):
  done        — привязанный отзыв принят (late=True, если посещение не в плановом месяце);
  in_progress — отзыв есть, но ещё не принят (черновик, отправлен, на доработке);
  overdue     — отзыва нет, а плановый месяц закончился;
  planned     — отзыва нет, срок ещё не прошёл.
"""
import calendar
import re
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session

from models.peer_visit import PeerVisit
from models.peer_visit_schedule import PeerVisitSchedule
from services.notification_service import login_aliases, normalize_login

STATUSES = ("done", "in_progress", "overdue", "planned")
MONTHS_RU = {
    "январь": 1, "февраль": 2, "март": 3, "апрель": 4, "май": 5, "июнь": 6,
    "июль": 7, "август": 8, "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
}
UTC_PLUS_5 = timedelta(hours=5)

# Казахские буквы → русские: в Platonus ФИО часто записаны без них («Ғалымжан» / «Галымжан»)
_FOLD = str.maketrans("әғқңөұүһіё", "агкноуухие")


def ensure_schedule_schema(engine) -> None:
    """Стартовая миграция: peer_visits.schedule_id (таблицу графика создаёт create_all)."""
    with engine.begin() as conn:
        inspector = inspect(conn)
        if "peer_visits" in inspector.get_table_names():
            columns = {c["name"] for c in inspector.get_columns("peer_visits")}
            if "schedule_id" not in columns:
                conn.execute(text("ALTER TABLE peer_visits ADD COLUMN schedule_id INT NULL"))
            # Не больше одного отзыва на строку графика (NULL — отзыв без графика — не ограничен)
            unique = {ix["name"] for ix in inspector.get_indexes("peer_visits") if ix.get("unique")}
            if "uq_peer_visits_schedule" not in unique:
                for ix in inspector.get_indexes("peer_visits"):
                    if ix["column_names"] == ["schedule_id"] and not ix.get("unique"):
                        conn.execute(text(f"ALTER TABLE peer_visits DROP INDEX `{ix['name']}`"))
                conn.execute(text("ALTER TABLE peer_visits ADD UNIQUE KEY uq_peer_visits_schedule (schedule_id)"))


def fold_name(value: Optional[str]) -> str:
    cleaned = re.sub(r"[^\w\s]", " ", (value or "").lower().translate(_FOLD))
    return re.sub(r"\s+", " ", cleaned).strip()


class TutorMatcher:
    """Сопоставление ФИО из графика с tutors: полное ФИО → фамилия+имя → фамилия+инициалы.
    При нескольких кандидатах предпочитается преподаватель того же факультета; иначе — не сопоставлено."""

    def __init__(self, db: Session):
        rows = db.execute(text("""
            SELECT t.tutor_id, t.full_name, t.login, t.cafedra_id, c.FacultyID AS faculty_id
            FROM tutors t LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
        """)).mappings().all()
        self.by_id = {row["tutor_id"]: dict(row) for row in rows}
        self.full, self.two, self.initials = {}, {}, {}
        for row in rows:
            words = fold_name(row["full_name"]).split()
            if not words:
                continue
            self.full.setdefault(" ".join(words), []).append(row["tutor_id"])
            if len(words) >= 2:
                self.two.setdefault(" ".join(words[:2]), []).append(row["tutor_id"])
                self.initials.setdefault(words[0] + " " + "".join(w[0] for w in words[1:3]), []).append(row["tutor_id"])

    def _pick(self, ids: list[int], faculty_id: Optional[int]) -> Optional[int]:
        unique = list(dict.fromkeys(ids))
        if len(unique) == 1:
            return unique[0]
        same_faculty = [i for i in unique if self.by_id[i]["faculty_id"] == faculty_id]
        return same_faculty[0] if len(same_faculty) == 1 else None

    def match(self, name: str, faculty_id: Optional[int] = None) -> Optional[dict]:
        words = fold_name(name).split()
        if not words:
            return None
        if len(words) >= 2 and all(len(w) == 1 for w in words[1:]):
            # «Зейнуллин А.А.» — фамилия и инициалы
            candidates = [self.initials.get(words[0] + " " + "".join(words[1:3]), [])]
        else:
            candidates = [self.full.get(" ".join(words), []), self.two.get(" ".join(words[:2]), [])]
        for ids in candidates:
            tutor_id = self._pick(ids, faculty_id) if ids else None
            if tutor_id:
                return self.by_id[tutor_id]
        return None


def tutor_by_id(db: Session, tutor_id: int) -> dict:
    row = db.execute(text("SELECT tutor_id, full_name, login, cafedra_id FROM tutors WHERE tutor_id = :id"),
                     {"id": tutor_id}).mappings().first()
    if not row:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Преподаватель не найден в справочнике")
    return dict(row)


# Латинские буквы-двойники в названиях из Platonus («Cоциально…» с латинской C)
_LATIN_LOOKALIKES = str.maketrans("aceopxykmthb", "асеорхукмтнв")
# Сокращения в бумажных графиках → название кафедры в Platonus
_CAFEDRA_ALIASES = {"it": "информационные технологии", "ит": "информационные технологии"}


def _cafedra_stems(name: str) -> set[str]:
    folded = fold_name(name)
    folded = _CAFEDRA_ALIASES.get(folded, folded).translate(_LATIN_LOOKALIKES)
    # Основы слов: «Химический инжиниринг» и «Химического инжиниринга» совпадают
    return {word[:5] for word in folded.split() if len(word) > 2}


def find_cafedra_id(db: Session, faculty_id: int, name: str) -> Optional[int]:
    """Кафедра факультета по названию из графика: наибольшее совпадение основ слов (не меньше половины)."""
    target = _cafedra_stems(name)
    if not target:
        return None
    rows = db.execute(text("SELECT cafedraID, cafedraNameRU FROM cafedras WHERE FacultyID = :f"), {"f": faculty_id}).all()
    best_id, best_score = None, 0.0
    for cafedra_id, cafedra_name in rows:
        stems = _cafedra_stems(cafedra_name)
        score = len(target & stems) / len(target | stems) if stems else 0.0
        if score > best_score:
            best_id, best_score = cafedra_id, score
    return best_id if best_score >= 0.5 else None


def month_deadline(academic_year: str, month: int) -> date:
    """Последний день планового месяца: сентябрь–декабрь — первый год, январь–август — второй."""
    try:
        first_year = int(academic_year.split("-")[0])
    except (ValueError, IndexError):
        first_year = date.today().year
    year = first_year if month >= 9 else first_year + 1
    return date(year, month, calendar.monthrange(year, month)[1])


def _local_month(value: datetime) -> int:
    return (value + UTC_PLUS_5).month


def _visits_by_schedule(db: Session, schedule_ids: list[int]) -> dict[int, PeerVisit]:
    """Отзыв для каждой строки: принятый, иначе последний."""
    if not schedule_ids:
        return {}
    result: dict[int, PeerVisit] = {}
    visits = db.query(PeerVisit).filter(PeerVisit.schedule_id.in_(schedule_ids)).order_by(PeerVisit.id.asc()).all()
    for visit in visits:
        current = result.get(visit.schedule_id)
        if current is None or current.status != "accepted":
            result[visit.schedule_id] = visit
    return result


def serialize(row: PeerVisitSchedule, visit: Optional[PeerVisit], today: Optional[date] = None) -> dict:
    today = today or date.today()
    if visit is not None and visit.status == "accepted":
        state = "done"
    elif visit is not None:
        state = "in_progress"
    elif month_deadline(row.academic_year, row.month) < today:
        state = "overdue"
    else:
        state = "planned"
    return {
        "id": row.id,
        "academic_year": row.academic_year,
        "period": row.period,
        "faculty_id": row.faculty_id,
        "cafedra_id": row.cafedra_id,
        "cafedra_name": row.cafedra_name,
        "visited_tutor_id": row.visited_tutor_id,
        "visited_name": row.visited_name,
        "visited_position": row.visited_position,
        "visitor_tutor_id": row.visitor_tutor_id,
        "visitor_name": row.visitor_name,
        "visitor_position": row.visitor_position,
        "visitor_login": row.visitor_login,
        "month": row.month,
        "note": row.note,
        "status": state,
        "late": bool(state == "done" and _local_month(visit.datetime) != row.month),
        "review_id": visit.id if visit else None,
        "review_status": visit.status if visit else None,
        "review_date": visit.datetime if visit else None,
        "matched": bool(row.visited_tutor_id and row.visitor_tutor_id),
    }


def _apply_filters(query, *, academic_year=None, period=None, faculty_id=None, cafedra_id=None, month=None, search=None):
    if academic_year:
        query = query.filter(PeerVisitSchedule.academic_year == academic_year)
    if period:
        query = query.filter(PeerVisitSchedule.period == period)
    if faculty_id:
        query = query.filter(PeerVisitSchedule.faculty_id == faculty_id)
    if cafedra_id:
        query = query.filter(PeerVisitSchedule.cafedra_id == cafedra_id)
    if month:
        query = query.filter(PeerVisitSchedule.month == month)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(PeerVisitSchedule.visited_name.ilike(pattern) | PeerVisitSchedule.visitor_name.ilike(pattern))
    return query


def list_rows(db: Session, *, status_filter: Optional[str] = None, unmatched_only: bool = False, **filters) -> list[dict]:
    rows = _apply_filters(db.query(PeerVisitSchedule), **filters).order_by(
        PeerVisitSchedule.faculty_id, PeerVisitSchedule.cafedra_name, PeerVisitSchedule.id,
    ).all()
    visits = _visits_by_schedule(db, [row.id for row in rows])
    today = date.today()
    items = [serialize(row, visits.get(row.id), today) for row in rows]
    if status_filter:
        items = [item for item in items if item["status"] == status_filter]
    if unmatched_only:
        items = [item for item in items if not item["matched"]]
    return items


def summary(items: list[dict]) -> list[dict]:
    """Итоги по кафедрам: план, выполнено (в т. ч. не в срок), в работе, просрочено, запланировано."""
    groups: dict[tuple, dict] = {}
    for item in items:
        key = (item["faculty_id"], item["cafedra_name"])
        group = groups.setdefault(key, {
            "faculty_id": item["faculty_id"], "cafedra_id": item["cafedra_id"], "cafedra_name": item["cafedra_name"],
            "total": 0, "done": 0, "late": 0, "in_progress": 0, "overdue": 0, "planned": 0,
        })
        group["total"] += 1
        group[item["status"]] += 1
        group["late"] += int(item["late"])
    result = list(groups.values())
    for group in result:
        group["percent"] = round(group["done"] * 100 / group["total"]) if group["total"] else 0
    return result


def my_rows(db: Session, username: str) -> list[dict]:
    """Строки графика, где текущий пользователь — посещающий (его план посещений)."""
    rows = (
        db.query(PeerVisitSchedule)
        .filter(PeerVisitSchedule.visitor_login.in_(login_aliases(username)))
        .order_by(PeerVisitSchedule.academic_year.desc(), PeerVisitSchedule.month, PeerVisitSchedule.id)
        .all()
    )
    visits = _visits_by_schedule(db, [row.id for row in rows])
    today = date.today()
    return [serialize(row, visits.get(row.id), today) for row in rows]


def row_with_status(db: Session, row: PeerVisitSchedule) -> dict:
    return serialize(row, _visits_by_schedule(db, [row.id]).get(row.id))


def get_row(db: Session, row_id: int) -> PeerVisitSchedule:
    row = db.get(PeerVisitSchedule, row_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Строка графика не найдена")
    return row


def ensure_faculty_scope(row_faculty_id: int, dean_faculty_id: Optional[int]) -> None:
    if dean_faculty_id is not None and row_faculty_id != dean_faculty_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Доступ только к графику своего факультета")


def _apply_person(row: PeerVisitSchedule, prefix: str, tutor: Optional[dict], name: Optional[str], position: Optional[str]) -> None:
    if tutor:
        setattr(row, f"{prefix}_tutor_id", tutor["tutor_id"])
        setattr(row, f"{prefix}_name", tutor["full_name"])
        setattr(row, f"{prefix}_login", normalize_login(tutor.get("login")) or None)
    elif name is not None:
        setattr(row, f"{prefix}_tutor_id", None)
        setattr(row, f"{prefix}_name", re.sub(r"\s+", " ", name).strip())
        setattr(row, f"{prefix}_login", None)
    if position is not None:
        setattr(row, f"{prefix}_position", position.strip() or None)


def save_row(db: Session, row: PeerVisitSchedule, data: dict) -> PeerVisitSchedule:
    """Создание/правка строки. Преподаватели — по tutor_id из справочника или (если нет в справочнике) по ФИО."""
    for field in ("academic_year", "period", "faculty_id", "month", "note"):
        if field in data:
            setattr(row, field, data[field])
    if "cafedra_id" in data:
        row.cafedra_id = data["cafedra_id"]
        name = None
        if data["cafedra_id"]:
            name = db.execute(text("SELECT cafedraNameRU FROM cafedras WHERE cafedraID = :id"), {"id": data["cafedra_id"]}).scalar()
        row.cafedra_name = name or data.get("cafedra_name") or row.cafedra_name or ""
    elif "cafedra_name" in data:
        row.cafedra_name = data["cafedra_name"] or ""
    for prefix in ("visited", "visitor"):
        if any(f"{prefix}_{key}" in data for key in ("tutor_id", "name", "position")):
            tutor_id = data.get(f"{prefix}_tutor_id")
            tutor = tutor_by_id(db, tutor_id) if tutor_id else None
            _apply_person(row, prefix, tutor, data.get(f"{prefix}_name"), data.get(f"{prefix}_position"))
    if not row.visited_name or not row.visitor_name:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Укажите посещаемого и посещающего преподавателя")
    if row.visited_tutor_id and row.visited_tutor_id == row.visitor_tutor_id:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Преподаватель не может посещать сам себя")
    if not 1 <= int(row.month or 0) <= 12:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Месяц должен быть от 1 до 12")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_row(db: Session, row: PeerVisitSchedule) -> None:
    if db.query(PeerVisit).filter(PeerVisit.schedule_id == row.id).count():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="По строке графика уже есть отзыв — удалить её нельзя")
    db.delete(row)
    db.commit()


def import_rows(db: Session, rows: list[dict], *, academic_year: str, period: int, faculty_id: int, created_by: str) -> dict:
    """Импорт строк графика (перенос из бумажного графика). Повторный импорт того же факультета,
    года и периода заменяет строки, по которым ещё нет отзывов."""
    matcher = TutorMatcher(db)
    existing = db.query(PeerVisitSchedule).filter_by(academic_year=academic_year, period=period, faculty_id=faculty_id).all()
    existing_ids = [row.id for row in existing] or [0]
    with_reviews = {sid for (sid,) in db.query(PeerVisit.schedule_id).filter(PeerVisit.schedule_id.in_(existing_ids))}
    for row in existing:
        if row.id not in with_reviews:
            db.delete(row)
    cafedra_cache: dict[str, Optional[int]] = {}
    created = unmatched = skipped = 0
    for item in rows:
        month = MONTHS_RU.get((item.get("month") or "").strip().lower())
        if not month or not item.get("visited_name") or not item.get("visitor_name"):
            skipped += 1
            continue
        cafedra = (item.get("cafedra") or "").strip()
        if cafedra not in cafedra_cache:
            cafedra_id = find_cafedra_id(db, faculty_id, cafedra)
            platonus_name = db.execute(text("SELECT cafedraNameRU FROM cafedras WHERE cafedraID = :id"),
                                       {"id": cafedra_id}).scalar() if cafedra_id else None
            # Название кафедры — как в справочнике Platonus (в графиках бывает «IT» вместо полного)
            cafedra_cache[cafedra] = (cafedra_id, re.sub(r"\s+", " ", platonus_name or cafedra).strip())
        cafedra_id, cafedra_name = cafedra_cache[cafedra]
        row = PeerVisitSchedule(
            academic_year=academic_year, period=period, faculty_id=faculty_id,
            cafedra_id=cafedra_id, cafedra_name=cafedra_name, month=month,
            created_by=created_by,
        )
        visited = matcher.match(item["visited_name"], faculty_id)
        visitor = matcher.match(item["visitor_name"], faculty_id)
        _apply_person(row, "visited", visited, item["visited_name"], item.get("visited_position") or "")
        _apply_person(row, "visitor", visitor, item["visitor_name"], item.get("visitor_position") or "")
        # ФИО из бумажного графика остаётся в примечании, если в справочнике оно записано иначе
        printed = [n for n, t in ((item["visited_name"], visited), (item["visitor_name"], visitor))
                   if t and fold_name(n) != fold_name(t["full_name"])]
        if printed:
            row.note = "; ".join(filter(None, [row.note, "в графике: " + ", ".join(printed)]))
        unmatched += int(not (visited and visitor))
        db.add(row)
        created += 1
    db.commit()
    return {"created": created, "unmatched": unmatched, "skipped": skipped, "kept_with_reviews": len(with_reviews)}
