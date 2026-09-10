# app.py
from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash
)

from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

import sqlite3
import traceback

from packing_engine import generate_packing_list


# =========================================================
# APP CONFIGURATION
# =========================================================

app = Flask(__name__)

app.secret_key = "bagbuddy_secret_key_change_later"

DATABASE = "bagbuddy.db"


# =========================================================
# DATABASE
# =========================================================

def get_db():

    conn = sqlite3.connect(DATABASE)

    conn.row_factory = sqlite3.Row

    return conn


def init_db():

    conn = get_db()

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            name TEXT NOT NULL,

            email TEXT UNIQUE NOT NULL,

            password TEXT NOT NULL

        )
    """)

    conn.commit()

    conn.close()


# =========================================================
# HOME
# =========================================================

@app.route("/")
def index():

    return render_template("index.html")


# =========================================================
# SIGNUP
# =========================================================

@app.route("/signup", methods=["GET", "POST"])
def signup():

    if request.method == "POST":

        name = request.form.get(
            "name",
            ""
        ).strip()

        email = request.form.get(
            "email",
            ""
        ).strip().lower()

        password = request.form.get(
            "password",
            ""
        )

        if not name or not email or not password:

            flash(
                "Please fill all fields.",
                "error"
            )

            return redirect(
                url_for("signup")
            )

        hashed_password = generate_password_hash(
            password
        )

        conn = get_db()

        try:

            conn.execute(
                """
                INSERT INTO users
                (name, email, password)
                VALUES (?, ?, ?)
                """,
                (
                    name,
                    email,
                    hashed_password
                )
            )

            conn.commit()

        except sqlite3.IntegrityError:

            conn.close()

            flash(
                "An account with this email already exists.",
                "error"
            )

            return redirect(
                url_for("login")
            )

        conn.close()

        flash(
            "Account created successfully!",
            "success"
        )

        return redirect(
            url_for("login")
        )

    return render_template(
        "signup.html"
    )


# =========================================================
# LOGIN
# =========================================================

@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "POST":

        email = request.form.get(
            "email",
            ""
        ).strip().lower()

        password = request.form.get(
            "password",
            ""
        )

        conn = get_db()

        user = conn.execute(
            """
            SELECT *
            FROM users
            WHERE email = ?
            """,
            (email,)
        ).fetchone()

        conn.close()

        if user and check_password_hash(
            user["password"],
            password
        ):

            session["user_id"] = user["id"]

            session["user_name"] = user["name"]

            session["user_email"] = user["email"]

            flash(
                f"Welcome back, {user['name']}!",
                "success"
            )

            return redirect(
                url_for("dashboard")
            )

        flash(
            "Invalid email or password.",
            "error"
        )

    return render_template(
        "login.html"
    )


# =========================================================
# LOGOUT
# =========================================================

@app.route("/logout")
def logout():

    session.clear()

    flash(
        "You have been logged out.",
        "success"
    )

    return redirect(
        url_for("index")
    )


# =========================================================
# DASHBOARD
# IMPORTANT: ONLY ONE DASHBOARD ROUTE
# =========================================================

@app.route("/dashboard")
def dashboard():

    if "user_id" not in session:

        flash(
            "Please login first.",
            "error"
        )

        return redirect(
            url_for("login")
        )

    return render_template(
        "dashboard_home.html",

        user_name=session.get(
            "user_name",
            "User"
        ),

        trip=session.get(
            "current_trip"
        ),

        packing_list=session.get(
            "current_packing_list"
        )
    )


# =========================================================
# TRIP SETUP
# =========================================================

@app.route(
    "/trip-setup",
    methods=["GET", "POST"]
)


def trip_setup():

    # -----------------------------------------------------
    # LOGIN CHECK
    # -----------------------------------------------------

    if "user_id" not in session:

        flash(
            "Please login first.",
            "error"
        )

        return redirect(
            url_for("login")
        )
    # -----------------------------------------------------
    # DISPLAY PAGE
    # -----------------------------------------------------

    if request.method == "GET":

        return render_template(
            "trip_setup.html"
        )
    # =====================================================
    # BASIC TRIP INFORMATION
    # =====================================================

    destination = request.form.get(
        "destination",
        ""
    ).strip()

    start_date = request.form.get(
        "start_date",
        ""
    )

    end_date = request.form.get(
        "end_date",
        ""
    )

    travel_mode = request.form.get(
        "travel_mode",
        ""
    ).strip()

    trip_type = request.form.get(
        "trip_type",
        ""
    ).strip()

    profile = request.form.get(
        "profile",
        ""
    ).strip()

    # =====================================================
    # MULTI SELECT OPTIONS
    # =====================================================

    activities = request.form.getlist(
        "activities"
    )

    # Personalisation choices are optional.  They are validated server-side so
    # hidden client-side options cannot accidentally affect a packing list.
    personalization = request.form.getlist("personalization")
    makeup = request.form.getlist("makeup")

    toiletries = request.form.getlist(
        "toiletries"
    )

    shifting_items = request.form.getlist(
        "shifting_items"
    )

    # =====================================================
    # TRAVELLERS
    # =====================================================

    adults_raw = request.form.get(
        "adults",
        "1"
    )

    children_raw = request.form.get(
        "children",
        "0"
    )

    child_age = request.form.get(
        "child_age",
        ""
    )

    # =====================================================
    # BAG INFORMATION
    # =====================================================

    bag_type = request.form.get(
        "bag_type",
        "Backpack"
    )

    weight_limit_raw = request.form.get(
        "weight_limit",
        "7"
    )

    # =====================================================
    # VALIDATION
    # =====================================================

    if not destination:

        flash(
            "Please enter your destination.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    if not start_date or not end_date:

        flash(
            "Please select your travel dates.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    if end_date < start_date:

        flash(
            "End date cannot be before start date.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    if not travel_mode:

        flash(
            "Please select your travel mode.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    # Hostel does not require trip type

    if (
        travel_mode != "Hostel"
        and not trip_type
    ):

        flash(
            "Please select your trip type.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    if not profile:

        flash(
            "Please select who you are packing for.",
            "error"
        )

        return redirect(
            url_for("trip_setup")
        )

    # =====================================================
    # SAFE NUMBER CONVERSION
    # =====================================================

    try:

        adults = int(
            adults_raw
        )

    except (
        ValueError,
        TypeError
    ):

        adults = 1

    try:

        children = int(
            children_raw
        )

    except (
        ValueError,
        TypeError
    ):

        children = 0

    try:

        weight_limit = float(
            weight_limit_raw
        )

    except (
        ValueError,
        TypeError
    ):

        weight_limit = 7.0

    adults = max(
        0,
        adults
    )

    children = max(
        0,
        children
    )

    weight_limit = max(
        0.1,
        weight_limit
    )

    allowed_personalization = {
        "Female": {"Skincare", "Makeup", "Hair care", "Sanitary essentials", "Jewelry", "Hair accessories", "Handbag", "Scarf / Stole"},
        "Male": {"Shaving kit", "Beard care", "Skincare", "Hair care", "Belt", "Wallet", "Watch", "Cap"},
        "Other": set(),
    }
    personalization = [
        item for item in personalization
        if item in allowed_personalization.get(profile, set())
    ]

    # A child is an additional traveller, not a profile. Keep children visible
    # and useful for every profile when the trip includes them.
    if children == 0:
        child_age = ""

    # =====================================================
    # HOSTEL MODE
    # =====================================================

    if travel_mode == "Hostel":

        activities = []

        makeup = []

        trip_type = ""

    else:

        shifting_items = []

    # =====================================================
    # CREATE TRIP OBJECT
    # =====================================================

    trip = {

        "destination": destination,

        "start_date": start_date,

        "end_date": end_date,

        "travel_mode": travel_mode,

        "trip_type": trip_type,

        "profile": profile,

        "adults": adults,

        "children": children,

        "child_age": child_age,

        "bag_type": bag_type,

        "weight_limit": weight_limit,

        "activities": activities,

        "makeup": makeup,

        "personalization": personalization,

        "toiletries": toiletries,

        "shifting_items": shifting_items
    }

    # =====================================================
    # GENERATE PACKING LIST
    # =====================================================

    try:

        packing_list = generate_packing_list(
            trip
        )

    except Exception as e:

        traceback.print_exc()

        flash("We could not create the packing list. Please review your trip details and try again.", "error")

        return redirect(
            url_for("trip_setup")
        )

    # =====================================================
    # SAVE SESSION
    # =====================================================

    session["current_trip"] = trip

    session["current_packing_list"] = packing_list

    session.modified = True

    # =====================================================
    # REDIRECT TO DASHBOARD
    # THIS WAS MISSING IN YOUR CODE
    # =====================================================

    return redirect(
        url_for("dashboard")
    )


# =========================================================
# RUN APPLICATION
# =========================================================

if __name__ == "__main__":

    init_db()

    print()
    print(
        "================================"
    )

    print(
        "          BAGBUDDY"
    )

    print(
        "================================"
    )

    print(
        "Server: http://127.0.0.1:5000"
    )

    print(
        "================================"
    )

    app.run(
        debug=True
    )

