# app.py
from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
    session,
    flash,
    jsonify
)

from werkzeug.security import (
    generate_password_hash,
    check_password_hash
)

import os
import sqlite3
import traceback
import copy
import time

# Simple in-memory rate limiter (per user_id or IP)
_RATE_LIMIT_DATA = {}

def rate_limit(max_requests: int = 10, period_seconds: int = 60):
    """Decorator to enforce a simple rate limit.
    Allows ``max_requests`` calls per ``period_seconds`` per user (identified by session user_id or IP).
    Returns HTTP 429 when limit exceeded.
    """
    def decorator(func):
        def wrapper(*args, **kwargs):
            identifier = session.get('user_id') or request.remote_addr
            now = time.time()
            window_start, count = _RATE_LIMIT_DATA.get(identifier, (0, 0))
            if now - window_start > period_seconds:
                window_start = now
                count = 0
            count += 1
            _RATE_LIMIT_DATA[identifier] = (window_start, count)
            if count > max_requests:
                return jsonify({"success": False, "error": "Rate limit exceeded. Please wait before sending more requests."}), 429
            return func(*args, **kwargs)
        wrapper.__name__ = func.__name__
        return wrapper
    return decorator

from packing_engine import (
    generate_packing_list,
    add_item as pe_add_item,
    find_item as pe_find_item,
    get_default_item_weight,
    recalculate_packing_list,
    ensure_packing_list_structure,
)
from engines.weather_engine import get_weather
from supabase_client import supabase_db
import database
import config
import ai_buddy


# =========================================================
# APP CONFIGURATION
# =========================================================

app = Flask(__name__)

app.secret_key = config.SECRET_KEY or "bagbuddy_secret_key_change_later"

DATABASE = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "bagbuddy.db"
)


# =========================================================
# DATABASE
# =========================================================

def get_db():

    conn = sqlite3.connect(DATABASE)

    conn.row_factory = sqlite3.Row

    return conn


def init_db():

    database.init_db()


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

        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not name or not email or not password:
            flash("Please fill all fields.", "error")
            return redirect(url_for("signup"))

        if len(password) < 6:
            flash("Password must be at least 6 characters long.", "error")
            return redirect(url_for("signup"))

        success, user_id, user_name, user_email, token, error = supabase_db.sign_up(name, email, password)
        if success:
            flash("Account created successfully! Please log in.", "success")
            return redirect(url_for("login"))

        flash(error or "Could not create account. Please try again.", "error")
        return redirect(url_for("signup"))

    return render_template("signup.html")


# =========================================================
# LOGIN
# =========================================================

@app.route("/login", methods=["GET", "POST"])
def login():

    if request.method == "POST":

        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not email or not password:
            flash("Please enter both email and password.", "error")
            return render_template("login.html")

        success, user_id, user_name, user_email, token, error = supabase_db.sign_in(email, password)
        if success:
            session["user_id"] = user_id
            session["user_name"] = user_name
            session["user_email"] = user_email
            if token:
                session["supabase_token"] = token

            flash(f"Welcome back, {user_name}!", "success")
            return redirect(url_for("dashboard"))

        flash(error or "Invalid email or password.", "error")

    return render_template("login.html")


# =========================================================
# LOGOUT
# =========================================================

@app.route("/logout")
def logout():

    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


# =========================================================
# DASHBOARD
# =========================================================

@app.route("/dashboard")
@app.route("/dashboard-home", endpoint="dashboard_home")
def dashboard():

    if "user_id" not in session:
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    trip = session.get("current_trip")
    packing_list = session.get("current_packing_list")

    # If no trip/packing list currently in session, load the user's latest saved trip
    if not trip or not packing_list:
        token = session.get("supabase_token")
        user_trips = supabase_db.get_user_trips(str(session["user_id"]), token=token)
        if user_trips and len(user_trips) > 0:
            latest = user_trips[0]
            trip = latest
            packing_list = latest.get("packing_list")
            if not packing_list or not isinstance(packing_list, dict) or not packing_list.get("categories"):
                packing_list = generate_packing_list(trip, weather_data=trip.get("weather_data"))
            session["current_trip"] = trip
            session["current_packing_list"] = packing_list
            session.modified = True

    return render_template(
        "dashboard_home.html",
        user_name=session.get("user_name", "User"),
        trip=trip,
        packing_list=packing_list
    )


