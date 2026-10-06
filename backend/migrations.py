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

def import_faculties() -> Dict:
    """Import faculties from remote to local database"""
    try:
        # Connect to remote database
        remote_conn = pymysql.connect(**get_remote_config(), connect_timeout=5)
        remote_cursor = remote_conn.cursor(pymysql.cursors.DictCursor)
        
        # Fetch data
        remote_cursor.execute(
            "SELECT FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN FROM faculties"
        )
        faculties = remote_cursor.fetchall()
        remote_conn.close()
        
        # Create table in local database
        with engine.begin() as conn:
            conn.execute(text("""
            CREATE TABLE IF NOT EXISTS faculties (
                FacultyID INT PRIMARY KEY,
                facultyNameRU VARCHAR(255),
                facultyNameKZ VARCHAR(255),
                facultyNameEN VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
            """))
            
            # Clear existing data
            conn.execute(text("TRUNCATE TABLE faculties"))
            
            # Insert faculties
            for faculty in faculties:
                conn.execute(text("""
                INSERT INTO faculties (FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN)
                VALUES (:id, :ru, :kz, :en)
                """), {
                    'id': faculty['FacultyID'],
                    'ru': faculty['facultyNameRU'],
                    'kz': faculty['facultyNameKZ'],
                    'en': faculty['facultyNameEN']
                })
        
        return {
            'status': 'success',
            'message': f'Imported {len(faculties)} faculties',
            'count': len(faculties)
        }
        
    except Exception as e:
        return {
            'status': 'error',
            'message': f'{type(e).__name__}: {str(e)}'
        }


def _first_non_empty(*values) -> str:
    for value in values:
        if value is not None and str(value).strip():
            return str(value).strip()
    return ""


def _compose_tutor_name(tutor: dict) -> str:
    russian_name = " ".join(filter(None, (
        _first_non_empty(tutor.get("lastname_ru")),
        _first_non_empty(tutor.get("firstname_ru")),
        _first_non_empty(tutor.get("patronymic_ru")),
    )))
    if russian_name:
        return russian_name
    generic_name = " ".join(filter(None, (
        _first_non_empty(tutor.get("lastname")),
        _first_non_empty(tutor.get("firstname")),
        _first_non_empty(tutor.get("patronymic")),
    )))
    return generic_name or f"Tutor #{tutor['tutor_id']}"


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
                SELECT FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN
                FROM faculties
                ORDER BY FacultyID
            """)
            faculties = cursor.fetchall()

            cursor.execute("""
                SELECT
                    s.id,
                    s.prof_caf_id,
                    c.FacultyID AS faculty_id,
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

            cursor.execute("""
                SELECT
                    TutorID AS tutor_id,
                    lastname_ru,
                    firstname_ru,
                    patronymic_ru,
                    lastname,
                    firstname,
                    patronymic,
                    has_access,
                    work_status
                FROM tutors
                WHERE has_access = 1
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
            conn.execute(text("DELETE FROM faculties"))

            if faculties:
                conn.execute(text("""
                    INSERT INTO faculties
                        (FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN)
                    VALUES
                        (:FacultyID, :facultyNameRU, :facultyNameKZ, :facultyNameEN)
                """), faculties)

            if specializations:
                conn.execute(text("""
                    INSERT INTO specializations
                        (id, prof_caf_id, faculty_id, nameru, namekz, nameen,
                         specializationCode, is_default, deleted)
                    VALUES
                        (:id, :prof_caf_id, :faculty_id, :nameru, :namekz, :nameen,
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
                         lastname, firstname, patronymic, has_access, work_status)
                    VALUES
                        (:tutor_id, :full_name, :lastname_ru, :firstname_ru, :patronymic_ru,
                         :lastname, :firstname, :patronymic, :has_access, :work_status)
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


def migrate_records_submitted_by() -> Dict:
    """Add records.submitted_by column via controlled admin migration."""
    try:
        inspector = inspect(engine)
        columns = {col['name'] for col in inspector.get_columns('records')}
        if 'submitted_by' in columns:
            return {
                'status': 'ok',
                'changed': False,
                'message': 'records.submitted_by already exists'
            }

        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE records ADD COLUMN submitted_by VARCHAR(255) NULL"))

        return {
            'status': 'ok',
            'changed': True,
            'message': 'records.submitted_by column added'
        }
    except Exception as e:
        return {
            'status': 'error',
            'message': f'{type(e).__name__}: {str(e)}'
        }
