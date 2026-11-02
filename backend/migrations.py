"""
Migration utilities for importing data from remote to local database
"""
import pymysql
from typing import Dict
import os
from sqlalchemy import inspect, text
from database import engine

def _require_env(name: str) -> str:
    value = os.getenv(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} is required for remote import')
    return value


def get_remote_config() -> Dict:
    return {
        'host': os.getenv('READONLY_DB_HOST', 'host.docker.internal'),
        'port': int(os.getenv('READONLY_DB_PORT', '6080')),
        'user': _require_env('READONLY_DB_USER'),
        'password': _require_env('READONLY_DB_PASSWORD'),
        'database': os.getenv('READONLY_DB_NAME', 'nitro')
    }

def _first_non_empty(*values) -> str:
    for value in values:
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _compose_tutor_name(tutor: dict) -> str:
    # Каждая часть ФИО — русская, а если её нет, то из основного поля: в Platonus у многих
    # заполнены фамилия и имя на русском, а отчество — только в основном поле
    name = " ".join(filter(None, (
        _first_non_empty(tutor.get(f"{part}_ru"), tutor.get(part))
        for part in ("lastname", "firstname", "patronymic")
    )))
    return name or f"Tutor #{tutor['tutor_id']}"


def ensure_settings_table(engine) -> None:
    """Настройки системы (LDAP, AI, камеры, ректор, учебный год): ключ → значение."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS system_settings (
                `key` VARCHAR(128) PRIMARY KEY,
                value_text LONGTEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))


def ensure_catalog_tables(engine) -> None:
    """Стартовая миграция справочников Platonus: таблица кафедр, привязка к кафедре
    у образовательных программ и преподавателей, логин и почта преподавателя (для уведомлений)
    и логин преподавателя в нарушении (заполняются при синхронизации и фиксации нарушения)."""
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cafedras (
                cafedraID INT NOT NULL PRIMARY KEY,
                cafedraNameRU VARCHAR(255) NULL,
                cafedraNameKZ VARCHAR(255) NULL,
                cafedraNameEN VARCHAR(255) NULL,
                FacultyID INT NULL,
                used TINYINT(1) NULL,
                created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
                KEY idx_cafedras_faculty (FacultyID)
            ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """))
        inspector = inspect(conn)
        tables = set(inspector.get_table_names())
        for table in ("specializations", "tutors"):
            if table not in tables:
                continue
            columns = {c["name"] for c in inspector.get_columns(table)}
            if "cafedra_id" not in columns:
                conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN cafedra_id INT NULL, ADD KEY idx_{table}_cafedra (cafedra_id)"))
        if "tutors" in tables:
            columns = {c["name"] for c in inspector.get_columns("tutors")}
            if "login" not in columns:
                conn.execute(text("ALTER TABLE tutors ADD COLUMN login VARCHAR(255) NULL, ADD KEY idx_tutors_login (login)"))
            if "email" not in columns:
                conn.execute(text("ALTER TABLE tutors ADD COLUMN email VARCHAR(255) NULL"))
            # ИИН — для входа по ЭЦП (сопоставление с сертификатом НУЦ); наружу через API не отдаётся
            if "iin" not in columns:
                conn.execute(text("ALTER TABLE tutors ADD COLUMN iin CHAR(12) NULL, ADD KEY idx_tutors_iin (iin)"))
        # Декан факультета и заведующий кафедрой (faculties.facultyDean, cafedras.cafedraManager в Platonus) —
        # для должности в составе комитета КРК
        if "faculties" in tables and "dean_tutor_id" not in {c["name"] for c in inspector.get_columns("faculties")}:
            conn.execute(text("ALTER TABLE faculties ADD COLUMN dean_tutor_id INT NULL"))
        if "manager_tutor_id" not in {c["name"] for c in inspect(conn).get_columns("cafedras")}:
            conn.execute(text("ALTER TABLE cafedras ADD COLUMN manager_tutor_id INT NULL"))
        if "violations" in tables:
            columns = {c["name"] for c in inspector.get_columns("violations")}
            if "teacher_login" not in columns:
                conn.execute(text("ALTER TABLE violations ADD COLUMN teacher_login VARCHAR(255) NULL, ADD KEY idx_violations_teacher_login (teacher_login)"))
            if "faculty_id" not in columns:
                conn.execute(text("ALTER TABLE violations ADD COLUMN faculty_id INT NULL, ADD KEY idx_violations_faculty (faculty_id)"))
            # Чек-лист ситуационного видеомониторинга (форма 16-02)
            for name, definition in VIOLATION_CHECKLIST_COLUMNS.items():
                if name not in columns:
                    conn.execute(text(f"ALTER TABLE violations ADD COLUMN {name} {definition}"))


