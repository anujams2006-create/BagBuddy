import uuid
from datetime import datetime
from engines.weather_engine import TEMP_THRESHOLDS


# =========================================================
# CALCULATE TRIP DURATION
# =========================================================

def calculate_duration(start_date, end_date):

    try:
        start = datetime.strptime(start_date, "%Y-%m-%d")
        end = datetime.strptime(end_date, "%Y-%m-%d")

        days = (end - start).days + 1

        return max(days, 1)

    except Exception:
        return 1


# =========================================================
# ADD ITEM & ITEM HELPERS
# =========================================================

def add_item(
    categories,
    category,
    name,
    quantity,
    unit_weight,
    weather_reason=None,
    source="ai",
    note="",
    is_packed=False,
    custom_weight=False,
    item_id=None
):
    if quantity <= 0:
        return None

    if not item_id:
        item_id = f"item_{uuid.uuid4().hex[:10]}"

    qty = int(quantity)
    unit_w = round(float(unit_weight), 2)
    tot_w = round(qty * unit_w, 2)

    item = {
        "id": item_id,
        "name": str(name).strip(),
        "category": str(category).strip(),
        "quantity": qty,
        "unit_weight": unit_w,
        "weight": tot_w,
        "custom_weight": bool(custom_weight),
        "note": str(note).strip() if note else "",
        "is_packed": bool(is_packed),
        "source": source or "ai"
    }
    if weather_reason:
        item["weather_reason"] = weather_reason

    if category not in categories:
        categories[category] = []

    # Check for existing item with identical name in this category
    for existing in categories[category]:
        if existing["name"].strip().lower() == name.strip().lower():
            if weather_reason and not existing.get("weather_reason"):
                existing["weather_reason"] = weather_reason
            return existing

    categories[category].append(item)
    return item


def find_item(categories, name_query):
    query = name_query.strip().lower()
    for cat_items in categories.values():
        for item in cat_items:
            n = item["name"].strip().lower()
            if query == n or query in n or n in query:
                return item
    return None


def get_default_item_weight(item_name: str, category: str = "") -> float:
    """
    Returns an estimated weight (in kg) for a single unit of an item based on its name and category.
    """
    n = item_name.strip().lower()
    c = category.strip().lower()

    if any(k in n for k in ["jacket", "coat", "parka", "overcoat", "blazer"]):
        return 0.85
    if any(k in n for k in ["hoodie", "sweater", "sweatshirt", "cardigan", "pullover"]):
        return 0.50
    if any(k in n for k in ["jeans", "trousers", "pants", "joggers", "chinos"]):
        return 0.50
    if any(k in n for k in ["shoes", "boots", "sneakers", "loafers"]):
        return 0.75
    if any(k in n for k in ["sandals", "slippers", "flip flops"]):
        return 0.35
    if any(k in n for k in ["umbrella", "raincoat"]):
        return 0.40
    if any(k in n for k in ["laptop", "notebook pc"]):
        return 1.50
    if any(k in n for k in ["tablet", "ipad", "kindle"]):
        return 0.45
    if any(k in n for k in ["charger", "cable", "adapter", "power bank"]):
        return 0.20
    if any(k in n for k in ["camera", "dslr"]):
        return 0.60
    if any(k in n for k in ["t-shirt", "tshirt", "shirt", "top", "blouse", "polo"]):
        return 0.20
    if any(k in n for k in ["shorts", "skirt"]):
        return 0.25
    if any(k in n for k in ["dress", "gown"]):
        return 0.35
    if any(k in n for k in ["underwear", "socks", "briefs", "bra"]):
        return 0.05
    if any(k in n for k in ["towel", "bath towel", "blanket", "bedsheet"]):
        return 0.40
    if any(k in n for k in ["pillow"]):
        return 0.30
    if any(k in n for k in ["water bottle", "thermos", "flask"]):
        return 0.25
    if any(k in n for k in ["book", "diary", "journal"]):
        return 0.30
    if any(k in n for k in ["passport", "tickets", "documents", "id card", "wallet"]):
        return 0.05
    if any(k in n for k in ["sunglasses", "spectacles", "glasses"]):
        return 0.05
    if any(k in n for k in ["shaving kit", "razor", "trimmer"]):
        return 0.20
    if any(k in n for k in ["perfume", "deodorant", "cologne"]):
        return 0.20
    if any(k in n for k in ["toothpaste", "toothbrush", "soap", "shampoo", "sunscreen", "moisturizer"]):
        return 0.15

    if "footwear" in c or "shoes" in c:
        return 0.70
    if "clothing" in c or "clothes" in c or "apparel" in c:
        return 0.30
    if "electronic" in c or "gadget" in c:
        return 0.35
    if "toiletrie" in c or "skincare" in c or "grooming" in c or "makeup" in c or "care" in c:
        return 0.15
    if "document" in c:
        return 0.05
    if "kid" in c:
        return 0.20
    if "essential" in c or "accessorie" in c:
        return 0.20

    return 0.25


