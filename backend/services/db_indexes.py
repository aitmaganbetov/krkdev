"""Индексы под реальные запросы и удаление дублирующих индексов (выполняется при старте, идемпотентно).

create_all создаёт индексы только вместе с новой таблицей, поэтому индексы существующих таблиц
добавляются здесь. Дублирующий индекс удаляется только после того, как создан покрывающий его.
"""
import logging

from sqlalchemy import inspect, text

logger = logging.getLogger(__name__)

# (таблица, имя, столбцы) — запросы, которые их используют, указаны в комментариях
INDEXES = (
    # Занятия дня: lessons_for_date и занятия аудитории (QR-скан, проверки декана по камерам)
    ("schedule_lessons", "ix_schedule_lessons_day", ("study_year", "term", "week_day", "platonus_auditory_id")),
    # Преподаватели семестра: назначения комитета (committee_assignments)
    ("schedule_lessons", "ix_schedule_lessons_term_tutor", ("study_year", "term", "tutor_id")),
    # Факультет и ОП группы по названию: контекст расписания, список студентов
    ("groups", "ix_groups_name", ("name",)),
    ("platonus_students", "ix_platonus_students_group", ("group_name",)),
    # Записи КРК: список и дашборды фильтруют по статусу/автору/году и сортируют по дате
    ("records", "ix_records_status_datetime", ("status", "datetime")),
    ("records", "ix_records_submitted_by", ("submitted_by", "datetime")),
    ("records", "ix_records_year_status", ("academic_year", "status")),
    # Посещаемость студента по датам, уведомления пользователя, «Мои нарушения»
    ("lesson_attendance", "ix_lesson_attendance_student_date", ("student_id", "lesson_date")),
    ("notifications", "ix_notifications_recipient_created", ("recipient", "created_at")),
    ("violations", "ix_violations_teacher_date", ("teacher_login", "violation_date")),
)

# (таблица, лишний индекс, индекс, который его покрывает: PRIMARY или из INDEXES / уникальный)
REDUNDANT = (
    ("audit_logs", "idx_audit_timestamp", "ix_audit_logs_timestamp"),
    ("audit_logs", "idx_audit_action", "ix_audit_logs_action"),
    ("audit_logs", "idx_audit_actor", "ix_audit_logs_actor"),
    ("audit_logs", "idx_audit_outcome", "ix_audit_logs_outcome"),
    ("audit_logs", "ix_audit_logs_id", "PRIMARY"),
    ("records", "ix_records_id", "PRIMARY"),
    ("peer_visits", "ix_peer_visits_id", "PRIMARY"),
    ("lesson_attendance", "ix_lesson_attendance_lesson_id", "uq_lesson_attendance"),
    ("lesson_attendance", "ix_lesson_attendance_student_id", "ix_lesson_attendance_student_date"),
    ("notifications", "ix_notifications_recipient", "ix_notifications_recipient_created"),
    ("violations", "idx_violations_teacher_login", "ix_violations_teacher_date"),
)


def ensure_performance_indexes(engine) -> None:
    with engine.begin() as conn:
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        existing: dict[str, set[str]] = {}

        def names(table: str) -> set[str]:
            if table not in existing:
                found = {ix["name"] for ix in inspector.get_indexes(table)}
                found |= {uc["name"] for uc in inspector.get_unique_constraints(table)}
                existing[table] = found | {"PRIMARY"}
            return existing[table]

        for table, name, columns in INDEXES:
            if table not in tables or name in names(table):
                continue
            try:
                conn.execute(text(f"ALTER TABLE `{table}` ADD INDEX `{name}` ({', '.join(f'`{c}`' for c in columns)})"))
                existing[table].add(name)
            except Exception:
                logger.exception("Не удалось создать индекс %s.%s", table, name)

        for table, name, covered_by in REDUNDANT:
            if table not in tables or name not in names(table) or covered_by not in names(table):
                continue
            try:
                conn.execute(text(f"ALTER TABLE `{table}` DROP INDEX `{name}`"))
                existing[table].discard(name)
            except Exception:
                logger.exception("Не удалось удалить индекс %s.%s", table, name)