VIOLATION_CHECKLIST_COLUMNS = {
    "checklist": "JSON NULL",
    "camera": "VARCHAR(255) NOT NULL DEFAULT ''",
    "scheduled_time": "VARCHAR(50) NOT NULL DEFAULT ''",
    "observed_from": "VARCHAR(5) NOT NULL DEFAULT ''",
    "observed_to": "VARCHAR(5) NOT NULL DEFAULT ''",
    "group_name": "VARCHAR(500) NOT NULL DEFAULT ''",
    "schedule_check": "TEXT NULL",
    "repeat_observation_at": "DATETIME NULL",
    "onsite_verification": "VARCHAR(255) NOT NULL DEFAULT ''",
    "tech_ticket": "VARCHAR(100) NOT NULL DEFAULT ''",
    # Подпись нарушения ЭЦП
    "document_hash": "VARCHAR(64) NULL",
    "signed_at": "DATETIME NULL",
    "signature_cms": "LONGTEXT NULL",
    "signature_info": "JSON NULL",
    "verify_token": "VARCHAR(32) NULL, ADD UNIQUE KEY uq_violations_verify (verify_token)",
}


# system_settings: ректор из Platonus (tutors.tutor_id)
RECTOR_SETTING_KEY = "platonus_rector_tutor_id"


# Работающие преподаватели в Platonus: есть доступ и запись не удалена.
# deleted = 1 — уволенные (у них заполнена termination_date); work_status для отбора не подходит:
# у большинства работающих он не указан (3 — «--------»).
ACTIVE_TUTORS_WHERE = "has_access = 1 AND deleted = 0"


