"""Распределение проверок занятий между членами комитета КРК (ДП «Оценка качества учебных занятий»
КазУТБ-ДСР-ДП-9.1.3-2026-16).

Проверяемые — преподаватели, у которых в семестре есть занятия в расписании Platonus (schedule_lessons).
Каждому на семестр назначается один член комитета (п. 2.4.1, 2.4.3). Правила:
- проверяющий не ниже проверяемого по званию (academic_rank): профессор проверяет всех, ассоциированный
  профессор — всех, кроме профессоров;
- не проверяет сам себя и преподавателей своей кафедры (п. 3.5, 3.9.6 — конфликт интересов, подчинённость);
- не проверяет декана своего факультета (п. 3.7 — прямая подчинённость);
- в другом семестре того же преподавателя проверяет другой член комитета (п. 2.4.4, 3.9.4);
- нагрузка распределяется поровну, при равной нагрузке — случайно (п. 3.9.9); сначала назначаются
  преподаватели с наименьшим выбором проверяющих.
Назначения, сделанные вручную (manual), и проведённые проверки повторное распределение сохраняет.
Члена состава можно исключить из проверок (committee_inspector_exclusions) — его непроведённые
проверки переходят к остальным, подписанный приказ не меняется.
"""
import random
from collections import Counter
from datetime import date
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

from models.committee import CommitteeAssignment, CommitteeInspectorExclusion, CommitteeOrder
from services.committee_service import tutor_people
from services.notification_service import login_aliases
from services.peer_visit_schedule_service import fold_name

TERMS = (1, 2)
# Причины, по которым член комитета не может проверять преподавателя
CONFLICT_MESSAGES = {
    "self": "Член комитета не проверяет собственные занятия",
    "rank": "Проверяющий ниже проверяемого по званию",
    "cafedra": "Проверяющий с той же кафедры — конфликт интересов",
    "dean": "Преподаватель — декан факультета проверяющего",
    "repeat": "Этот член комитета уже проверяет преподавателя в другом семестре",
}


def _study_year(academic_year: str) -> int:
    try:
        return int(academic_year.split("-")[0])
    except (AttributeError, ValueError):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Некорректный учебный год приказа")


def _check_term(term: int) -> None:
    if term not in TERMS:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Семестр — 1 или 2")


_PERSON_SQL = """
    SELECT t.tutor_id, t.full_name, t.login, t.cafedra_id, c.FacultyID AS faculty_id,
           c.cafedraNameRU AS cafedra_ru, c.cafedraNameKZ AS cafedra_kz, f.FacultyID AS dean_of
    FROM tutors t
    LEFT JOIN cafedras c ON c.cafedraID = t.cafedra_id
    LEFT JOIN faculties f ON f.dean_tutor_id = t.tutor_id
"""


def _people(db: Session, rows) -> dict[int, dict]:
    """Преподаватели с кафедрой, факультетом, ФИО «Фамилия И.О.», должностью и уровнем звания."""
    people = {row["tutor_id"]: dict(row) for row in rows}
    for tutor_id, card in tutor_people(db, people, with_title=True).items():
        people[tutor_id].update(name=card["name"], title=card["title"], rank=card["rank"])
    return people


def _teachers(db: Session, academic_year: str, term: int, extra_ids=()) -> dict[int, dict]:
    """Преподаватели с занятиями в семестре (и уже назначенные вне расписания — extra_ids)."""
    query = text(_PERSON_SQL + """
        WHERE t.tutor_id IN (SELECT DISTINCT tutor_id FROM schedule_lessons WHERE study_year = :year AND term = :term)
           OR t.tutor_id IN :extra
    """).bindparams(bindparam("extra", expanding=True))
    rows = db.execute(query, {"year": _study_year(academic_year), "term": term, "extra": list(extra_ids) or [0]}).mappings().all()
    return _people(db, rows)


def _inspectors(db: Session, order: CommitteeOrder) -> dict[int, dict]:
    """Члены состава, сопоставленные с преподавателями Platonus, в порядке приказа;
    excluded — исключён из проверок."""
    rows = db.execute(text(_PERSON_SQL.replace("SELECT", "SELECT x.id IS NOT NULL AS excluded,", 1) + """
        JOIN committee_members m ON m.tutor_id = t.tutor_id
        LEFT JOIN committee_inspector_exclusions x ON x.order_id = m.order_id AND x.tutor_id = t.tutor_id
        WHERE m.order_id = :order_id
        ORDER BY m.position, m.id
    """), {"order_id": order.id}).mappings().all()
    people = _people(db, rows)
    for person in people.values():
        person["excluded"] = bool(person["excluded"])
    return people