# =========================================================
# MY TRIPS
# =========================================================

@app.route("/my-trips")
def my_trips():

    if "user_id" not in session:
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    token = session.get("supabase_token")
    trips = supabase_db.get_user_trips(str(session["user_id"]), token=token)

    return render_template(
        "my_trips.html",
        trips=trips
    )


# =========================================================
# VIEW SAVED TRIP IN DASHBOARD
# =========================================================

@app.route("/trips/<trip_id>")
def view_trip(trip_id):

    if "user_id" not in session:
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    token = session.get("supabase_token")
    trip = supabase_db.get_trip_by_id(str(trip_id), str(session["user_id"]), token=token)
    if not trip:
        flash("Trip not found.", "error")
        return redirect(url_for("my_trips"))

    packing_list = trip.get("packing_list")
    if not packing_list or not isinstance(packing_list, dict) or not packing_list.get("categories"):
        packing_list = generate_packing_list(trip, weather_data=trip.get("weather_data"))

    session["current_trip"] = trip
    session["current_packing_list"] = packing_list
    session.modified = True

    flash(f"Loaded checklist for {trip.get('destination', 'trip').title()}!", "success")
    return redirect(url_for("dashboard"))


# =========================================================
# DELETE TRIP
# =========================================================

@app.route("/trips/<trip_id>/delete", methods=["POST"])
def delete_trip_route(trip_id):

    if "user_id" not in session:
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    token = session.get("supabase_token")
    success = supabase_db.delete_trip(str(trip_id), str(session["user_id"]), token=token)
    if success:
        curr = session.get("current_trip")
        if curr and str(curr.get("id")) == str(trip_id):
            session.pop("current_trip", None)
            session.pop("current_packing_list", None)
            session.modified = True
        flash("Trip deleted successfully.", "success")
    else:
        flash("Could not delete trip.", "error")

    return redirect(url_for("my_trips"))


# =========================================================
# TRIP SETUP
# =========================================================

@app.route("/trip-setup", methods=["GET", "POST"])
def trip_setup():

    if "user_id" not in session:
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    if request.method == "GET":
        return render_template("trip_setup.html")

    destination = request.form.get("destination", "").strip()
    start_date = request.form.get("start_date", "")
    end_date = request.form.get("end_date", "")
    travel_mode = request.form.get("travel_mode", "").strip()
    trip_type = request.form.get("trip_type", "").strip()
    profile = request.form.get("profile", "").strip()

    activities = request.form.getlist("activities")
    personalization = request.form.getlist("personalization")
    makeup = request.form.getlist("makeup")
    toiletries = request.form.getlist("toiletries")
    shifting_items = request.form.getlist("shifting_items")

    adults_raw = request.form.get("adults", "1")
    children_raw = request.form.get("children", "0")
    child_age = request.form.get("child_age", "")

    bag_type = request.form.get("bag_type", "Backpack")
    weight_limit_raw = request.form.get("weight_limit", "7")

    if not destination:
        flash("Please enter your destination.", "error")
        return redirect(url_for("trip_setup"))

    if not start_date or not end_date:
        flash("Please select your travel dates.", "error")
        return redirect(url_for("trip_setup"))

    if end_date < start_date:
        flash("End date cannot be before start date.", "error")
        return redirect(url_for("trip_setup"))

    if not travel_mode:
        flash("Please select your travel mode.", "error")
        return redirect(url_for("trip_setup"))

    if travel_mode != "Hostel" and not trip_type:
        flash("Please select your trip type.", "error")
        return redirect(url_for("trip_setup"))

    if not profile:
        flash("Please select who you are packing for.", "error")
        return redirect(url_for("trip_setup"))

    try:
        adults = int(adults_raw)
    except (ValueError, TypeError):
        adults = 1

    try:
        children = int(children_raw)
    except (ValueError, TypeError):
        children = 0

    try:
        weight_limit = float(weight_limit_raw)
    except (ValueError, TypeError):
        weight_limit = 7.0

    adults = max(0, adults)
    children = max(0, children)
    weight_limit = max(0.1, weight_limit)

    allowed_personalization = {
        "Female": {"Skincare", "Makeup", "Hair care", "Sanitary essentials", "Jewelry", "Hair accessories", "Handbag", "Scarf / Stole"},
        "Male": {"Shaving kit", "Beard care", "Skincare", "Hair care", "Belt", "Wallet", "Watch", "Cap"},
        "Other": set(),
    }
    personalization = [
        item for item in personalization
        if item in allowed_personalization.get(profile, set())
    ]

    if children == 0:
        child_age = ""

    if travel_mode == "Hostel":
        activities = []
        makeup = []
        trip_type = ""
    else:
        shifting_items = []

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

    try:
        weather_data = get_weather(destination, start_date, end_date)
    except Exception as we:
        weather_data = {
            "status": "unavailable",
            "location": destination,
            "message": "Weather information is currently unavailable."
        }

    trip["weather_data"] = weather_data

    try:
        packing_list = generate_packing_list(trip, weather_data=weather_data)
    except Exception as e:
        traceback.print_exc()
        flash("We could not create the packing list. Please review your trip details and try again.", "error")
        return redirect(url_for("trip_setup"))

    user_id = session.get("user_id")
    if user_id:
        token = session.get("supabase_token")
        success, created_id, err = supabase_db.create_trip(str(user_id), trip, packing_list, token=token)
        if success and created_id:
            trip["id"] = created_id

    session["current_trip"] = trip
    session["current_packing_list"] = packing_list
    session.modified = True

    flash("Your packing list has been created!", "success")
    return redirect(url_for("dashboard"))