def recalculate_packing_list(packing_list: dict, weight_limit: float = None) -> dict:
    """
    Recalculates total weights, limits, overload status, smart bag advice,
    and packed item progress across all active items in a packing list.
    """
    if weight_limit is None:
        weight_limit = packing_list.get("weight_limit", 7.0)
    try:
        weight_limit = float(weight_limit)
    except Exception:
        weight_limit = 7.0

    all_items = []
    categories = packing_list.get("categories", {})

    for cat_name, cat_items in list(categories.items()):
        for item in cat_items:
            qty = max(1, int(item.get("quantity", 1)))
            item["quantity"] = qty

            unit_w = float(item.get("unit_weight", 0) or 0)
            if unit_w <= 0:
                if item.get("weight"):
                    unit_w = round(float(item["weight"]) / qty, 2)
                else:
                    unit_w = get_default_item_weight(item.get("name", ""), cat_name)

            item["unit_weight"] = round(unit_w, 2)
            item["weight"] = round(qty * unit_w, 2)
            if "id" not in item or not item["id"]:
                item["id"] = f"item_{uuid.uuid4().hex[:10]}"
            if "is_packed" not in item:
                item["is_packed"] = False
            if "source" not in item:
                item["source"] = "ai"
            if "custom_weight" not in item:
                item["custom_weight"] = False
            if "note" not in item:
                item["note"] = ""
            all_items.append(item)

    total_weight = round(sum(it["weight"] for it in all_items), 2)
    remaining_weight = round(weight_limit - total_weight, 2)
    overloaded = total_weight > weight_limit

    bag_advice = []
    items_to_remove = []

    if overloaded:
        excess = round(total_weight - weight_limit, 2)
        sorted_items = sorted(all_items, key=lambda it: it["weight"], reverse=True)
        rem_w = 0
        for it in sorted_items:
            if rem_w >= excess:
                break
            items_to_remove.append(it)
            rem_w += it["weight"]

        bag_advice.append(f"Your bag exceeds the {weight_limit} kg limit by approximately {excess} kg.")
        has_jacket = find_item(categories, "Jacket") or find_item(categories, "Warm Jacket")
        has_heavy_shoes = find_item(categories, "Shoes") or find_item(categories, "Adult Shoes") or find_item(categories, "Everyday Shoes") or find_item(categories, "Hiking Shoes")
        has_rain_gear = find_item(categories, "Umbrella") or find_item(categories, "Raincoat")
        if has_jacket:
            bag_advice.append("Consider wearing your jacket during travel instead of packing it to save ~0.85 kg.")
        if has_heavy_shoes:
            bag_advice.append("Wear your heaviest pair of shoes during transit instead of packing them.")
        if has_rain_gear:
            bag_advice.append("Carry your umbrella or rain poncho in your hand or day bag.")
        bag_advice.append("Use travel-size toiletries (under 100ml) to reduce unnecessary weight.")

    packed_count = sum(1 for it in all_items if it.get("is_packed"))
    total_count = len(all_items)
    progress_percent = round((packed_count / total_count) * 100) if total_count > 0 else 0

    packing_list["categories"] = categories
    packing_list["items"] = all_items
    if "removed_items" not in packing_list:
        packing_list["removed_items"] = []
    packing_list["total_weight"] = total_weight
    packing_list["weight_limit"] = weight_limit
    packing_list["remaining_weight"] = remaining_weight
    packing_list["overloaded"] = overloaded
    packing_list["items_to_remove"] = items_to_remove
    packing_list["bag_advice"] = bag_advice
    packing_list["packed_count"] = packed_count
    packing_list["total_count"] = total_count
    packing_list["progress_percent"] = progress_percent
    return packing_list


def ensure_packing_list_structure(packing_list: dict, weight_limit: float = 7.0) -> dict:
    """
    Ensures backward compatibility for older packing list structures.
    """
    if not isinstance(packing_list, dict):
        packing_list = {}
    if "categories" not in packing_list:
        packing_list["categories"] = {}
    if "removed_items" not in packing_list:
        packing_list["removed_items"] = []

    return recalculate_packing_list(packing_list, weight_limit=weight_limit)


# =========================================================
# WEATHER-BASED RECOMMENDATION LAYER
# =========================================================

