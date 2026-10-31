import sqlite3
import os
from werkzeug.security import generate_password_hash, check_password_hash


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATABASE = os.path.join(
    BASE_DIR,
    "bagbuddy.db"
)


# ============================================================
# CREATE DATABASE DIRECTORY
# ============================================================

def ensure_database_directory():
    os.makedirs(
        os.path.dirname(DATABASE),
        exist_ok=True
    )


# ============================================================
# GET DATABASE CONNECTION
# ============================================================

def get_db():

    ensure_database_directory()

    connection = sqlite3.connect(
        DATABASE
    )

    connection.row_factory = sqlite3.Row

    return connection


# ============================================================
# INITIALIZE DATABASE
# ============================================================

def init_db():

    connection = get_db()

    cursor = connection.cursor()


    # ========================================================
    # USERS TABLE
    # ========================================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            email TEXT UNIQUE NOT NULL,

            password TEXT NOT NULL,

            created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP

        )
    """)


    # ========================================================
    # TRIPS TABLE
    # ========================================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS trips (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id INTEGER NOT NULL,

            destination TEXT NOT NULL,

            start_date TEXT NOT NULL,

            end_date TEXT NOT NULL,

            travel_mode TEXT,

            trip_type TEXT,

            profile TEXT,

            adults INTEGER DEFAULT 1,

            children INTEGER DEFAULT 0,

            child_age TEXT,

            bag_type TEXT DEFAULT 'Backpack',

            weight_limit REAL DEFAULT 7,

            activities TEXT DEFAULT '[]',

            makeup TEXT DEFAULT '[]',

            toiletries TEXT DEFAULT '[]',

            shifting_items TEXT DEFAULT '[]',

            personalization TEXT DEFAULT '[]',

            packing_list TEXT DEFAULT '{}',

            created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id)
                REFERENCES users(id)
                ON DELETE CASCADE

        )
    """)

    # Check for missing columns in existing trips table (schema migration)
    cursor.execute("PRAGMA table_info(trips)")
    existing_columns = [row[1] for row in cursor.fetchall()]
    needed_columns = {
        "profile": "TEXT",
        "activities": "TEXT DEFAULT '[]'",
        "makeup": "TEXT DEFAULT '[]'",
        "toiletries": "TEXT DEFAULT '[]'",
        "shifting_items": "TEXT DEFAULT '[]'",
        "personalization": "TEXT DEFAULT '[]'",
        "packing_list": "TEXT DEFAULT '{}'",
        "weather_data": "TEXT DEFAULT '{}'",
        "travel_modes": "TEXT DEFAULT '[]'",
    }
    for col_name, col_type in needed_columns.items():
        if col_name not in existing_columns:
            cursor.execute(f"ALTER TABLE trips ADD COLUMN {col_name} {col_type}")


    # ========================================================
    # PACKING ITEMS TABLE
    # ========================================================

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS packing_items (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            trip_id INTEGER NOT NULL,

            category TEXT NOT NULL,

            item_name TEXT NOT NULL,

            quantity INTEGER DEFAULT 1,

            weight REAL DEFAULT 0,

            packed INTEGER DEFAULT 0,

            FOREIGN KEY(trip_id)
                REFERENCES trips(id)
                ON DELETE CASCADE

        )
    """)


    connection.commit()

    connection.close()


# ============================================================
# CREATE USER
# ============================================================

def create_user(
    name,
    email,
    password
):

    connection = get_db()

    cursor = connection.cursor()

    hashed_password = generate_password_hash(
        password
    )

    try:

        cursor.execute(
            """
            INSERT INTO users
            (
                name,
                email,
                password
            )

            VALUES (?, ?, ?)
            """,

            (
                name,
                email,
                hashed_password
            )
        )

        connection.commit()

        user_id = cursor.lastrowid

        connection.close()

        return user_id

    except sqlite3.IntegrityError:

        connection.close()

        return None


# ============================================================
# GET USER BY EMAIL
# ============================================================

def get_user_by_email(email):

    connection = get_db()

    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT *
        FROM users
        WHERE email = ?
        """,

        (email,)
    )

    user = cursor.fetchone()

    connection.close()

    return user


# ============================================================
# CHECK PASSWORD
# ============================================================

def verify_password(
    stored_password,
    entered_password
):

    return check_password_hash(
        stored_password,
        entered_password
    )


# ============================================================
# GET USER BY ID
# ============================================================