def conflict(inspector: dict, teacher: dict, other_term_inspector: Optional[int] = None) -> Optional[str]:
    """Код причины, по которой inspector не может проверять teacher (CONFLICT_MESSAGES), или None."""
    if inspector["tutor_id"] == teacher["tutor_id"]:
        return "self"
    if inspector["rank"] < teacher["rank"]:
        return "rank"
    if inspector["cafedra_id"] and inspector["cafedra_id"] == teacher["cafedra_id"]:
        return "cafedra"
    if teacher["dean_of"] and teacher["dean_of"] == inspector["faculty_id"]:
        return "dean"
    if other_term_inspector == inspector["tutor_id"]:
        return "repeat"
    return None


def _assignments(db: Session, order: CommitteeOrder) -> list[CommitteeAssignment]:
    return db.query(CommitteeAssignment).filter(CommitteeAssignment.order_id == order.id).all()


def _other_term(assignments: list[CommitteeAssignment], term: int) -> dict[int, int]:
    return {a.teacher_tutor_id: a.inspector_tutor_id for a in assignments if a.term != term}


def _release(db: Session, order: CommitteeOrder, term: int, assignments: list[CommitteeAssignment], should_release) -> tuple[list, dict]:
    """Удаляет назначения семестра, для которых should_release(assignment, inspector) истинно, кроме проведённых
    проверок. Возвращает оставшиеся назначения обоих семестров и преподавателей освобождённых назначений."""
    in_term = [a for a in assignments if a.term == term]
    teachers = _teachers(db, order.academic_year, term, [a.teacher_tutor_id for a in in_term])
    inspectors = _inspectors(db, order)
    is_done = _done_checker(db, order.academic_year)
    released = []
    for a in in_term:
        teacher, inspector = teachers.get(a.teacher_tutor_id), inspectors.get(a.inspector_tutor_id)
        if should_release(a, inspector) and not (teacher and inspector and is_done(teacher, inspector, term)):
            db.delete(a)
            released.append(a)
    # Удаление — до вставки новых: иначе INSERT того же преподавателя нарушит uq_committee_assignment
    db.flush()
    kept = [a for a in assignments if a not in released]
    return kept, {a.teacher_tutor_id: teachers[a.teacher_tutor_id] for a in released if a.teacher_tutor_id in teachers}


def _place(db: Session, order: CommitteeOrder, term: int, teachers: dict[int, dict], inspectors: dict[int, dict],
           kept: list[CommitteeAssignment], actor: str) -> list[CommitteeAssignment]:
    """Назначает каждому из teachers наименее загруженного допустимого проверяющего (п. 3.9.2, 3.9.9);
    сначала — преподавателей с наименьшим выбором. kept — сохраняемые назначения обоих семестров."""
    other = _other_term(kept, term)
    term_load = Counter(a.inspector_tutor_id for a in kept if a.term == term)
    total_load = Counter(a.inspector_tutor_id for a in kept)
    candidates = {
        tutor_id: [i for i in inspectors.values() if not i["excluded"] and not conflict(i, teacher, other.get(tutor_id))]
        for tutor_id, teacher in teachers.items()
    }
    rng = random.Random()
    pending = list(candidates)
    rng.shuffle(pending)
    pending.sort(key=lambda tutor_id: len(candidates[tutor_id]))
    added = []
    for tutor_id in pending:
        if not candidates[tutor_id]:
            continue
        chosen = min(candidates[tutor_id], key=lambda i: (term_load[i["tutor_id"]], total_load[i["tutor_id"]], rng.random()))
        term_load[chosen["tutor_id"]] += 1
        total_load[chosen["tutor_id"]] += 1
        added.append(CommitteeAssignment(order_id=order.id, term=term, teacher_tutor_id=tutor_id,
                                         inspector_tutor_id=chosen["tutor_id"], manual=False, assigned_by=actor))
    db.add_all(added)
    return added


def distribute(db: Session, order: CommitteeOrder, term: int, actor: str) -> dict:
    """Распределяет заново преподавателей семестра. Сохраняются назначения вручную и проведённые проверки —
    если их проверяющий не выбыл из состава и не исключён из проверок."""
    _check_term(term)
    teachers = _teachers(db, order.academic_year, term)
    if not teachers:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail=f"Расписание {term} семестра {order.academic_year} не загружено из Platonus")
    inspectors = _inspectors(db, order)
    if not any(not i["excluded"] for i in inspectors.values()):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail="В составе нет членов, сопоставленных с преподавателями Platonus и участвующих в проверках")

    kept, _ = _release(db, order, term, _assignments(db, order),
                       lambda a, inspector: not a.manual or not inspector or inspector["excluded"])
    placed = {a.teacher_tutor_id for a in kept if a.term == term}
    _place(db, order, term, {k: v for k, v in teachers.items() if k not in placed}, inspectors, kept, actor)
    db.commit()
    return overview(db, order, term)


