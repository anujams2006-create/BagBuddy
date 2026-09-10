from datetime import datetime


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
# ADD ITEM
# =========================================================

def add_item(categories, category, name, quantity, unit_weight):

    if quantity <= 0:
        return

    item = {
        "name": name,
        "quantity": int(quantity),
        "weight": round(quantity * unit_weight, 2)
    }

    if category not in categories:
        categories[category] = []

    categories[category].append(item)


# =========================================================
# MAIN PACKING ENGINE
# =========================================================

def generate_packing_list(trip):

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
    # HOSTEL MODE
    # =====================================================

    if travel_mode == "Hostel":

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
    # BUSINESS TRIP
    # =====================================================

    if trip_type == "Business":

        add_item(
            categories,
            "💼 Business",
            "Formal Shirt",
            max(1, duration // 2),
            0.20
        )

        add_item(
            categories,
            "💼 Business",
            "Formal Pants",
            max(1, duration // 2),
            0.35
        )

        add_item(
            categories,
            "💼 Business",
            "Laptop",
            1,
            1.50
        )

        add_item(
            categories,
            "💼 Business",
            "Laptop Charger",
            1,
            0.20
        )


    # =====================================================
    # COLLEGE TRIP
    # =====================================================

    if trip_type == "College":

        add_item(
            categories,
            "🎓 College",
            "Notebook",
            2,
            0.25
        )

        add_item(
            categories,
            "🎓 College",
            "Pen",
            3,
            0.01
        )

        add_item(
            categories,
            "🎓 College",
            "College ID",
            1,
            0.02
        )


    # =====================================================
    # FLIGHT
    # =====================================================

    if travel_mode == "Flight":

        add_item(
            categories,
            "✈️ Travel Essentials",
            "Neck Pillow",
            1,
            0.25
        )

        add_item(
            categories,
            "✈️ Travel Essentials",
            "Travel Pouch",
            1,
            0.10
        )


    # =====================================================
    # TRAIN
    # =====================================================

    if travel_mode == "Train":

        add_item(
            categories,
            "🚆 Train Essentials",
            "Travel Pillow",
            1,
            0.30
        )

        add_item(
            categories,
            "🚆 Train Essentials",
            "Eye Mask",
            1,
            0.03
        )


    # =====================================================
    # BUS
    # =====================================================

    if travel_mode == "Bus":

        add_item(
            categories,
            "🚌 Bus Essentials",
            "Neck Pillow",
            1,
            0.25
        )

        add_item(
            categories,
            "🚌 Bus Essentials",
            "Water Bottle",
            1,
            0.20
        )


    # =====================================================
    # CAR
    # =====================================================

    if travel_mode == "Car":

        add_item(
            categories,
            "🚗 Car Essentials",
            "Travel Pillow",
            1,
            0.30
        )

        add_item(
            categories,
            "🚗 Car Essentials",
            "Car Charger",
            1,
            0.10
        )


    # =====================================================
    # CALCULATE TOTAL WEIGHT
    # =====================================================

    all_items = []

    for category_items in categories.values():

        all_items.extend(
            category_items
        )


    total_weight = round(
        sum(
            item["weight"]
            for item in all_items
        ),
        2
    )


    remaining_weight = round(
        weight_limit - total_weight,
        2
    )


    overloaded = (
        total_weight > weight_limit
    )


    # =====================================================
    # ITEMS TO REMOVE
    # =====================================================

    items_to_remove = []

    if overloaded:

        excess = (
            total_weight -
            weight_limit
        )

        sorted_items = sorted(
            all_items,
            key=lambda item: item["weight"],
            reverse=True
        )

        removed_weight = 0

        for item in sorted_items:

            if removed_weight >= excess:
                break

            items_to_remove.append(
                item
            )

            removed_weight += item["weight"]


    # =====================================================
    # FINAL RESULT
    # =====================================================

    return {

        "categories": categories,

        "items": all_items,

        "duration": duration,

        "destination": destination,

        "profile": profile,

        "travel_mode": travel_mode,

        "total_weight": total_weight,

        "weight_limit": weight_limit,

        "remaining_weight": remaining_weight,

        "overloaded": overloaded,

        "items_to_remove": items_to_remove

    }