# =========================================================
# CHAT HELPERS — PACKING LIST MUTATIONS
# =========================================================

def _persist_packing_list(packing_list: dict) -> bool:
    """Persist a complete list, only updating the session after persistence succeeds."""
    user_id = session.get("user_id")
    trip    = session.get("current_trip") or {}
    trip_id = trip.get("id")

    # If we have a Supabase trip ID, persist there too
    if trip_id and user_id:
        token = session.get("supabase_token")
        saved = supabase_db.update_trip_packing_list(
            str(trip_id), str(user_id), packing_list, token=token
        )
        if not saved:
            return False

    session["current_packing_list"] = packing_list
    session.modified = True
    return True


def _chat_add_item(action: dict) -> dict:
    """
    Adds an item to the current packing list.
    Returns {"performed": bool, "message": str, "weight_added": float}
    """
    name     = str(action.get("name", "")).strip()
    category = str(action.get("category", "General")).strip()
    try:
        quantity = int(action.get("quantity") or 1)
    except (ValueError, TypeError):
        return {"performed": False, "message": "Quantity must be a whole number."}
    if not 1 <= quantity <= 100:
        return {"performed": False, "message": "Quantity must be between 1 and 100."}
    note     = str(action.get("note") or "").strip()

    if not name:
        return {"performed": False, "message": "No item name provided."}

    packing_list = copy.deepcopy(session.get("current_packing_list") or {})
    trip         = session.get("current_trip") or {}
    weight_limit = float(trip.get("weight_limit") or packing_list.get("weight_limit") or 7)

    if not isinstance(packing_list.get("categories"), dict):
        packing_list = ensure_packing_list_structure(packing_list, weight_limit)

    categories = packing_list["categories"]

    # Check if item already exists anywhere in the list
    existing = pe_find_item(categories, name)
    if existing:
        return {
            "performed": False,
            "message": f"{existing['name']} is already in your packing list (Qty: {existing['quantity']}).",
            "already_exists": True,
            "existing_name": existing["name"],
            "existing_qty": existing["quantity"],
        }

    supplied_weight = action.get("unit_weight")
    if supplied_weight in (None, ""):
        unit_weight = get_default_item_weight(name, category)
        custom_weight = False
    else:
        try:
            unit_weight = float(supplied_weight)
        except (ValueError, TypeError):
            return {"performed": False, "message": "Estimated weight must be a number in kilograms."}
        if not 0 < unit_weight <= 100:
            return {"performed": False, "message": "Estimated weight must be greater than 0 and no more than 100 kg."}
        custom_weight = True
    pe_add_item(
        categories, category, name, quantity, unit_weight,
        note=note, source=action.get("source", "chat"), custom_weight=custom_weight
    )

    packing_list = recalculate_packing_list(packing_list, weight_limit)
    ok = _persist_packing_list(packing_list)

    total_weight = round(quantity * unit_weight, 2)
    return {
        "performed": ok,
        "message": f"Added {name} x{quantity} ({total_weight} kg) to '{category}'.",
        "item_name": name,
        "category": category,
        "quantity": quantity,
        "unit_weight": unit_weight,
        "total_item_weight": total_weight,
        "new_total_weight": packing_list.get("total_weight"),
        "overloaded": packing_list.get("overloaded", False),
    }


