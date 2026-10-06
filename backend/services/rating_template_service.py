"""Справочник вопросов по учебным годам: расчёт балла, проверка оценок, стартовая миграция."""

import copy
import logging
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.rating_template import RatingTemplate

logger = logging.getLogger(__name__)

CALC_METHODS = ("average", "weighted", "sections", "sum")

# Пороги, которые действовали до появления справочника (score < 5 OR attendance < 40).
LEGACY_PROBLEM_SCORE_BELOW = 5.0
LEGACY_PROBLEM_ATTENDANCE_BELOW = 40.0


def _q(code, ru, kk, en, report_title=""):
    return {"code": code, "text": {"ru": ru, "kk": kk, "en": en}, "report_title": report_title, "weight": 1}


# Вопросы 2025-2026, которые были зашиты в код до справочника.
DEFAULT_SECTIONS = [
    {
        "code": "1",
        "title": {
            "ru": "1. Оценка содержания и методики проведения занятия",
            "kk": "1. Сабақтың мазмұны мен өткізу әдістемесін бағалау",
            "en": "1. Assessment of lesson content and methodology",
        },
        "weight": 1,
        "questions": [
            _q("1.1", "Соответствие темы и содержания занятия силлабусу",
               "Сабақ тақырыбы мен мазмұнының силлабусқа сәйкестігі",
               "Conformity of topic and content with the syllabus",
               "Соответствие темы и содержания занятия силлабусу"),
            _q("1.2", "Системность и логическая последовательность в содержании материала",
               "Материал мазмұнының жүйелілігі мен логикалық кезектілігі",
               "Systematic and logical sequence of material",
               "Системность и логическая последовательность в содержании материала"),
            _q("1.3", "Содержание и изложение учебного материала",
               "Оқу материалының мазмұны мен баяндалуы",
               "Content and presentation of educational material",
               "Содержание и изложение учебного материала"),
            _q("1.4", "Организация самостоятельной работы обучающихся",
               "Студенттердің өзіндік жұмысын ұйымдастыру",
               "Organization of independent student work",
               "Организация самостоятельной работы обучающихся"),
            _q("1.5", "Использование эффективных методов контроля хода занятия и результатов выполнения заданий обучающимися",
               "Сабақтың барысын бақылаудың тиімді әдістерін қолдану",
               "Use of effective lesson monitoring methods",
               "Использование эффективных методов контроля хода занятия и результатов выполнения заданий обучающимися"),
            _q("1.6", "Рациональность использования времени на изучение учебных вопросов",
               "Оқу сұрақтарын зерделеуге уақытты ұтымды пайдалану",
               "Rational use of time for study topics",
               "Рациональность использования времени на изучение учебных вопросов"),
            _q("1.7", "Соответствие преподавания дисциплины заявленному языку обучения (казахский, английский, русский)",
               "Пәнді жарияланған оқыту тіліне сәйкес оқыту",
               "Conformity of teaching with declared language of instruction",
               "Преподавание дисциплины на языке обучения (казахском, английском, русском)"),
        ],
    },
    {
        "code": "2",
        "title": {
            "ru": "2. Оценка педагогических данных преподавателя",
            "kk": "2. Оқытушының педагогикалық деректерін бағалау",
            "en": "2. Assessment of teacher pedagogical skills",
        },
        "weight": 1,
        "questions": [
            _q("2.1", "Использование приемов поддержания внимания обучающихся и способность установить с ними контакт",
               "Студенттердің назарын ұстап тұру тәсілдерін қолдану",
               "Use of attention-maintaining techniques",
               "Использование приемов поддержания внимания обучающихся и способность установить с ними контакт"),
            _q("2.2", "Умение вызвать и поддержать интерес аудитории к дисциплине",
               "Аудиторияның пәнге деген қызығушылығын ояту",
               "Ability to arouse and maintain audience interest",
               "Умение вызвать и поддержать интерес аудитории к дисциплине"),
            _q("2.3", "Ясность и доступность учебного материала",
               "Оқу материалының анықтығы мен қолжетімділігі",
               "Clarity and accessibility of educational material",
               "Ясность и доступность учебного материала"),
            _q("2.4", "Культура речи, дикция, эрудиция, внешний вид, манера поведения, умение держаться перед аудиторией",
               "Сөйлеу мәдениеті, дикция, эрудиция, сыртқы көрініс",
               "Speech culture, diction, erudition, appearance, behavior",
               "Культура речи, речевые данные, дикция, эрудиция, внешний вид, манера поведения, умение держаться перед аудиторией"),
            _q("2.5", "Доброжелательность и такт по отношению к обучающемуся",
               "Студентке деген мейірімділік пен такт",
               "Goodwill and tact toward students",
               "Доброжелательность и такт по отношению к обучающемуся"),
            _q("2.6", "Организация и активизация деятельности обучающихся, побуждение к высказыванию и анализ выступлений",
               "Студенттер қызметін ұйымдастыру және белсендіру",
               "Organization and activation of student activity",
               "Организация и активизация деятельности обучающихся, побуждение их к высказыванию, выступлению; анализ выступлений и замечаний, сделанных по их ходу"),
        ],
    },
    {
        "code": "3",
        "title": {
            "ru": "3. Оценка научно-практических работ преподавателя",
            "kk": "3. Оқытушының ғылыми-практикалық жұмыстарын бағалау",
            "en": "3. Assessment of teacher scientific-practical work",
        },
        "weight": 1,
        "questions": [
            _q("3.1", "Использование ТСО, современных интерактивных методов, цифровых ресурсов и наглядных материалов",
               "ТСО, заманауи интерактивті әдістер мен цифрлық ресурстарды қолдану",
               "Use of technology, interactive methods, digital resources",
               "Использование технических средств обучения, современных интерактивных методов обучения, цифровых образовательных ресурсов, прикладного программного обеспечения, использование записей на доске, наглядных пособий, раздаточного материала"),
            _q("3.2", "Творческий подход и интерес к своему делу",
               "Шығармашылық тәсіл мен ісіне деген қызығушылық",
               "Creative approach and interest in their work",
               "Творческий подход и интерес к своему делу"),
            _q("3.3", "Практическое применение знаний. Практико-ориентированность",
               "Білімді практикалық қолдану. Практикаға бағдарлану",
               "Practical application of knowledge. Practice-oriented",
               "Практическое применение знаний, полученных по предполагаемой дисциплине. Практик ориентированность"),
            _q("3.4", "Актуальность и новизна предлагаемого материала",
               "Ұсынылатын материалдың өзектілігі мен жаңалығы",
               "Relevance and novelty of proposed material",
               "Актуальность и новизна предлагаемого материала."),
        ],
    },
]