def set_excluded(db: Session, order: CommitteeOrder, tutor_id: int, excluded: bool, actor: str) -> int:
    """Исключает члена состава из проверок (или возвращает). При исключении его непроведённые проверки обоих
    семестров переходят к остальным членам; остальное распределение не меняется. Возвращает число переданных."""
    if tutor_id not in _inspectors(db, order):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Не член этого состава комитета")
    row = db.query(CommitteeInspectorExclusion).filter_by(order_id=order.id, tutor_id=tutor_id).first()
    if not excluded:
        if row:
            db.delete(row)
            db.commit()
        return 0
    if not row:
        db.add(CommitteeInspectorExclusion(order_id=order.id, tutor_id=tutor_id, excluded_by=actor))
        db.flush()
    moved = hand_over(db, order, tutor_id, actor)
    db.commit()
    return moved


def hand_over(db: Session, order: CommitteeOrder, tutor_id: int, actor: str) -> int:
    """Передаёт непроведённые проверки члена комитета (обоих семестров) остальным, не меняя прочее распределение.
    Вызывается до удаления члена из состава — проведённые им проверки ещё опознаются по его логину.
    Без commit. Возвращает число переданных."""
    inspectors = _inspectors(db, order)
    if tutor_id in inspectors:
        inspectors[tutor_id]["excluded"] = True
    assignments = _assignments(db, order)
    moved = 0
    for term in TERMS:
        assignments, released = _release(db, order, term, assignments, lambda a, _: a.inspector_tutor_id == tutor_id)
        added = _place(db, order, term, released, inspectors, assignments, actor)
        assignments += added
        moved += len(added)
    return moved


def forget_member(db: Session, order: CommitteeOrder, tutor_id: int) -> None:
    """Член удалён из состава: отметка об исключении из проверок больше не нужна. Без commit."""
    db.query(CommitteeInspectorExclusion).filter_by(order_id=order.id, tutor_id=tutor_id).delete()


def assign(db: Session, order: CommitteeOrder, term: int, teacher_id: int, inspector_id: Optional[int], actor: str) -> dict:
    """Ручное назначение проверяющего (inspector_id=None — снять назначение) с проверкой правил."""
    _check_term(term)
    assignments = _assignments(db, order)
    current = next((a for a in assignments if a.term == term and a.teacher_tutor_id == teacher_id), None)
    if inspector_id is None:
        if current:
            db.delete(current)
            db.commit()
        return overview(db, order, term)

    teacher = _teachers(db, order.academic_year, term, [teacher_id]).get(teacher_id)
    inspector = _inspectors(db, order).get(inspector_id)
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Преподаватель не найден в справочнике")
    if not inspector:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Проверяющий — не член этого состава комитета")
    if inspector["excluded"]:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Член комитета исключён из проверок")
    reason = conflict(inspector, teacher, _other_term(assignments, term).get(teacher_id))
    if reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=CONFLICT_MESSAGES[reason])
    if current:
        current.inspector_tutor_id, current.manual, current.assigned_by = inspector_id, True, actor
    else:
        db.add(CommitteeAssignment(order_id=order.id, term=term, teacher_tutor_id=teacher_id,
                                   inspector_tutor_id=inspector_id, manual=True, assigned_by=actor))
    db.commit()
    return overview(db, order, term)


def clear(db: Session, order: CommitteeOrder, term: int) -> int:
    _check_term(term)
    count = db.query(CommitteeAssignment).filter(CommitteeAssignment.order_id == order.id,
                                                 CommitteeAssignment.term == term).delete()
    db.commit()
    return count


def _second_term_start(db: Session, academic_year: str) -> date:
    """Начало 2-го семестра: записи КРК до него — 1-й семестр, после — 2-й."""
    start = db.execute(text("SELECT start_date FROM schedule_terms WHERE study_year = :year AND term = 2"),
                       {"year": _study_year(academic_year)}).scalar()
    return start or date(_study_year(academic_year) + 1, 1, 1)


def _done_checker(db: Session, academic_year: str):
    """Проведена ли проверка: есть запись КРК проверяющего о занятии преподавателя в этом семестре."""
    second_start = _second_term_start(db, academic_year)
    done = set()
    rows = db.execute(text("SELECT teacher, submitted_by, datetime FROM records WHERE academic_year = :year AND submitted_by IS NOT NULL"),
                      {"year": academic_year}).all()
    for teacher, submitted_by, moment in rows:
        term = 2 if moment and moment.date() >= second_start else 1
        done.add((fold_name(teacher), submitted_by.lower(), term))

    def check(teacher: dict, inspector: dict, term: int) -> bool:
        name = fold_name(teacher["full_name"])
        return any((name, alias.lower(), term) in done for alias in login_aliases(inspector["login"]))

    return check