def _chat_remove_item(action: dict) -> dict:
    """
    Removes an item from the packing list by name (fuzzy match).
    Returns {"performed": bool, "message": str, ...}
    """
    name = str(action.get("name", "")).strip()
    item_id = str(action.get("item_id", "")).strip()
    if not name and not item_id:
        return {"performed": False, "message": "No item name provided."}

    packing_list = copy.deepcopy(session.get("current_packing_list") or {})
    trip         = session.get("current_trip") or {}
    weight_limit = float(trip.get("weight_limit") or packing_list.get("weight_limit") or 7)

    if not isinstance(packing_list.get("categories"), dict):
        return {"performed": False, "message": "No packing list found."}

    categories = packing_list["categories"]
    query = name.strip().lower()
    removed = None

    for cat_name, cat_items in list(categories.items()):
        for item in list(cat_items):
            item_name = item.get("name", "").strip().lower()
            if (item_id and str(item.get("id", "")) == item_id) or (not item_id and (query == item_name or query in item_name or item_name in query)):
                # Track in removed_items so it won't be re-added on regeneration
                removed_list = packing_list.setdefault("removed_items", [])
                removed_list.append({"name": item["name"], "category": cat_name})
                cat_items.remove(item)
                removed = item
                break
        if removed:
            # Clean up empty categories
            if not cat_items:
                del categories[cat_name]
            break

    if not removed:
        return {"performed": False, "message": f"Could not find '{name}' in your packing list."}

    packing_list = recalculate_packing_list(packing_list, weight_limit)
    ok = _persist_packing_list(packing_list)

    return {
        "performed": ok,
        "message": f"Removed {removed['name']} from your packing list.",
        "removed_name": removed["name"],
        "weight_freed": removed.get("weight", 0),
        "new_total_weight": packing_list.get("total_weight"),
        "overloaded": packing_list.get("overloaded", False),
    }


def _chat_update_quantity(action: dict) -> dict:
    """
    Updates the quantity of an existing item.
    Returns {"performed": bool, "message": str, ...}
    """
    name     = str(action.get("name", "")).strip()
    quantity = max(1, int(action.get("quantity") or 1))

    if not name:
        return {"performed": False, "message": "No item name provided."}

    packing_list = copy.deepcopy(session.get("current_packing_list") or {})
    trip         = session.get("current_trip") or {}
    weight_limit = float(trip.get("weight_limit") or packing_list.get("weight_limit") or 7)

    if not isinstance(packing_list.get("categories"), dict):
        return {"performed": False, "message": "No packing list found."}

    categories = packing_list["categories"]
    found = pe_find_item(categories, name)

    if not found:
        return {"performed": False, "message": f"Could not find '{name}' in your packing list."}

    found["quantity"] = quantity
    found["weight"]   = round(quantity * float(found.get("unit_weight") or 0.25), 2)

    packing_list = recalculate_packing_list(packing_list, weight_limit)
    ok = _persist_packing_list(packing_list)

    return {
        "performed": ok,
        "message": f"Updated {found['name']} quantity to {quantity}.",
        "item_name": found["name"],
        "new_quantity": quantity,
        "new_total_weight": packing_list.get("total_weight"),
        "overloaded": packing_list.get("overloaded", False),
    }


# =========================================================
# AI BUDDY CHAT API
# =========================================================