def sync_platonus_catalogs() -> Dict:
    """Atomically refresh the local catalog snapshot from the read-only Platonus DB."""
    remote_conn = None
    try:
        remote_conn = pymysql.connect(
            **get_remote_config(),
            connect_timeout=5,
            read_timeout=30,
            cursorclass=pymysql.cursors.DictCursor,
        )
        with remote_conn.cursor() as cursor:
            cursor.execute("""
                SELECT FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN, facultyDean AS dean_tutor_id
                FROM faculties
                ORDER BY FacultyID
            """)
            faculties = cursor.fetchall()

            # Ректор (university.rectorID) — подписант приказов по умолчанию (состав комитета КРК)
            cursor.execute("SELECT rectorID FROM university LIMIT 1")
            rector = cursor.fetchone()

            cursor.execute("""
                SELECT cafedraID, cafedraNameRU, cafedraNameKZ, cafedraNameEN, FacultyID, used, cafedraManager AS manager_tutor_id
                FROM cafedras
                ORDER BY cafedraID
            """)
            cafedras = cursor.fetchall()

            cursor.execute("""
                SELECT
                    s.id,
                    s.prof_caf_id,
                    c.FacultyID AS faculty_id,
                    pc.cafedraID AS cafedra_id,
                    s.nameru,
                    s.namekz,
                    s.nameen,
                    s.specializationCode,
                    s.is_default,
                    s.deleted
                FROM specializations s
                INNER JOIN profession_cafedra pc ON pc.id = s.prof_caf_id
                INNER JOIN cafedras c ON c.cafedraID = pc.cafedraID
                WHERE s.is_default = 0 AND s.deleted IS NULL
                ORDER BY s.id
            """)
            specializations = cursor.fetchall()

            cursor.execute("""
                SELECT
                    g.groupID,
                    g.name,
                    CASE WHEN s.id IS NULL THEN NULL ELSE g.specializationID END AS specializationID,
                    g.specializationID AS sourceSpecializationID,
                    g.stateID
                FROM `groups` g
                LEFT JOIN specializations s
                    ON s.id = g.specializationID
                    AND s.is_default = 0
                    AND s.deleted IS NULL
                ORDER BY g.groupID
            """)
            groups = cursor.fetchall()

            cursor.execute(f"""
                SELECT
                    TutorID AS tutor_id,
                    lastname_ru,
                    firstname_ru,
                    patronymic_ru,
                    lastname,
                    firstname,
                    patronymic,
                    has_access,
                    work_status,
                    NULLIF(CafedraID, 0) AS cafedra_id,
                    NULLIF(TRIM(Login), '') AS login,
                    NULLIF(TRIM(mail), '') AS email,
                    CASE WHEN TRIM(iinplt) REGEXP '^[0-9]{{12}}$' THEN TRIM(iinplt) END AS iin
                FROM tutors
                WHERE {ACTIVE_TUTORS_WHERE}
                ORDER BY TutorID
            """)
            tutors = cursor.fetchall()
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Не удалось получить справочники Platonus: {type(exc).__name__}: {exc}",
        }
    finally:
        if remote_conn is not None:
            remote_conn.close()

    try:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM `groups`"))
            conn.execute(text("DELETE FROM specializations"))
            conn.execute(text("DELETE FROM tutors"))
            conn.execute(text("DELETE FROM cafedras"))
            conn.execute(text("DELETE FROM faculties"))
            if rector and rector["rectorID"]:
                conn.execute(text("""
                    INSERT INTO system_settings (`key`, value_text) VALUES (:key, :value)
                    ON DUPLICATE KEY UPDATE value_text = VALUES(value_text)
                """), {"key": RECTOR_SETTING_KEY, "value": str(rector["rectorID"])})

            if faculties:
                conn.execute(text("""
                    INSERT INTO faculties
                        (FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN, dean_tutor_id)
                    VALUES
                        (:FacultyID, :facultyNameRU, :facultyNameKZ, :facultyNameEN, :dean_tutor_id)
                """), faculties)

            if cafedras:
                conn.execute(text("""
                    INSERT INTO cafedras
                        (cafedraID, cafedraNameRU, cafedraNameKZ, cafedraNameEN, FacultyID, used, manager_tutor_id)
                    VALUES
                        (:cafedraID, :cafedraNameRU, :cafedraNameKZ, :cafedraNameEN, :FacultyID, :used, :manager_tutor_id)
                """), cafedras)

            if specializations:
                conn.execute(text("""
                    INSERT INTO specializations
                        (id, prof_caf_id, faculty_id, cafedra_id, nameru, namekz, nameen,
                         specializationCode, is_default, deleted)
                    VALUES
                        (:id, :prof_caf_id, :faculty_id, :cafedra_id, :nameru, :namekz, :nameen,
                         :specializationCode, :is_default, :deleted)
                """), specializations)

            if tutors:
                tutor_rows = [
                    {**tutor, "full_name": _compose_tutor_name(tutor)}
                    for tutor in tutors
                ]
                conn.execute(text("""
                    INSERT INTO tutors
                        (tutor_id, full_name, lastname_ru, firstname_ru, patronymic_ru,
                         lastname, firstname, patronymic, has_access, work_status, cafedra_id, login, email, iin)
                    VALUES
                        (:tutor_id, :full_name, :lastname_ru, :firstname_ru, :patronymic_ru,
                         :lastname, :firstname, :patronymic, :has_access, :work_status, :cafedra_id, :login, :email, :iin)
                """), tutor_rows)

            if groups:
                conn.execute(text("""
                    INSERT INTO `groups`
                        (groupID, name, specializationID, sourceSpecializationID, stateID)
                    VALUES
                        (:groupID, :name, :specializationID, :sourceSpecializationID, :stateID)
                """), groups)
    except Exception as exc:
        return {
            "status": "error",
            "message": f"Не удалось обновить локальные справочники: {type(exc).__name__}: {exc}",
        }

    counts = {
        "faculties": len(faculties),
        "cafedras": len(cafedras),
        "specializations": len(specializations),
        "groups": len(groups),
        "tutors": len(tutors),
    }
    return {
        "status": "success",
        "message": "Справочники Platonus синхронизированы",
        "counts": counts,
        "count": sum(counts.values()),
    }