DEFAULT_NOTE = {
    "ru": "Шкала посещения/оценки: 10 = 100%, 9 = 90%, 8 = 80%, 7 = 70%, 6 = 60%, 5 = 50%, 4 = 40%, 3 = 30%, 2 = 20%, 1 = 10%.\n"
          "Уровни: высокий (10-9), достаточно высокий (8-7), недостаточно высокий (6-5), низкий (4-3), критерий не соответствует ожиданиям (2-1).",
    "kk": "Бағалау шкаласы: 10 = 100%, 9 = 90%, 8 = 80%, 7 = 70%, 6 = 60%, 5 = 50%, 4 = 40%, 3 = 30%, 2 = 20%, 1 = 10%.\n"
          "Деңгейлер: жоғары (10-9), жеткілікті жоғары (8-7), жеткіліксіз жоғары (6-5), төмен (4-3), өлшем күтілімге сәйкес келмейді (2-1).",
    "en": "Scoring scale: 10 = 100%, 9 = 90%, 8 = 80%, 7 = 70%, 6 = 60%, 5 = 50%, 4 = 40%, 3 = 30%, 2 = 20%, 1 = 10%.\n"
          "Levels: high (10-9), fairly high (8-7), insufficient (6-5), low (4-3), does not meet expectations (2-1).",
}


def default_template_fields() -> dict:
    return {
        "scale_min": 1,
        "scale_max": 10,
        "calc_method": "average",
        "problem_score_below": LEGACY_PROBLEM_SCORE_BELOW,
        "problem_attendance_below": LEGACY_PROBLEM_ATTENDANCE_BELOW,
        "note": copy.deepcopy(DEFAULT_NOTE),
        "sections": copy.deepcopy(DEFAULT_SECTIONS),
    }