def get_user_by_id(user_id):

    connection = get_db()

    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT *
        FROM users
        WHERE id = ?
        """,

        (user_id,)
    )

    user = cursor.fetchone()

    connection.close()

    return user


# ============================================================
# CREATE TRIP
# ============================================================

def create_trip(
    user_id,
    destination,
    start_date,
    end_date,
    travel_mode,
    trip_type,
    profile,
    adults,
    children,
    child_age,
    bag_type,
    weight_limit,
    activities=None,
    makeup=None,
    toiletries=None,
    shifting_items=None,
    personalization=None,
    packing_list=None,
    weather_data=None,
    travel_modes=None
):
    import json

    connection = get_db()
    cursor = connection.cursor()

    modes_list = travel_modes or ([travel_mode] if travel_mode else [])

    cursor.execute(
        """
        INSERT INTO trips
        (
            user_id,
            destination,
            start_date,
            end_date,
            travel_mode,
            trip_type,
            profile,
            adults,
            children,
            child_age,
            bag_type,
            weight_limit,
            activities,
            makeup,
            toiletries,
            shifting_items,
            personalization,
            packing_list,
            weather_data,
            travel_modes
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,

        (
            user_id,
            destination,
            start_date,
            end_date,
            travel_mode,
            trip_type,
            profile,
            adults,
            children,
            child_age,
            bag_type,
            weight_limit,
            json.dumps(activities or []),
            json.dumps(makeup or []),
            json.dumps(toiletries or []),
            json.dumps(shifting_items or []),
            json.dumps(personalization or []),
            json.dumps(packing_list or {}),
            json.dumps(weather_data or {}),
            json.dumps(modes_list)
        )
    )

    connection.commit()
    trip_id = cursor.lastrowid
    connection.close()

    return trip_id


# ============================================================
# GET USER TRIPS
# ============================================================

def get_user_trips(user_id):
    import json

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT *
        FROM trips
        WHERE user_id = ?

        ORDER BY created_at DESC
        """,

        (user_id,)
    )

    rows = cursor.fetchall()
    connection.close()

    trips = []
    for r in rows:
        d = dict(r)
        if isinstance(d.get("packing_list"), str):
            try:
                d["packing_list"] = json.loads(d["packing_list"])
            except Exception:
                d["packing_list"] = {}
        if isinstance(d.get("weather_data"), str):
            try:
                d["weather_data"] = json.loads(d["weather_data"])
            except Exception:
                d["weather_data"] = {}
        if isinstance(d.get("travel_modes"), str):
            try:
                d["travel_modes"] = json.loads(d["travel_modes"])
            except Exception:
                d["travel_modes"] = []
        elif not d.get("travel_modes") and d.get("travel_mode"):
            d["travel_modes"] = [m.strip() for m in d["travel_mode"].split("+") if m.strip()]
        for col in ["activities", "makeup", "toiletries", "shifting_items", "personalization"]:
            if isinstance(d.get(col), str):
                try:
                    d[col] = json.loads(d[col])
                except Exception:
                    d[col] = []
        trips.append(d)

    return trips


# ============================================================
# GET TRIP BY ID
# ============================================================

def get_trip_by_id(trip_id, user_id):
    import json

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        SELECT *
        FROM trips
        WHERE id = ? AND user_id = ?
        """,

        (trip_id, user_id)
    )

    row = cursor.fetchone()
    connection.close()

    if not row:
        return None

    d = dict(row)
    if isinstance(d.get("packing_list"), str):
        try:
            d["packing_list"] = json.loads(d["packing_list"])
        except Exception:
            d["packing_list"] = {}
    if isinstance(d.get("weather_data"), str):
        try:
            d["weather_data"] = json.loads(d["weather_data"])
        except Exception:
            d["weather_data"] = {}
    if isinstance(d.get("travel_modes"), str):
        try:
            d["travel_modes"] = json.loads(d["travel_modes"])
        except Exception:
            d["travel_modes"] = []
    elif not d.get("travel_modes") and d.get("travel_mode"):
        d["travel_modes"] = [m.strip() for m in d["travel_mode"].split("+") if m.strip()]
    for col in ["activities", "makeup", "toiletries", "shifting_items", "personalization"]:
        if isinstance(d.get(col), str):
            try:
                d[col] = json.loads(d[col])
            except Exception:
                d[col] = []

    return d


# ============================================================
# UPDATE TRIP PACKING LIST
# ============================================================

def update_trip_packing_list(trip_id, user_id, packing_list):
    import json

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        UPDATE trips
        SET packing_list = ?
        WHERE id = ? AND user_id = ?
        """,

        (
            json.dumps(packing_list or {}),
            trip_id,
            user_id
        )
    )

    connection.commit()
    affected = cursor.rowcount
    connection.close()

    return affected > 0


# ============================================================
# DELETE TRIP
# ============================================================

def delete_trip(
    trip_id,
    user_id
):

    connection = get_db()
    cursor = connection.cursor()

    cursor.execute(
        """
        DELETE FROM trips

        WHERE id = ?
        AND user_id = ?
        """,

        (
            trip_id,
            user_id
        )
    )

    connection.commit()
    affected = cursor.rowcount
    connection.close()

    return affected > 0