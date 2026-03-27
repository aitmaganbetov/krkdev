"""
Migration utilities for importing data from remote to local database
"""
import pymysql
from typing import Dict
import os
from sqlalchemy import text
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