def _q26(code, text_ru, hint_ru):
    return {
        "code": code,
        "text": {"ru": text_ru, "kk": "", "en": ""},
        "hint": {"ru": hint_ru, "kk": "", "en": ""},
        "report_title": "",
        "weight": 1,
    }


def _s26(code, title_ru, weight, questions, lesson_types=None):
    return {
        "code": code,
        "title": {"ru": title_ru, "kk": "", "en": ""},
        "weight": weight,
        "lesson_types": lesson_types or [],
        "questions": questions,
    }


# ДП КазУТБ-ДСР-ДП-9.1.3-2026-16 «Оценка качества учебных занятий», анкета Ф. ДСР-9.1.3-2026-16-01.
# A–D — для всех занятий, E — один модуль по виду занятия. Итог = A×0,20 + B×0,25 + C×0,20 + D×0,20 + E×0,15.
KAZUTB_2026_2027_SECTIONS = [
    _s26("A", "A. Цель и содержание занятия", 20, [
        _q26("A1", "Соответствуют ли фактическая тема, задания и виды работы расписанию, силлабусу и плану занятия?",
             "Совпадают дисциплина, тема, вид занятия и содержание; отклонение педагогически обосновано и не меняет заявленный результат."),
        _q26("A2", "Понятны ли обучающимся цель занятия и ожидаемый результат?",
             "Цель сформулирована или однозначно следует из задания; студентам понятно, что они должны знать, уметь или выполнить к завершению занятия."),
        _q26("A3", "Является ли содержание академически корректным, актуальным и профессионально значимым?",
             "Используются корректные понятия, данные и источники; материал связан с образовательной программой и будущей профессиональной практикой."),
        _q26("A4", "Имеет ли занятие логичную структуру и последовательность?",
             "К концу занятия имеется наблюдаемое подтверждение: выполненное действие, решение задачи, продукт, объяснение, демонстрация навыка или корректный вывод."),
    ]),
    _s26("B", "B. Методика и организация обучения", 25, [
        _q26("B1", "Имеет ли занятие логичную структуру и последовательность?",
             "Выделяются начало, основная работа и завершение; переходы понятны, ключевые положения связаны между собой."),
        _q26("B2", "Соответствуют ли методы обучения цели и виду занятия?",
             "Применённые объяснения, обсуждения, задания, упражнения, демонстрации или эксперименты помогают достичь заявленного результата."),
        _q26("B3", "Рационально ли используется учебное время?",
             "Нет необоснованных пауз и затягивания; темп учитывает сложность материала; основное время направлено на содержательную учебную работу."),
        _q26("B4", "Понятно ли объясняется сложный материал?",
             "Термины раскрываются, приводятся примеры и связи, проверяется понимание; объяснение помогает студентам перейти к самостоятельному действию."),
    ]),
    _s26("C", "C. Учебная активность и взаимодействие", 20, [
        _q26("C1", "Вовлечено ли большинство присутствующих студентов в содержательную учебную деятельность?",
             "Большинство слушает с заданием, отвечает, обсуждает, решает, выполняет упражнение, работает с материалом или создаёт результат."),
        _q26("C2", "Создаёт ли преподаватель условия для самостоятельного мышления студентов?",
             "Используются вопросы, проблемные ситуации, сравнение вариантов, аргументация, анализ ошибок или самостоятельный выбор способа решения."),
        _q26("C3", "Получают ли студенты возможность задавать вопросы и участвовать во взаимодействии?",
             "Есть содержательный обмен между преподавателем и группой; вопросы принимаются и обсуждаются; ответы студентов используются в дальнейшем ходе занятия."),
        _q26("C4", "Поддерживает ли преподаватель уважительную и инклюзивную учебную среду?",
             "Корректное обращение, отсутствие унижения и дискриминации, равная возможность участия, понятные инструкции и уместная поддержка при затруднениях."),
    ]),
    _s26("D", "D. Оценивание и обратная связь", 20, [
        _q26("D1", "Понятны ли студентам требования к заданию и признаки качественного результата?",
             "Указано, что нужно выполнить, в каком формате, за какое время и по каким признакам будет оценён результат."),
        _q26("D2", "Проверяет ли преподаватель понимание и ход выполнения работы?",
             "Используются содержательные вопросы, наблюдение за выполнением, короткие задания, демонстрация решения или иной способ текущей проверки."),
        _q26("D3", "Получают ли студенты конкретную и полезную обратную связь?",
             "Обратная связь показывает, что выполнено верно, что требует исправления и какое следующее действие улучшит результат."),
        _q26("D4", "Есть ли наблюдаемые подтверждения достижения результатов или прогресса обучающихся?",
             "Студенты демонстрируют понимание, выполняют действие, объясняют решение, создают продукт либо исправляют ошибку по обратной связи."),
    ]),
    _s26("E", "E. Модуль по виду занятия: лекция", 15, [
        _q26("E1", "Связан ли новый материал с ранее изученным и общей логикой дисциплины?",
             "Актуализированы базовые знания, показаны связи между темами."),
        _q26("E2", "Подкреплены ли ключевые положения доказательствами, примерами или профессиональными кейсами?",
             "Используются корректные данные, источники, примеры или демонстрации."),
        _q26("E3", "Проверено ли понимание ключевых идей лекции?",
             "Есть вопросы, мини-задание, резюме студентами или другой способ проверки понимания."),
    ], ["Лекция"]),
    _s26("E", "E. Модуль по виду занятия: практика или семинар", 15, [
        _q26("E1", "Применяют ли обучающиеся теорию при выполнении заданий?",
             "Основная часть времени отведена решению, анализу, обсуждению или созданию результата."),
        _q26("E2", "Соответствуют ли задания уровню подготовки и постепенно усложняются?",
             "Задания посильны, но требуют осмысленного применения знаний; предусмотрена поддержка при затруднениях."),
        _q26("E3", "Разбираются ли способы решения и типичные ошибки?",
             "Студенты объясняют ход решения, сравнивают подходы и корректируют ошибки."),
    ], ["Практика", "Семинар"]),
    _s26("E", "E. Модуль по виду занятия: лабораторная работа", 15, [
        _q26("E1", "Даны ли необходимые инструкции и обеспечено ли соблюдение требований безопасности?",
             "До начала работы понятны порядок действий, ограничения и меры безопасности."),
        _q26("E2", "Самостоятельно ли обучающиеся выполняют предусмотренные операции?",
             "Студенты работают с оборудованием, программой или экспериментом; преподаватель оказывает дозированную поддержку."),
        _q26("E3", "Фиксируются и интерпретируются ли результаты работы?",
             "Результаты измерены или записаны, проанализированы и соотнесены с ожидаемым выводом."),
    ], ["Лабораторная"]),
    _s26("E", "E. Модуль по виду занятия: физическая культура или творческое занятие", 15, [
        _q26("E1", "Обеспечены ли инструктаж, демонстрация и безопасная организация деятельности?",
             "Понятна техника выполнения; пространство и оборудование используются безопасно."),
        _q26("E2", "Имеют ли обучающиеся достаточное время для практической деятельности?",
             "Большая часть занятия направлена на выполнение упражнений или создание продукта."),
        _q26("E3", "Получают ли обучающиеся индивидуализированную коррекцию техники или результата?",
             "Преподаватель наблюдает, корректирует и учитывает различия в уровне подготовки."),
    ], ["Физическая культура", "Творческое"]),
]

