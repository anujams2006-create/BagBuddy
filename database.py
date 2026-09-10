import sqlite3
import os
from werkzeug.security import generate_password_hash, check_password_hash


# ============================================================
# DATABASE CONFIGURATION
# ============================================================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

DATABASE_DIR = os.path.join(BASE_DIR, "instance")

DATABASE = os.path.join(
    DATABASE_DIR,
    "bagbuddy.db"
)


# ============================================================
# CREATE DATABASE DIRECTORY
# ============================================================

def ensure_database_directory():

    os.makedirs(
        DATABASE_DIR,
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

            bag_type TEXT,

            weight_limit REAL DEFAULT 7,

            created_at TIMESTAMP
                DEFAULT CURRENT_TIMESTAMP,

            FOREIGN KEY(user_id)
                REFERENCES users(id)

        )
    """)


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
    weight_limit
):

    connection = get_db()

    cursor = connection.cursor()

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
            weight_limit
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            weight_limit
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

    trips = cursor.fetchall()

    connection.close()

    return trips


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

    connection.close()