def apply_weather_recommendations(categories, weather_data, trip_info):
    """
    Analyzes normalized weather data and dynamically adjusts packing items.
    Adds weather-appropriate gear and attaches clear explanations.
    Avoids duplicate items and prevents heavy winter items when warm.
    """
    if not weather_data or not isinstance(weather_data, dict):
        return

    status = weather_data.get("status")
    if status not in ("available", "partial") and "min_temp" not in weather_data:
        return

    min_temp = weather_data.get("min_temp")
    max_temp = weather_data.get("max_temp")
    if min_temp is None or max_temp is None:
        return

    rain_prob = weather_data.get("rain_probability", 0) or 0
    wind_speed = weather_data.get("wind_speed", 0.0) or 0.0
    conditions = [str(c).lower() for c in weather_data.get("conditions", [])]
    dominant = str(weather_data.get("dominant_condition") or "").lower()
    all_cond_text = " ".join(conditions) + " " + dominant

    duration = trip_info.get("duration", 1)
    adults = trip_info.get("adults", 1)
    children = trip_info.get("children", 0)
    people = max(1, adults + children)
    activities = trip_info.get("activities", [])
    profile = trip_info.get("profile", "")

    weather_cat = "🌤️ Weather Essentials"
    warm_cat = "🧥 Warm Layers & Outerwear"

    is_rainy = (
        rain_prob >= TEMP_THRESHOLDS["RAIN_PROB_THRESHOLD"]
        or any(k in all_cond_text for k in ["rain", "drizzle", "shower", "storm", "thunder"])
    )
    is_freezing = min_temp < TEMP_THRESHOLDS["FREEZING_MAX"]
    is_cold = min_temp < TEMP_THRESHOLDS["COLD_MAX"]
    is_cool_mild = (TEMP_THRESHOLDS["COOL_MIN"] <= min_temp < TEMP_THRESHOLDS["MILD_MIN"]) and (max_temp < TEMP_THRESHOLDS["HOT"])
    is_hot = max_temp >= TEMP_THRESHOLDS["HOT"]
    is_extreme_heat = max_temp >= TEMP_THRESHOLDS["EXTREME_HEAT"]
    is_windy = wind_speed >= TEMP_THRESHOLDS["WIND_SPEED_THRESHOLD"]

    # ---------------------------------------------------------
    # 1. RAIN RECOMMENDATIONS
    # ---------------------------------------------------------
    if is_rainy:
        umbrella_qty = 1 if people <= 2 else min(2, people)
        add_item(
            categories,
            weather_cat,
            "Umbrella",
            umbrella_qty,
            0.35,
            weather_reason=f"Recommended because rain is expected during your trip ({rain_prob}% chance)."
        )

        add_item(
            categories,
            weather_cat,
            "Raincoat / Poncho",
            people,
            0.25,
            weather_reason="Lightweight waterproof protection against rain showers."
        )

        add_item(
            categories,
            weather_cat,
            "Waterproof Bag Cover",
            1,
            0.10,
            weather_reason="Protects luggage and electronics from wet weather."
        )

        if duration >= 2:
            add_item(
                categories,
                weather_cat,
                "Quick-Dry Clothes",
                min(2, duration),
                0.15,
                weather_reason="Dries rapidly in humid or rainy travel conditions."
            )

        if "Hiking" in activities:
            add_item(
                categories,
                "🥾 Hiking",
                "Waterproof Shoe Covers / Gaiters",
                people,
                0.20,
                weather_reason="Keeps hiking footwear and socks dry on wet trails."
            )

    # ---------------------------------------------------------
    # 2. COLD WEATHER RECOMMENDATIONS (< 10°C)
    # ---------------------------------------------------------
    if is_cold:
        add_item(
            categories,
            warm_cat,
            "Warm Jacket",
            people,
            0.85,
            weather_reason=f"Recommended because temperatures may fall below 10°C (expected low of {round(min_temp)}°C)."
        )

        add_item(
            categories,
            warm_cat,
            "Sweater / Fleece",
            people,
            0.45,
            weather_reason=f"Extra warm layer for chilly mornings and evenings ({round(min_temp)}°C)."
        )

        add_item(
            categories,
            warm_cat,
            "Warm Socks",
            people * max(1, duration // 2),
            0.05,
            weather_reason="Keeps feet warm in cold weather conditions."
        )

        if is_freezing:
            add_item(
                categories,
                warm_cat,
                "Thermal Wear (Top & Bottom)",
                people,
                0.30,
                weather_reason=f"Essential insulating base layer for freezing conditions (down to {round(min_temp)}°C)."
            )

            add_item(
                categories,
                warm_cat,
                "Gloves & Beanie Cap",
                people,
                0.10,
                weather_reason=f"Warm head and hand protection for freezing temperatures ({round(min_temp)}°C)."
            )

        # Personal Care cold weather boost
        lip_balm = find_item(categories, "Lip balm")
        if lip_balm:
            lip_balm["weather_reason"] = "Protects lips from cold, dry air."
        else:
            add_item(
                categories,
                "🧴 Toiletries",
                "Lip Balm & Cold Cream",
                1,
                0.06,
                weather_reason="Protects lips and skin from cold, dry winds."
            )

        if trip_info.get("trip_type") == "Business":
            add_item(
                categories,
                "💼 Business",
                "Formal Overcoat / Blazer",
                1,
                0.80,
                weather_reason="Professional warm layer suitable for cold business meetings."
            )

    # ---------------------------------------------------------
    # 3. COOL / MILD WEATHER (10°C – 18°C)
    # ---------------------------------------------------------
    elif is_cool_mild:
        add_item(
            categories,
            warm_cat,
            "Light Jacket / Cardigan",
            people,
            0.35,
            weather_reason=f"Comfortable layer for cooler evenings ({round(min_temp)}°C – {round(max_temp)}°C)."
        )

    # ---------------------------------------------------------
    # 4. HOT WEATHER (>= 30°C)
    # ---------------------------------------------------------
    if is_hot:
        existing_sunscreen = find_item(categories, "Sunscreen")
        if existing_sunscreen:
            existing_sunscreen["weather_reason"] = f"Recommended because of warm/sunny conditions (up to {round(max_temp)}°C)."
        else:
            add_item(
                categories,
                "🧴 Toiletries",
                "Sunscreen",
                1,
                0.10,
                weather_reason=f"Recommended because of warm/sunny conditions (up to {round(max_temp)}°C)."
            )

        existing_sunglasses = find_item(categories, "Sunglasses")
        if existing_sunglasses:
            existing_sunglasses["weather_reason"] = "UV protection for bright, sunny travel days."
        else:
            add_item(
                categories,
                weather_cat,
                "Sunglasses",
                people,
                0.03,
                weather_reason="UV protection for bright, sunny travel days."
            )

        existing_cap = find_item(categories, "Cap")
        if existing_cap:
            existing_cap["weather_reason"] = f"Protects head and face from intense sunlight ({round(max_temp)}°C)."
        else:
            add_item(
                categories,
                weather_cat,
                "Cap / Sun Hat",
                people,
                0.08,
                weather_reason=f"Protects head and face from intense sunlight ({round(max_temp)}°C)."
            )

        existing_water = find_item(categories, "Water Bottle")
        if existing_water:
            existing_water["weather_reason"] = f"Stay hydrated during hot travel days (up to {round(max_temp)}°C)."
        else:
            add_item(
                categories,
                weather_cat,
                "Reusable Water Bottle",
                people,
                0.20,
                weather_reason=f"Stay hydrated during hot travel days (up to {round(max_temp)}°C)."
            )

        if is_extreme_heat:
            add_item(
                categories,
                weather_cat,
                "Cooling Face Mist & Electrolytes",
                1,
                0.08,
                weather_reason=f"Hydration & cooling essentials for extreme heat ({round(max_temp)}°C)."
            )

    # ---------------------------------------------------------
    # 5. WINDY WEATHER (>= 25 km/h)
    # ---------------------------------------------------------
    if is_windy and not find_item(categories, "Jacket"):
        add_item(
            categories,
            weather_cat,
            "Windbreaker Jacket",
            people,
            0.35,
            weather_reason=f"Protection against gusty travel winds ({round(wind_speed)} km/h)."
        )

    # ---------------------------------------------------------
    # 6. CHILDREN'S WEATHER ESSENTIALS
    # ---------------------------------------------------------
    if children > 0:
        child_cat = "🧒 Children's Essentials"
        if is_cold:
            add_item(
                categories,
                child_cat,
                "Children's Warm Jacket",
                children,
                0.40,
                weather_reason=f"Keeps children warm in cold weather (expected low of {round(min_temp)}°C)."
            )
            add_item(
                categories,
                child_cat,
                "Children's Warm Socks",
                children * max(1, duration // 2),
                0.03,
                weather_reason="Warm foot protection for children."
            )
        if is_rainy:
            add_item(
                categories,
                child_cat,
                "Children's Raincoat",
                children,
                0.15,
                weather_reason="Keeps children dry during rain showers."
            )
        if is_hot:
            add_item(
                categories,
                child_cat,
                "Children's Sun Hat",
                children,
                0.05,
                weather_reason="Shields children from strong midday sun."
            )


# =========================================================
# MAIN PACKING ENGINE
# =========================================================

def generate_packing_list(trip, weather_data=None):


    # -----------------------------------------------------
    # BASIC INFORMATION
    # -----------------------------------------------------

    destination = trip.get("destination", "")

    start_date = trip.get("start_date", "")
    end_date = trip.get("end_date", "")

    duration = calculate_duration(
        start_date,
        end_date
    )

    travel_mode = trip.get(
        "travel_mode",
        ""
    )

    trip_type = trip.get(
        "trip_type",
        ""
    )

    profile = trip.get(
        "profile",
        ""
    )

    activities = trip.get(
        "activities",
        []
    )

    makeup = trip.get(
        "makeup",
        []
    )

    toiletries = trip.get(
        "toiletries",
        []
    )

    personalization = trip.get("personalization", [])

    adults = int(
        trip.get("adults", 1) or 1
    )

    children = int(
        trip.get("children", 0) or 0
    )

    weight_limit = float(
        trip.get("weight_limit", 7) or 7
    )


    # -----------------------------------------------------
    # CATEGORY STORAGE
    # -----------------------------------------------------

    categories = {}


    # =====================================================
    # MALE
    # =====================================================

    if profile == "Male":

        add_item(
            categories,
            "👕 Clothes",
            "T-Shirts / Tops",
            max(2, duration),
            0.18
        )

        add_item(
            categories,
            "👕 Clothes",
            "Pants / Bottoms",
            max(1, (duration + 1) // 2),
            0.35
        )

        add_item(
            categories,
            "👕 Clothes",
            "Underwear",
            duration,
            0.06
        )

        add_item(
            categories,
            "👕 Clothes",
            "Socks",
            duration,
            0.04
        )

        add_item(
            categories,
            "🛏️ Sleepwear",
            "Nightwear",
            max(1, duration // 2),
            0.20
        )

        add_item(
            categories,
            "👟 Footwear",
            "Everyday Shoes",
            1,
            0.80
        )

        add_item(
            categories,
            "👟 Footwear",
            "Slippers",
            1,
            0.30
        )


    # =====================================================
    # FEMALE
    # =====================================================

    elif profile == "Female":

        add_item(
            categories,
            "👗 Clothes",
            "T-Shirts / Tops",
            max(2, duration),
            0.18
        )

        add_item(
            categories,
            "👗 Clothes",
            "Pants / Bottoms",
            max(1, (duration + 1) // 2),
            0.35
        )

        add_item(
            categories,
            "👗 Clothes",
            "Underwear",
            duration,
            0.06
        )

        add_item(
            categories,
            "👗 Clothes",
            "Socks",
            duration,
            0.04
        )

        add_item(
            categories,
            "👗 Women's Essentials",
            "Scarf / Stole",
            1,
            0.15
        )

        add_item(
            categories,
            "👗 Women's Essentials",
            "Personal Hygiene Products",
            1,
            0.15
        )

        add_item(
            categories,
            "👟 Footwear",
            "Everyday Shoes",
            1,
            0.80
        )

        add_item(
            categories,
            "👟 Footwear",
            "Slippers",
            1,
            0.30
        )

        # Personal care choices are added below only when the traveller
        # explicitly selects them; they are never assumed from gender.


    # =====================================================
    # CHILDREN
    # =====================================================

    elif profile == "Children":

        child_count = max(
            children,
            1
        )

        add_item(
            categories,
            "🧒 Children's Clothes",
            "T-Shirts / Tops",
            child_count * max(2, duration),
            0.10
        )

        add_item(
            categories,
            "🧒 Children's Clothes",
            "Pants / Bottoms",
            child_count * max(
                1,
                (duration + 1) // 2
            ),
            0.20
        )

        add_item(
            categories,
            "🧒 Children's Clothes",
            "Underwear",
            child_count * duration,
            0.04
        )

        add_item(
            categories,
            "🧒 Children's Clothes",
            "Socks",
            child_count * duration,
            0.03
        )

        add_item(
            categories,
            "🧒 Children's Essentials",
            "Children's Shoes",
            child_count,
            0.45
        )

        add_item(
            categories,
            "🧒 Children's Essentials",
            "Children's Toiletries",
            child_count,
            0.10
        )

        add_item(
            categories,
            "🧒 Children's Essentials",
            "Snacks",
            child_count,
            0.15
        )


    # =====================================================
    # FAMILY
    # =====================================================

    elif profile == "Family":

        # -------------------------------------------------
        # ADULTS
        # -------------------------------------------------

        if adults > 0:

            add_item(
                categories,
                "👕 Adult Clothes",
                "T-Shirts / Tops",
                adults * max(2, duration),
                0.18
            )

            add_item(
                categories,
                "👕 Adult Clothes",
                "Pants / Bottoms",
                adults * max(
                    1,
                    (duration + 1) // 2
                ),
                0.35
            )

            add_item(
                categories,
                "👕 Adult Clothes",
                "Underwear",
                adults * duration,
                0.06
            )

            add_item(
                categories,
                "👕 Adult Clothes",
                "Socks",
                adults * duration,
                0.04
            )

            add_item(
                categories,
                "👟 Footwear",
                "Adult Shoes",
                adults,
                0.80
            )

        # -------------------------------------------------
        # CHILDREN
        # -------------------------------------------------

        if children > 0:

            add_item(
                categories,
                "🧒 Children's Clothes",
                "T-Shirts / Tops",
                children * max(2, duration),
                0.10
            )

            add_item(
                categories,
                "🧒 Children's Clothes",
                "Pants / Bottoms",
                children * max(
                    1,
                    (duration + 1) // 2
                ),
                0.20
            )

            add_item(
                categories,
                "🧒 Children's Clothes",
                "Underwear",
                children * duration,
                0.04
            )

            add_item(
                categories,
                "🧒 Children's Clothes",
                "Socks",
                children * duration,
                0.03
            )

            add_item(
                categories,
                "👟 Footwear",
                "Children's Shoes",
                children,
                0.45
            )


        add_item(
            categories,
            "👨‍👩‍👧 Family Essentials",
            "Family First Aid Kit",
            1,
            0.30
        )

        add_item(
            categories,
            "👨‍👩‍👧 Family Essentials",
            "Snacks",
            max(1, adults + children),
            0.15
        )

    # An inclusive profile still receives the complete practical base list.
    # Profile changes add optional preferences; they do not remove essentials.
    elif profile == "Other":

        add_item(categories, "Clothing", "T-Shirts / Tops", max(2, duration), 0.18)
        add_item(categories, "Clothing", "Pants / Bottoms", max(1, (duration + 1) // 2), 0.35)
        add_item(categories, "Clothing", "Underwear", duration, 0.06)
        add_item(categories, "Clothing", "Socks", duration, 0.04)
        add_item(categories, "Sleepwear", "Nightwear", max(1, duration // 2), 0.20)
        add_item(categories, "Footwear", "Everyday Shoes", 1, 0.80)
        add_item(categories, "Footwear", "Slippers", 1, 0.30)

    # =====================================================
    # COMMON TOILETRIES
    # =====================================================

    people = max(
        adults + children,
        1
    )

    # Children can travel with any adult profile. Add their practical needs
    # independently instead of requiring a separate family profile.
    if children > 0 and profile not in {"Children", "Family"}:
        add_item(categories, "Children's Essentials", "Children's clothes", children * max(2, duration), 0.10)
        add_item(categories, "Children's Essentials", "Children's toiletries", children, 0.10)
        add_item(categories, "Children's Essentials", "Snacks", children, 0.15)

    add_item(
        categories,
        "🧴 Toiletries",
        "Toothbrush",
        people,
        0.03
    )

    add_item(
        categories,
        "🧴 Toiletries",
        "Toothpaste",
        1,
        0.08
    )

    add_item(
        categories,
        "🧴 Toiletries",
        "Soap",
        1,
        0.10
    )

    add_item(
        categories,
        "🧴 Toiletries",
        "Shampoo",
        1,
        0.10
    )

    add_item(
        categories,
        "🧴 Toiletries",
        "Deodorant",
        1,
        0.10
    )


    # -----------------------------------------------------
    # SELECTED TOILETRIES
    # -----------------------------------------------------

    for item in toiletries:

        # Avoid duplicate default toiletries

        default_items = [
            "Toothbrush",
            "Toothpaste",
            "Soap",
            "Shampoo"
        ]

        if item in default_items:
            continue

        add_item(
            categories,
            "🧴 Toiletries",
            item,
            1,
            0.08
        )

    # Optional profile choices remain explicit and are grouped separately from
    # the universal toiletries above.
    personal_care = {"Skincare", "Makeup", "Hair care", "Sanitary essentials", "Shaving kit", "Beard care"}
    accessories = {"Jewelry", "Hair accessories", "Handbag", "Scarf / Stole", "Belt", "Wallet", "Watch", "Cap"}
    for item in personalization:
        category = "Personal Care" if item in personal_care else "Accessories"
        item_weight = 0.12 if item in personal_care else 0.10
        add_item(categories, category, item, 1, item_weight)


    # =====================================================
    # ELECTRONICS
    # =====================================================

    add_item(
        categories,
        "🔌 Electronics",
        "Phone Charger",
        people,
        0.10
    )

    add_item(
        categories,
        "🔌 Electronics",
        "Power Bank",
        1,
        0.20
    )


    # =====================================================
    # DOCUMENTS
    # =====================================================

    add_item(
        categories,
        "📄 Documents",
        "ID / Passport",
        people,
        0.05
    )

    add_item(
        categories,
        "📄 Documents",
        "Travel Documents",
        1,
        0.05
    )


    # =====================================================
    # ACTIVITIES
    # =====================================================

    if "Beach" in activities:

        add_item(
            categories,
            "🏖️ Beach",
            "Swimwear",
            people,
            0.15
        )

        add_item(
            categories,
            "🏖️ Beach",
            "Sunglasses",
            people,
            0.03
        )

        add_item(
            categories,
            "🏖️ Beach",
            "Sunscreen",
            1,
            0.10
        )


    if "Hiking" in activities:

        add_item(
            categories,
            "🥾 Hiking",
            "Hiking Shoes",
            people,
            0.70
        )

        add_item(
            categories,
            "🥾 Hiking",
            "Water Bottle",
            people,
            0.20
        )

        add_item(
            categories,
            "🥾 Hiking",
            "Small Backpack",
            1,
            0.40
        )


    if "Swimming" in activities:

        add_item(
            categories,
            "🏊 Swimming",
            "Swimming Clothes",
            people,
            0.15
        )

        add_item(
            categories,
            "🏊 Swimming",
            "Swimming Towel",
            people,
            0.20
        )


    if "Sightseeing" in activities:

        add_item(
            categories,
            "📸 Sightseeing",
            "Sunglasses",
            people,
            0.03
        )

        add_item(
            categories,
            "📸 Sightseeing",
            "Day Bag",
            1,
            0.30
        )


    # =====================================================
    # PARSE TRAVEL MODES (SINGLE OR MULTI TRAVEL MODE)
    # =====================================================

    raw_modes = trip.get("travel_modes") or trip.get("travel_mode") or []
    if isinstance(raw_modes, str):
        if "+" in raw_modes:
            modes = [m.strip() for m in raw_modes.split("+") if m.strip()]
        elif "," in raw_modes:
            modes = [m.strip() for m in raw_modes.split(",") if m.strip()]
        else:
            modes = [raw_modes.strip()] if raw_modes.strip() else []
    elif isinstance(raw_modes, (list, tuple, set)):
        modes = [str(m).strip() for m in raw_modes if str(m).strip()]
    else:
        modes = []

    mode_set = {m.lower() for m in modes}
    display_travel_mode = " + ".join(modes) if len(modes) > 1 else (modes[0] if modes else trip.get("travel_mode", ""))

    # =====================================================
    # HOSTEL MODE (ROOM & STUDY ESSENTIALS)
    # =====================================================

    if "hostel" in mode_set or travel_mode == "Hostel":

        hostel_items = [
            ("Bedsheet", 0.50),
            ("Pillow Cover", 0.15),
            ("Blanket", 0.80),
            ("Towels", 0.30),
            ("Hangers", 0.20),
            ("Laundry Bag", 0.15),
            ("Lock & Keys", 0.10),
            ("Storage Bags", 0.10),
            ("Basic Utensils", 0.40),
            ("Water Bottle", 0.20),
            ("Extension Board", 0.30)
        ]

        for name, weight in hostel_items:
            add_item(
                categories,
                "🏠 Hostel Essentials",
                name,
                1,
                weight
            )

    # =====================================================
    # BUSINESS & COLLEGE TRIP TYPES
    # =====================================================

    if trip_type == "Business":
        add_item(categories, "💼 Business", "Formal Shirt", max(1, duration // 2), 0.20)
        add_item(categories, "💼 Business", "Formal Pants", max(1, duration // 2), 0.35)
        add_item(categories, "💼 Business", "Laptop", 1, 1.50)
        add_item(categories, "💼 Business", "Laptop Charger", 1, 0.20)

    if trip_type == "College":
        add_item(categories, "🎓 College", "Notebook", 2, 0.25)
        add_item(categories, "🎓 College", "Pen", 3, 0.01)
        add_item(categories, "🎓 College", "College ID", 1, 0.02)

    # =====================================================
    # MULTI TRAVEL MODE ESSENTIALS (COMBINED & DE-DUPLICATED)
    # =====================================================

    # Determine travel essentials category title
    active_transport_modes = [m for m in modes if m.lower() != "hostel"]
    if len(active_transport_modes) > 1:
        travel_cat = "🧳 Journey & Travel Essentials"
    elif len(active_transport_modes) == 1:
        m = active_transport_modes[0].lower()
        if m == "flight": travel_cat = "✈️ Travel Essentials"
        elif m == "train": travel_cat = "🚆 Train Essentials"
        elif m == "bus": travel_cat = "🚌 Bus Essentials"
        elif m == "car": travel_cat = "🚗 Car Essentials"
        else: travel_cat = "✈️ Travel Essentials"
    else:
        travel_cat = "✈️ Travel Essentials"

    # Helper: Check if an item concept already exists in any category
    def concept_exists(concept_words):
        for c_items in categories.values():
            for itm in c_items:
                inm = itm.get("name", "").lower()
                if any(w in inm for w in concept_words):
                    return True
        return False

    # 1. Flight Recommendations
    if "flight" in mode_set or travel_mode == "Flight":
        if not concept_exists(["pillow"]):
            add_item(categories, travel_cat, "Neck Pillow", 1, 0.25)
        add_item(categories, travel_cat, "Travel Pouch / Passport Holder", 1, 0.10)
        add_item(categories, travel_cat, "TSA Travel-Size Bottles", 1, 0.10)
        if not concept_exists(["earphone", "headphone"]):
            add_item(categories, travel_cat, "Noise-isolating Earphones", 1, 0.06)

    # 2. Train Recommendations
    if "train" in mode_set or travel_mode == "Train":
        if not concept_exists(["pillow"]):
            add_item(categories, travel_cat, "Travel Pillow", 1, 0.30)
        add_item(categories, travel_cat, "Eye Mask", 1, 0.03)
        if not concept_exists(["blanket", "shawl"]):
            add_item(categories, travel_cat, "Light Travel Shawl / Blanket", 1, 0.25)
        add_item(categories, travel_cat, "Wet Wipes & Sanitizer", 1, 0.08)

    # 3. Bus Recommendations
    if "bus" in mode_set or travel_mode == "Bus":
        if not concept_exists(["pillow"]):
            add_item(categories, travel_cat, "Neck Pillow", 1, 0.25)
        if not concept_exists(["water bottle", "bottle"]):
            add_item(categories, travel_cat, "Water Bottle", 1, 0.20)
        add_item(categories, travel_cat, "Motion Sickness Mints", 1, 0.05)

    # 4. Car Recommendations
    if "car" in mode_set or travel_mode == "Car":
        if not concept_exists(["pillow"]):
            add_item(categories, travel_cat, "Travel Pillow", 1, 0.30)
        if not concept_exists(["water bottle", "bottle"]):
            add_item(categories, travel_cat, "Water Bottle", 1, 0.20)
        add_item(categories, travel_cat, "Car Phone Charger & Mount", 1, 0.15)
        if not concept_exists(["sunglasses"]):
            add_item(categories, travel_cat, "Sunglasses", 1, 0.05)
        add_item(categories, travel_cat, "Road Trip Emergency & First-Aid Kit", 1, 0.25)

    # =====================================================
    # WEATHER RECOMMENDATIONS INTEGRATION
    # =====================================================

    if weather_data is None:
        weather_data = trip.get("weather_data") or trip.get("weather")
    if weather_data is None and destination and start_date and end_date:
        try:
            from engines.weather_engine import get_weather
            weather_data = get_weather(destination, start_date, end_date)
        except Exception:
            weather_data = None

    trip_info = {
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "duration": duration,
        "travel_mode": display_travel_mode,
        "travel_modes": modes,
        "trip_type": trip_type,
        "profile": profile,
        "adults": adults,
        "children": children,
        "child_age": trip.get("child_age", ""),
        "activities": activities,
    }

    apply_weather_recommendations(categories, weather_data, trip_info)

    # =====================================================
    # USER REMOVAL MEMORY & PACKED STATE PRESERVATION
    # =====================================================

    existing_packing_list = trip.get("existing_packing_list")
    removed_items_record = []

    if existing_packing_list and isinstance(existing_packing_list, dict):
        removed_items_record = list(existing_packing_list.get("removed_items", []))
        removed_names = {r.get("name", "").strip().lower() for r in removed_items_record if r.get("name")}
        packed_names = {
            it.get("name", "").strip().lower(): it.get("is_packed", False)
            for it in existing_packing_list.get("items", [])
            if it.get("name")
        }

        # Filter out previously removed AI items
        for cat_name, itms in list(categories.items()):
            categories[cat_name] = [
                it for it in itms
                if it.get("name", "").strip().lower() not in removed_names
            ]
            # Restore previously packed state
            for it in categories[cat_name]:
                n_lower = it.get("name", "").strip().lower()
                if n_lower in packed_names:
                    it["is_packed"] = packed_names[n_lower]

        # Re-add user-added items that were not removed
        for it in existing_packing_list.get("items", []):
            if it.get("source") == "user":
                n_lower = it.get("name", "").strip().lower()
                if n_lower not in removed_names:
                    cat = it.get("category", "🎒 Essentials")
                    if cat not in categories:
                        categories[cat] = []
                    # Avoid duplicate if already in category
                    if not any(x.get("name", "").strip().lower() == n_lower for x in categories[cat]):
                        categories[cat].append(it)

    # Clean empty categories except standard ones
    categories = {k: v for k, v in categories.items() if len(v) > 0}

    # Weather items list
    weather_items = []
    for cat_name, cat_items in categories.items():
        for it in cat_items:
            if it.get("weather_reason"):
                weather_items.append({
                    "name": it["name"],
                    "category": cat_name,
                    "reason": it["weather_reason"],
                    "quantity": it["quantity"]
                })

    result_dict = {
        "categories": categories,
        "items": [],
        "removed_items": removed_items_record,
        "duration": duration,
        "destination": destination,
        "profile": profile,
        "travel_mode": display_travel_mode,
        "travel_modes": modes,
        "weight_limit": weight_limit,
        "weather": weather_data,
        "weather_items": weather_items
    }

    return recalculate_packing_list(result_dict, weight_limit=weight_limit)

