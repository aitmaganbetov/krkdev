"""Чек-лист ситуационного видеомониторинга — форма Ф. ДСР-9.1.3-2026-16-02 (ДП «Оценка качества учебных
занятий» КазУТБ-ДСР-ДП-9.1.3-2026-16, раздел 4).

Видеомониторинг подтверждает только организационные факты и не формирует педагогический балл (п. 4.1, 4.3).
Плохой видеосигнал не трактуется против преподавателя (п. 4.7). Нарушение фиксируется, когда расхождение
видно чётко (качество видео — «да»), или после уточнения: сверки расписания и замен и повторного наблюдения
либо очной верификации (п. 4.5). Нарушение подписывается ЭЦП (violation → confirmed), после этого преподаватель
получает уведомление и прикладывает объяснительную или оправдательную справку; по ним нарушение снимают (justified).
"""
from typing import Optional

from fastapi import HTTPException, status

ANSWERS = {"yes": "да", "no": "нет", "unclear": "неясно", "not_visible": "не видно", "na": "НП"}

# (ключ, проверочный вопрос, ответ-расхождение, краткое название расхождения)
QUESTIONS = (
    ("schedule", "Проводится ли занятие в аудитории и временном интервале, указанных в актуальном расписании?",
     "no", "Несоответствие расписанию"),
    ("teacher", "Виден ли преподаватель в зоне проведения занятия?", "no", "Преподаватель не наблюдается"),
    ("group", "Наблюдается ли группа обучающихся в аудитории?", "no", "Группа не наблюдается"),
    ("activity", "Наблюдается ли видимая учебная деятельность?", "no", "Нет видимой учебной деятельности"),
    ("continuity", "Отсутствует ли длительное необъяснимое прекращение занятия?", "no", "Длительное прекращение занятия"),
    ("safety", "Отсутствуют ли видимые обстоятельства, требующие немедленного реагирования по безопасности?",
     "no", "Риск безопасности"),
    ("quality", "Достаточны ли качество связи, освещение и обзор камеры для организационного вывода?",
     "no", "Недостаточное качество видеосигнала"),
    ("other", "Есть ли иное расхождение, которое необходимо подтвердить очно или по документам?", "yes", "Иное расхождение"),
)
QUESTION_KEYS = tuple(key for key, *_ in QUESTIONS)

# Итог наблюдения (раздел «Отчетность» формы) — хранится в violations.status
OUTCOMES = {
    "compliant": "соответствует",
    "clarification": "требуется уточнение",
    "violation": "нарушение — ожидает подписи ЭЦП",
    "confirmed": "нарушение — подтверждено организационное несоответствие",
    "justified": "нарушение снято по пояснению преподавателя",
    "technical": "технически невозможно оценить",
}
# Статусы записей, сделанных до формы 16-02
LEGACY_STATUSES = {"pending": "ожидает проверки", "rejected": "отклонено"}
INITIAL_OUTCOMES = ("compliant", "clarification", "violation", "technical")
# Итог отчетности; confirmed и justified ставятся подписью ЭЦП и решением по пояснению
REPORT_OUTCOMES = ("compliant", "clarification", "violation", "technical")
FINAL_STATUSES = ("confirmed", "rejected", "justified")
# Чек-лист подписывается ЭЦП наблюдателя при любом итоге; преподавателю отправляются «соответствует»
# (уведомление без замечаний) и нарушение (violation → confirmed, с правом приложить пояснение)
SIGNABLE_STATUSES = ("compliant", "clarification", "violation", "technical")
SENT_TO_TEACHER = ("compliant", "violation")


def is_locked(status: str, signed: bool) -> bool:
    """Решение принято: подписанное нарушение, снятое, отклонённое, а также подписанные «соответствует»
    и «технически невозможно оценить». «Требуется уточнение» после подписи можно довести до нарушения."""
    return status in FINAL_STATUSES or (signed and status in ("compliant", "technical"))

NO_REMARKS = "Без замечаний"
TECHNICAL = "Технически невозможно оценить"


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def deviations(checklist: Optional[dict]) -> list[str]:
    """Ключи вопросов с ответом-расхождением, в порядке формы."""
    checklist = checklist or {}
    return [key for key, _, negative, _ in QUESTIONS if checklist.get(key) == negative]


def summary_type(checklist: dict, outcome: str) -> str:
    """Краткое содержание наблюдения для списков и сводок (violations.violation_type)."""
    if outcome == "technical":
        return TECHNICAL
    labels = {key: label for key, _, _, label in QUESTIONS}
    found = deviations(checklist)
    return labels[found[0]] if found else NO_REMARKS


def validate_new(checklist: dict, outcome: str, comment: str) -> None:
    """Проверка заполненного чек-листа при сохранении наблюдения."""
    missing = [key for key in QUESTION_KEYS if checklist.get(key) not in ANSWERS]
    if missing or set(checklist) - set(QUESTION_KEYS):
        raise _unprocessable("Ответьте на все проверочные вопросы чек-листа")
    if outcome not in INITIAL_OUTCOMES:
        raise _unprocessable("Неизвестный статус наблюдения")
    if checklist["quality"] == "no" and outcome != "technical":
        raise _unprocessable("При недостаточном качестве видеосигнала результат — «технически невозможно оценить» (п. 4.7)")
    if outcome == "compliant" and (deviations(checklist) or "unclear" in checklist.values()):
        raise _unprocessable("При расхождениях или неясных ответах статус «соответствует» не ставится")
    if outcome == "violation" and (checklist["quality"] != "yes" or not deviations(checklist)):
        raise _unprocessable("Нарушение фиксируется, когда расхождение есть и видео позволяет сделать вывод "
                             "(качество связи, освещение и обзор — «да»)")
    if checklist["other"] == "yes" and not comment.strip():
        raise _unprocessable("Укажите в комментарии конкретный факт расхождения, временную отметку и способ проверки")


def ensure_can_confirm(checklist: Optional[dict], schedule_check: str, repeat_observation: bool, onsite_verification: str) -> None:
    """Нарушение по наблюдению, которое требовало уточнения, — только после сверки расписания и замен и повторного
    наблюдения или очной верификации (п. 4.5); по техническому сбою — нельзя (п. 4.7)."""
    if checklist is not None:
        if checklist.get("quality") == "no":
            raise _unprocessable("Технически некачественный видеосигнал не трактуется против преподавателя (п. 4.7)")
        if not deviations(checklist):
            raise _unprocessable("В чек-листе нет расхождений — подтверждать нечего")
    if not schedule_check.strip():
        raise _unprocessable("Перед подтверждением заполните «Проверка расписания и замен» (п. 4.5)")
    if not repeat_observation and not onsite_verification.strip():
        raise _unprocessable("Перед подтверждением нужно повторное наблюдение или очная верификация (п. 4.5)")