def _person_out(person: dict) -> dict:
    return {
        "tutor_id": person["tutor_id"], "name": person["name"], "title": person["title"], "rank": person["rank"],
        "cafedra_id": person["cafedra_id"], "cafedra_ru": person["cafedra_ru"], "cafedra_kz": person["cafedra_kz"],
    }


def overview(db: Session, order: CommitteeOrder, term: int) -> dict:
    """Распределение семестра: преподаватели с проверяющими и допустимыми членами комитета, нагрузка членов."""
    _check_term(term)
    assignments = _assignments(db, order)
    in_term = {a.teacher_tutor_id: a for a in assignments if a.term == term}
    other = _other_term(assignments, term)
    teachers = _teachers(db, order.academic_year, term, in_term)
    inspectors = _inspectors(db, order)
    is_done = _done_checker(db, order.academic_year)
    term_load = Counter(a.inspector_tutor_id for a in in_term.values())
    total_load = Counter(a.inspector_tutor_id for a in assignments)

    items = []
    for tutor_id, teacher in teachers.items():
        assignment = in_term.get(tutor_id)
        inspector = inspectors.get(assignment.inspector_tutor_id) if assignment else None
        done = bool(inspector and is_done(teacher, inspector, term))
        items.append({
            **_person_out(teacher),
            "inspector_id": assignment.inspector_tutor_id if assignment else None,
            "inspector_name": inspector["name"] if inspector else None,
            # Назначенный член выбыл из состава или исключён из проверок, не проведя её, — назначение недействительно
            "inspector_missing": bool(assignment and (not inspector or (inspector["excluded"] and not done))),
            "manual": bool(assignment and assignment.manual),
            "done": done,
            "other_term_inspector_id": other.get(tutor_id),
            "eligible": [i for i, person in inspectors.items()
                         if not person["excluded"] and not conflict(person, teacher, other.get(tutor_id))],
        })
    items.sort(key=lambda item: (item["cafedra_ru"] or "", item["name"]))

    counts = dict(db.execute(text("SELECT s.term, COUNT(DISTINCT s.tutor_id) FROM schedule_lessons s JOIN tutors t ON t.tutor_id = s.tutor_id "
                                  "WHERE s.study_year = :year GROUP BY s.term"),
                             {"year": _study_year(order.academic_year)}).all())
    return {
        "order_id": order.id,
        "academic_year": order.academic_year,
        "term": term,
        "terms": [{"term": t, "teachers": counts.get(t, 0), "assigned": sum(1 for a in assignments if a.term == t)} for t in TERMS],
        "items": items,
        "inspectors": [{**_person_out(i), "excluded": i["excluded"], "load": term_load[i["tutor_id"]], "total": total_load[i["tutor_id"]],
                        "done": sum(1 for item in items if item["inspector_id"] == i["tutor_id"] and item["done"])}
                       for i in inspectors.values()],
        "summary": {
            "teachers": len(items),
            "assigned": sum(1 for item in items if item["inspector_id"] and not item["inspector_missing"]),
            "unassigned": sum(1 for item in items if not item["inspector_id"] or item["inspector_missing"]),
            "done": sum(1 for item in items if item["done"]),
        },
    }


def my_assignments(db: Session, username: str, academic_year: Optional[str]) -> Optional[dict]:
    """Кого член комитета проверяет по действующему приказу (для «Моих показателей»)."""
    order = db.query(CommitteeOrder).filter(CommitteeOrder.is_active.is_(True)).first()
    if not order or (academic_year and order.academic_year != academic_year):
        return None
    aliases = sorted(set(login_aliases(username)) | {username})
    query = text("SELECT tutor_id FROM tutors WHERE login IN :logins").bindparams(bindparam("logins", expanding=True))
    my_ids = {row[0] for row in db.execute(query, {"logins": aliases}).all()}
    mine = [a for a in _assignments(db, order) if a.inspector_tutor_id in my_ids]
    if not mine:
        return None
    is_done = _done_checker(db, order.academic_year)
    inspectors = _inspectors(db, order)
    rows = []
    for term in TERMS:
        term_items = [a for a in mine if a.term == term]
        if not term_items:
            continue
        teachers = _teachers(db, order.academic_year, term, [a.teacher_tutor_id for a in term_items])
        for a in term_items:
            teacher, inspector = teachers.get(a.teacher_tutor_id), inspectors.get(a.inspector_tutor_id)
            if teacher and inspector and not inspector["excluded"]:
                rows.append({"term": term, "name": teacher["name"], "title": teacher["title"],
                             "cafedra_ru": teacher["cafedra_ru"], "cafedra_kz": teacher["cafedra_kz"],
                             "done": is_done(teacher, inspector, term)})
    if not rows:
        return None
    rows.sort(key=lambda row: (row["term"], row["done"], row["name"]))
    return {"total": len(rows), "done": sum(1 for row in rows if row["done"]), "items": rows}
