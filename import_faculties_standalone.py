#!/usr/bin/env python3
"""
Import linked faculty data from remote nitro database to local krk_monitoring.

Relationship chain in nitro:
faculties -> cafedras -> profession_cafedra -> specializations -> groups

Run this script directly on the host machine.
"""

import sys

try:
    import pymysql
except ImportError:
    print("\n✗ Error: pymysql not installed")
    print("\nInstall it with:")
    print("  pip install --break-system-packages pymysql")
    sys.exit(1)


REMOTE_CONFIG = {
    "host": "127.0.0.1",
    "port": 6080,
    "user": "readonly_platon",
    "password": "KazUTB2023@",
    "database": "nitro",
}

LOCAL_CONFIG = {
    "host": "localhost",
    "port": 3307,
    "user": "root",
    "password": "password",
    "database": "krk_monitoring",
}


def fetch_remote_data():
    remote_conn = pymysql.connect(**REMOTE_CONFIG, connect_timeout=5)
    remote_cursor = remote_conn.cursor(pymysql.cursors.DictCursor)

    remote_cursor.execute(
        """
        SELECT FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN
        FROM faculties
        ORDER BY FacultyID
        """
    )
    faculties = remote_cursor.fetchall()

    remote_cursor.execute(
        """
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
        ORDER BY s.id
        """
    )
    specializations = remote_cursor.fetchall()

    remote_cursor.execute(
        """
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
        ORDER BY lastname_ru, firstname_ru, patronymic_ru, lastname, firstname, patronymic
        """
    )
    tutors = remote_cursor.fetchall()

    remote_cursor.execute(
        """
        SELECT
            g.groupID,
            g.name,
            CASE
                WHEN s.id IS NULL THEN NULL
                ELSE g.specializationID
            END AS specializationID,
            g.specializationID AS sourceSpecializationID,
            g.stateID
        FROM `groups` g
        LEFT JOIN specializations s ON s.id = g.specializationID
        ORDER BY g.groupID
        """
    )
    groups = remote_cursor.fetchall()

    remote_conn.close()
    return faculties, specializations, groups, tutors


def create_local_tables(local_cursor):
    local_cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
    local_cursor.execute("DROP TABLE IF EXISTS `groups`")
    local_cursor.execute("DROP TABLE IF EXISTS specializations")
    local_cursor.execute("DROP TABLE IF EXISTS tutors")
    local_cursor.execute("DROP TABLE IF EXISTS faculties")

    local_cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS faculties (
            FacultyID INT PRIMARY KEY,
            facultyNameRU VARCHAR(255),
            facultyNameKZ VARCHAR(255),
            facultyNameEN VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """
    )

    local_cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS specializations (
            id INT PRIMARY KEY,
            prof_caf_id INT,
            faculty_id INT NOT NULL,
            nameru VARCHAR(256),
            namekz VARCHAR(256),
            nameen VARCHAR(256),
            specializationCode VARCHAR(16),
            is_default TINYINT(1) DEFAULT 0,
            deleted DATETIME NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_specializations_faculty_id (faculty_id),
            CONSTRAINT fk_specializations_faculty
                FOREIGN KEY (faculty_id) REFERENCES faculties(FacultyID)
                ON UPDATE CASCADE
                ON DELETE RESTRICT
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """
    )

    local_cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS tutors (
            tutor_id INT PRIMARY KEY,
            full_name VARCHAR(512) NOT NULL,
            lastname_ru VARCHAR(128),
            firstname_ru VARCHAR(128),
            patronymic_ru VARCHAR(128),
            lastname VARCHAR(128),
            firstname VARCHAR(128),
            patronymic VARCHAR(128),
            has_access TINYINT(1) DEFAULT 1,
            work_status INT DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_tutors_full_name (full_name(191))
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """
    )

    local_cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS `groups` (
            groupID INT PRIMARY KEY,
            name VARCHAR(256),
            specializationID INT NULL,
            sourceSpecializationID INT NOT NULL,
            stateID INT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            KEY idx_groups_specializationID (specializationID),
            CONSTRAINT fk_groups_specialization
                FOREIGN KEY (specializationID) REFERENCES specializations(id)
                ON UPDATE CASCADE
                ON DELETE SET NULL
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
        """
    )


def clear_local_tables(local_cursor):
    local_cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
    local_cursor.execute("TRUNCATE TABLE `groups`")
    local_cursor.execute("TRUNCATE TABLE specializations")
    local_cursor.execute("TRUNCATE TABLE tutors")
    local_cursor.execute("TRUNCATE TABLE faculties")
    local_cursor.execute("SET FOREIGN_KEY_CHECKS = 1")


def _first_non_empty(*values):
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _compose_full_name(tutor):
    ru_parts = [
        _first_non_empty(tutor.get("lastname_ru")),
        _first_non_empty(tutor.get("firstname_ru")),
        _first_non_empty(tutor.get("patronymic_ru")),
    ]
    ru_name = " ".join(part for part in ru_parts if part)
    if ru_name:
        return ru_name

    generic_parts = [
        _first_non_empty(tutor.get("lastname")),
        _first_non_empty(tutor.get("firstname")),
        _first_non_empty(tutor.get("patronymic")),
    ]
    generic_name = " ".join(part for part in generic_parts if part)
    if generic_name:
        return generic_name

    return f"Tutor #{tutor['tutor_id']}"


