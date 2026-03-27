#!/usr/bin/env python3
"""
Import faculties from remote nitro database to local krk_monitoring database
"""
import pymysql
from urllib.parse import quote_plus
import os

# Remote database config
REMOTE_CONFIG = {
    'host': 'host.docker.internal',
    'port': 6080,
    'user': 'readonly_platon',
    'password': 'KazUTB2023@',
    'database': 'nitro'
}

# Local database config from env
LOCAL_CONFIG = {
    'host': os.getenv('DB_HOST', 'db'),
    'port': int(os.getenv('DB_PORT', '3306')),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', 'password'),
    'database': os.getenv('DB_NAME', 'krk_monitoring')
}

def import_faculties():
    """Fetch faculties from remote and insert to local database"""
    try:
        # Connect to remote database
        print("Connecting to remote database...")
        remote_conn = pymysql.connect(**REMOTE_CONFIG)
        remote_cursor = remote_conn.cursor(pymysql.cursors.DictCursor)
        
        # Fetch data
        print("Fetching faculties from remote...")
        remote_cursor.execute(
            "SELECT FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN FROM faculties"
        )
        faculties = remote_cursor.fetchall()
        remote_conn.close()
        
        print(f"✓ Fetched {len(faculties)} faculties")
        
        # Connect to local database
        print("Connecting to local database...")
        local_conn = pymysql.connect(**LOCAL_CONFIG)
        local_cursor = local_conn.cursor()
        
        # Create table if not exists
        create_table_sql = """
        CREATE TABLE IF NOT EXISTS faculties (
            FacultyID INT PRIMARY KEY,
            facultyNameRU VARCHAR(255),
            facultyNameKZ VARCHAR(255),
            facultyNameEN VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """
        local_cursor.execute(create_table_sql)
        print("✓ Table created/verified")
        
        # Clear existing data
        local_cursor.execute("TRUNCATE TABLE faculties")
        print("✓ Cleared existing data")
        
        # Insert faculties
        insert_sql = """
        INSERT INTO faculties (FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN)
        VALUES (%s, %s, %s, %s)
        """
        
        for faculty in faculties:
            local_cursor.execute(insert_sql, (
                faculty['FacultyID'],
                faculty['facultyNameRU'],
                faculty['facultyNameKZ'],
                faculty['facultyNameEN']
            ))
        
        local_conn.commit()
        print(f"✓ Inserted {len(faculties)} faculties to local database")
        
        # Verify
        local_cursor.execute("SELECT COUNT(*) as count FROM faculties")
        result = local_cursor.fetchone()
        print(f"✓ Verification: {result[0]} records in local faculties table")
        
        # Show samples
        local_cursor.execute("SELECT * FROM faculties LIMIT 2")
        samples = local_cursor.fetchall()
        print("\nFirst 2 faculties:")
        for row in samples:
            print(f"  ID: {row[0]}, RU: {row[1]}, KZ: {row[2]}, EN: {row[3]}")
        
        local_conn.close()
        
    except Exception as e:
        print(f"✗ Error: {type(e).__name__}: {e}")
        return False
    
    return True

if __name__ == '__main__':
    import_faculties()