KAZUTB_2026_2027_NOTE = {
    "ru": "Шкала: 1–2 — критерий практически не проявлен; 3–4 — проявлен с существенными недостатками; "
          "5–6 — приемлемый минимальный уровень; 7–8 — хороший уровень; 9–10 — устойчивое качественное проявление, подтверждённое фактами.\n"
          "Все вопросы обязательны, только целая оценка от 1 до 10. Для оценок 1–4 и 9–10 укажите конкретный факт в комментарии.\n"
          "Итог = A×0,20 + B×0,25 + C×0,20 + D×0,20 + E×0,15. Уровни: 9,0–10,0 — высокий; 7,0–8,9 — хороший; "
          "5,0–6,9 — требует улучшения; 1,0–4,9 — неудовлетворительный.",
    "kk": "",
    "en": "",
}


def kazutb_2026_2027_fields() -> dict:
    return {
        "scale_min": 1,
        "scale_max": 10,
        "calc_method": "sections",
        "problem_score_below": 5.0,
        "problem_attendance_below": LEGACY_PROBLEM_ATTENDANCE_BELOW,
        "note": copy.deepcopy(KAZUTB_2026_2027_NOTE),
        "sections": copy.deepcopy(KAZUTB_2026_2027_SECTIONS),
    }


# Утверждённые справочники: создаются при старте, если их ещё нет (дальше правятся в интерфейсе).
OFFICIAL_TEMPLATES = {
    "2026-2027": kazutb_2026_2027_fields,
}