def import_data(local_cursor, faculties, specializations, groups, tutors):
    faculty_sql = (
        "INSERT INTO faculties (FacultyID, facultyNameRU, facultyNameKZ, facultyNameEN) "
        "VALUES (%s, %s, %s, %s)"
    )
    for row in faculties:
        local_cursor.execute(
            faculty_sql,
            (row["FacultyID"], row["facultyNameRU"], row["facultyNameKZ"], row["facultyNameEN"]),
        )

    specialization_sql = (
        "INSERT INTO specializations "
        "(id, prof_caf_id, faculty_id, nameru, namekz, nameen, specializationCode, is_default, deleted) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)"
    )
    for row in specializations:
        local_cursor.execute(
            specialization_sql,
            (
                row["id"],
                row["prof_caf_id"],
                row["faculty_id"],
                row["nameru"],
                row["namekz"],
                row["nameen"],
                row["specializationCode"],
                row["is_default"],
                row["deleted"],
            ),
        )

    tutors_sql = (
        "INSERT INTO tutors "
        "(tutor_id, full_name, lastname_ru, firstname_ru, patronymic_ru, lastname, firstname, patronymic, has_access, work_status) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    )
    for row in tutors:
        local_cursor.execute(
            tutors_sql,
            (
                row["tutor_id"],
                _compose_full_name(row),
                row["lastname_ru"],
                row["firstname_ru"],
                row["patronymic_ru"],
                row["lastname"],
                row["firstname"],
                row["patronymic"],
                row["has_access"],
                row["work_status"],
            ),
        )

    groups_sql = (
        "INSERT INTO `groups` (groupID, name, specializationID, sourceSpecializationID, stateID) "
        "VALUES (%s, %s, %s, %s, %s)"
    )
    for row in groups:
        local_cursor.execute(
            groups_sql,
            (
                row["groupID"],
                row["name"],
                row["specializationID"],
                row["sourceSpecializationID"],
                row["stateID"],
            ),
        )


def print_summary(local_cursor):
    local_cursor.execute("SELECT COUNT(*) FROM faculties")
    faculties_count = local_cursor.fetchone()[0]

    local_cursor.execute("SELECT COUNT(*) FROM specializations")
    specializations_count = local_cursor.fetchone()[0]

    local_cursor.execute("SELECT COUNT(*) FROM tutors")
    tutors_count = local_cursor.fetchone()[0]

    local_cursor.execute(
        "SELECT COUNT(*) FROM specializations WHERE is_default = 0 AND deleted IS NULL"
    )
    active_non_default_specializations_count = local_cursor.fetchone()[0]

    local_cursor.execute("SELECT COUNT(*) FROM `groups`")
    groups_count = local_cursor.fetchone()[0]

    local_cursor.execute("SELECT COUNT(*) FROM `groups` WHERE specializationID IS NULL")
    unlinked_groups_count = local_cursor.fetchone()[0]

    print("\n7. Verification summary:")
    print(f"   ✓ Faculties: {faculties_count}")
    print(f"   ✓ Specializations: {specializations_count}")
    print(f"   ✓ Tutors (has_access=1, any work_status): {tutors_count}")
    print(f"   ✓ Active non-default specializations: {active_non_default_specializations_count}")
    print(f"   ✓ Groups: {groups_count}")
    print(f"   ✓ Groups without valid specialization link: {unlinked_groups_count}")

    print("\n8. Sample linked rows:")
    local_cursor.execute(
        """
        SELECT
            f.facultyNameRU,
            s.nameru AS specialization_name,
            g.name AS group_name
        FROM faculties f
        JOIN specializations s ON s.faculty_id = f.FacultyID
            AND s.is_default = 0
            AND s.deleted IS NULL
        LEFT JOIN `groups` g ON g.specializationID = s.id
        ORDER BY f.FacultyID, s.id, g.groupID
        LIMIT 10
        """
    )
    for faculty_name, specialization_name, group_name in local_cursor.fetchall():
        print(f"   - {faculty_name} -> {specialization_name} -> {group_name}")


def main():
    print("=" * 60)
    print("Nitro Linked Data Import Utility")
    print("=" * 60)

    print("\n1. Connecting to remote database (nitro via SSH tunnel)...")
    faculties, specializations, groups, tutors = fetch_remote_data()
    print("   ✓ Connected and fetched linked source data")
    print(f"   ✓ Faculties fetched: {len(faculties)}")
    print(f"   ✓ Specializations fetched: {len(specializations)}")
    print(f"   ✓ Tutors fetched (has_access=1): {len(tutors)}")
    print(f"   ✓ Groups fetched: {len(groups)}")

    print("\n2. Connecting to local database (krk_monitoring)...")
    local_conn = pymysql.connect(**LOCAL_CONFIG, connect_timeout=5)
    local_cursor = local_conn.cursor()
    print("   ✓ Connected to local database")

    print("\n3. Creating linked local tables...")
    create_local_tables(local_cursor)
    print("   ✓ Tables ready: faculties, specializations, tutors, groups")

    print("\n4. Clearing previous imported data...")
    clear_local_tables(local_cursor)
    print("   ✓ Old data cleared")

    print("\n5. Importing linked data...")
    import_data(local_cursor, faculties, specializations, groups, tutors)
    local_conn.commit()
    print("   ✓ Linked data imported")

    print("\n6. Restoring foreign key checks...")
    local_cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
    print("   ✓ Foreign key checks enabled")

    print_summary(local_cursor)
    local_conn.close()

    print("\n" + "=" * 60)
    print("✓ Linked import completed successfully")
    print("=" * 60)


try:
    main()
except Exception as e:
    print(f"\n✗ Error: {type(e).__name__}")
    print(f"  {str(e)}")
    print("\nTroubleshooting:")
    print("- Ensure SSH tunnel is running: ssh -p 22 -N -L 6080:localhost:3306 admplaton@10.0.1.23")
    print("- Ensure local MySQL is running: docker-compose up -d db")
    print("- Verify local MySQL is exposed on port 3307 in docker-compose.dev.yml")
    sys.exit(1)