@rate_limit()
@app.route("/api/chat", methods=["POST"])
def api_chat():

    if "user_id" not in session:
        return jsonify({"success": False, "reply": "Please log in to use the AI assistant."}), 401

    data = request.get_json(silent=True) or {}
    user_message = (data.get("message") or "").strip()

    if not user_message:
        return jsonify({"success": False, "reply": "Please type a message."}), 400

    if len(user_message) > 800:
        user_message = user_message[:800]

    trip         = session.get("current_trip") or {}
    packing_list = session.get("current_packing_list") or {}

    # Validate and clean history
    raw_history = session.get("chat_history", [])
    history = [
        h for h in raw_history
        if isinstance(h, dict)
        and h.get("role") in ("user", "model")
        and h.get("parts")
    ]

    # Call AI — now returns 3 values
    success, reply, action = ai_buddy.chat(
        user_message=user_message,
        trip=trip,
        packing_list=packing_list,
        history=history
    )

    action_result = {}

    # Execute validated backend action if AI called a tool
    if success and action:
        action_type = action.get("type")

        if action_type == "add_item":
            action_result = _chat_add_item(action)
        elif action_type == "remove_item":
            action_result = _chat_remove_item(action)
        elif action_type == "update_quantity":
            action_result = _chat_update_quantity(action)

        # If action was not performed (e.g. item already exists), reflect that
        if action_result and not action_result.get("performed"):
            # The AI already has a reply; append the backend reason if different
            backend_msg = action_result.get("message", "")
            if backend_msg and backend_msg.lower() not in reply.lower():
                reply = reply + f"\n\n_(Note: {backend_msg})_"

    if success:
        history.append({"role": "user",  "parts": [user_message]})
        history.append({"role": "model", "parts": [reply]})
        session["chat_history"] = history[-60:]
        session.modified = True

    # Include updated packing list in response so frontend can refresh
    updated_pl = None
    if action_result.get("performed"):
        updated_pl = session.get("current_packing_list")

    return jsonify({
        "success": success,
        "reply": reply,
        "action": action,
        "action_result": action_result,
        "packing_list_changed": bool(action_result.get("performed")),
        "new_packing_list": updated_pl,
    })


@rate_limit()
@app.route("/api/chat/clear", methods=["POST"])
def api_chat_clear():
    """Clears the stored conversation history for the current session."""
    session.pop("chat_history", None)
    session.modified = True
    return jsonify({"success": True})

@rate_limit()
@app.route("/api/packing/add", methods=["POST"])
def api_packing_add():
    """Add an item to the packing list via API (used by UI)."""
    if "user_id" not in session:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    category = str(data.get("category", "General")).strip()
    try:
        quantity = int(data.get("quantity", 1))
    except (ValueError, TypeError):
        return jsonify({"success": False, "error": "Quantity must be a whole number."}), 400
    note = str(data.get("note", "")).strip()
    if not name:
        return jsonify({"success": False, "error": "Item name required"}), 400
    action = {"type": "add_item", "name": name, "category": category, "quantity": quantity, "note": note, "unit_weight": data.get("unit_weight"), "source": "user"}
    result = _chat_add_item(action)
    updated = session.get("current_packing_list") if result.get("performed") else None
    return jsonify({
        "success": result.get("performed", False),
        "message": result.get("message", ""),
        "action_result": result,
        "new_packing_list": updated,
    })

@rate_limit()
@app.route("/api/packing/delete", methods=["POST"])
def api_packing_delete():
    """Delete an item from the packing list via API (used by UI)."""
    if "user_id" not in session:
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    item_id = str(data.get("item_id", "")).strip()
    if not name and not item_id:
        return jsonify({"success": False, "error": "Item name required"}), 400
    action = {"type": "remove_item", "name": name, "item_id": item_id}
    result = _chat_remove_item(action)
    updated = session.get("current_packing_list") if result.get("performed") else None
    return jsonify({
        "success": result.get("performed", False),
        "message": result.get("message", ""),
        "action_result": result,
        "new_packing_list": updated,
    })


# =========================================================
# RUN APPLICATION
# =========================================================

if __name__ == "__main__":

    config.validate_supabase_config()
    init_db()

    print()
    print("================================")
    print("          BAGBUDDY")
    print("================================")
    print("Server: http://127.0.0.1:5000")
    print("================================")

    app.run(debug=True)