def template_content(template: RatingTemplate) -> dict:
    return {
        "scale_min": template.scale_min,
        "scale_max": template.scale_max,
        "calc_method": template.calc_method,
        "problem_score_below": template.problem_score_below,
        "problem_attendance_below": template.problem_attendance_below,
        "note": copy.deepcopy(template.note or {}),
        "sections": copy.deepcopy(template.sections or []),
    }


def applicable_sections(template: RatingTemplate, lesson_type: Optional[str]) -> list[dict]:
    """Разделы без lesson_types действуют всегда, остальные — только для указанных видов занятия."""
    lesson = (lesson_type or "").strip().lower()
    result = []
    for section in template.sections or []:
        types = [t.strip().lower() for t in section.get("lesson_types") or [] if t and t.strip()]
        if not types or lesson in types:
            result.append(section)
    return result


def question_codes(template: RatingTemplate, lesson_type: Optional[str] = None) -> list[str]:
    return [q["code"] for s in applicable_sections(template, lesson_type) for q in s.get("questions", [])]


def questions_per_record(template: RatingTemplate) -> int:
    """Сколько вопросов в одной анкете: общие разделы + самый большой модуль по виду занятия."""
    common = sum(len(s.get("questions", [])) for s in template.sections or [] if not s.get("lesson_types"))
    modules = [len(s.get("questions", [])) for s in template.sections or [] if s.get("lesson_types")]
    return common + (max(modules) if modules else 0)


def max_score(template: RatingTemplate) -> float:
    if template.calc_method == "sum":
        return float(template.scale_max * questions_per_record(template))
    return float(template.scale_max)


def structure_signature(content: dict) -> tuple:
    """Всё, что влияет на сохранённые оценки и расчёт. Тексты и подсказки сюда не входят."""
    return (
        int(content["scale_min"]),
        int(content["scale_max"]),
        content["calc_method"],
        float(content["problem_score_below"]),
        float(content["problem_attendance_below"]),
        tuple(
            (
                s["code"],
                float(s.get("weight", 1)),
                tuple(sorted(t.strip().lower() for t in s.get("lesson_types") or [])),
                tuple((q["code"], float(q.get("weight", 1))) for q in s.get("questions", [])),
            )
            for s in content["sections"]
        ),
    )


def compute_score(template: RatingTemplate, ratings: dict, lesson_type: Optional[str] = None) -> float:
    sections = applicable_sections(template, lesson_type)
    values = [(s, q, ratings[q["code"]]) for s in sections for q in s.get("questions", []) if q["code"] in ratings]
    if not values:
        return 0.0

    method = template.calc_method
    if method == "sum":
        score = sum(v for _, _, v in values)
    elif method == "weighted":
        total_weight = sum(float(q.get("weight", 1)) for _, q, _ in values)
        score = sum(v * float(q.get("weight", 1)) for _, q, v in values) / total_weight if total_weight else 0.0
    elif method == "sections":
        # Делим на сумму весов действующих разделов: вес неприменимого раздела
        # распределяется между остальными пропорционально.
        weighted_sum = 0.0
        total_weight = 0.0
        for s in sections:
            section_values = [ratings[q["code"]] for q in s.get("questions", []) if q["code"] in ratings]
            if not section_values:
                continue
            weight = float(s.get("weight", 1))
            weighted_sum += weight * (sum(section_values) / len(section_values))
            total_weight += weight
        score = weighted_sum / total_weight if total_weight else 0.0
    else:
        score = sum(v for _, _, v in values) / len(values)
    return round(float(score), 2)


def compute_is_problem(template: Optional[RatingTemplate], score: float, attendance: float) -> bool:
    score_below = template.problem_score_below if template else LEGACY_PROBLEM_SCORE_BELOW
    attendance_below = template.problem_attendance_below if template else LEGACY_PROBLEM_ATTENDANCE_BELOW
    return bool(score < score_below or attendance < attendance_below)


def validate_ratings(template: RatingTemplate, ratings: dict, lesson_type: Optional[str] = None) -> None:
    expected = question_codes(template, lesson_type)
    missing = [code for code in expected if code not in ratings]
    extra = [code for code in ratings if code not in expected]
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"не заполнены: {', '.join(missing)}")
        if extra:
            parts.append(f"нет в справочнике: {', '.join(extra)}")
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Оценки не соответствуют справочнику {template.academic_year}, вид занятия «{lesson_type or '—'}» ({'; '.join(parts)})",
        )

    for code, value in ratings.items():
        if isinstance(value, bool) or not isinstance(value, int) or not (template.scale_min <= value <= template.scale_max):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Оценка {code} должна быть целым числом от {template.scale_min} до {template.scale_max}",
            )


def get_template(db: Session, academic_year: Optional[str]) -> Optional[RatingTemplate]:
    if not academic_year:
        return None
    return db.query(RatingTemplate).filter(RatingTemplate.academic_year == academic_year).first()


def require_template(db: Session, academic_year: str) -> RatingTemplate:
    template = get_template(db, academic_year)
    if not template:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Для учебного года {academic_year} не настроен справочник вопросов",
        )
    return template


def get_score_thresholds(db: Session, academic_years: set[str]) -> dict[str, float]:
    years = [year for year in academic_years if year]
    if not years:
        return {}
    rows = db.query(RatingTemplate.academic_year, RatingTemplate.problem_score_below).filter(
        RatingTemplate.academic_year.in_(years)
    ).all()
    return {year: float(threshold) for year, threshold in rows}


def ensure_rating_setup(engine) -> None:
    """Стартовая миграция: колонка records.is_problem, справочники для годов с записями
    и утверждённые справочники (OFFICIAL_TEMPLATES), если их ещё нет."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS academic_years (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(20) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        if "records" in tables:
            columns = {c["name"] for c in inspector.get_columns("records")}
            if "is_problem" not in columns:
                conn.execute(text("ALTER TABLE records ADD COLUMN is_problem TINYINT(1) NOT NULL DEFAULT 0"))
                conn.execute(
                    text("UPDATE records SET is_problem = (score < :s OR attendance < :a)"),
                    {"s": LEGACY_PROBLEM_SCORE_BELOW, "a": LEGACY_PROBLEM_ATTENDANCE_BELOW},
                )
                logger.info("records.is_problem added and backfilled")

        # Стандартные 17 вопросов — это вопросы 2025-2026. Ими заполняются только годы,
        # по которым уже есть записи; новые годы администратор настраивает сам.
        years: set[str] = set()
        if "records" in tables:
            years.update(conn.execute(text("SELECT DISTINCT academic_year FROM records")).scalars().all())
        existing = set(conn.execute(text("SELECT academic_year FROM rating_templates")).scalars().all())
        to_seed = {year: default_template_fields for year in years if year and year not in existing}
        for year, factory in OFFICIAL_TEMPLATES.items():
            if year not in existing:
                to_seed[year] = factory
                conn.execute(text("INSERT IGNORE INTO academic_years (name) VALUES (:name)"), {"name": year})

    if not to_seed:
        return

    from database import SessionLocal

    db = SessionLocal()
    try:
        for year, factory in sorted(to_seed.items()):
            db.add(RatingTemplate(academic_year=year, updated_by="system", **factory()))
            try:
                db.commit()
                logger.info("Seeded rating template for %s", year)
            except IntegrityError:
                db.rollback()
    finally:
        db.close()
