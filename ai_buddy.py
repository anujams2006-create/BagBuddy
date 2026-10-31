# ==============================================================================
# BAGBUDDY — AI BUDDY (Gemini via google-genai SDK)
# ==============================================================================
# Full tool-calling travel & packing assistant.
# Configure GEMINI_API_KEY and (optionally) GEMINI_MODEL in .env.
# The key is read server-side only and is never embedded in browser code.
# ==============================================================================

import logging
import os
import traceback
import copy
from datetime import datetime
import config

logger = logging.getLogger("bagbuddy.ai_buddy")

# Configuration belongs in .env, never in this source file.
GEMINI_MODEL = config.GEMINI_MODEL

# ── SDK import ───────────────────────────────────────────────────────────────────
try:
    from google import genai
    from google.genai import types as genai_types
    GENAI_AVAILABLE = True
except ImportError:
    genai = None
    genai_types = None
    GENAI_AVAILABLE = False
    logger.warning("google-genai SDK not installed. Run: pip install google-genai")


def _resolve_api_key() -> str:
    key = config.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY", "").strip()
    if key.startswith("YOUR_") or key.startswith("your_"):
        return ""
    return key


def is_configured() -> bool:
    return GENAI_AVAILABLE and bool(_resolve_api_key())


# ── Tool definitions ─────────────────────────────────────────────────────────────

BUDDY_TOOLS = None  # built lazily

def _get_tools():
    global BUDDY_TOOLS
    if BUDDY_TOOLS is not None:
        return BUDDY_TOOLS
    if not GENAI_AVAILABLE:
        return None
    BUDDY_TOOLS = [
        genai_types.Tool(
            function_declarations=[
                genai_types.FunctionDeclaration(
                    name="add_packing_item",
                    description="Add a new item to the user's packing list. Use this when the user asks to add an item.",
                    parameters=genai_types.Schema(
                        type=genai_types.Type.OBJECT,
                        properties={
                            "name": genai_types.Schema(type=genai_types.Type.STRING, description="Item name, e.g. 'Umbrella'"),
                            "category": genai_types.Schema(type=genai_types.Type.STRING, description="Category for the item, e.g. 'Weather Essentials', 'Clothing', 'Toiletries'"),
                            "quantity": genai_types.Schema(type=genai_types.Type.INTEGER, description="Number of units, default 1"),
                            "note": genai_types.Schema(type=genai_types.Type.STRING, description="Optional note about the item"),
                        },
                        required=["name", "category"],
                    )
                ),
                genai_types.FunctionDeclaration(
                    name="remove_packing_item",
                    description="Remove an item from the user's packing list. Use when user explicitly asks to remove something.",
                    parameters=genai_types.Schema(
                        type=genai_types.Type.OBJECT,
                        properties={
                            "name": genai_types.Schema(type=genai_types.Type.STRING, description="Name of item to remove"),
                        },
                        required=["name"],
                    )
                ),
                genai_types.FunctionDeclaration(
                    name="update_item_quantity",
                    description="Change the quantity of an existing packing list item.",
                    parameters=genai_types.Schema(
                        type=genai_types.Type.OBJECT,
                        properties={
                            "name": genai_types.Schema(type=genai_types.Type.STRING, description="Name of item"),
                            "quantity": genai_types.Schema(type=genai_types.Type.INTEGER, description="New quantity"),
                        },
                        required=["name", "quantity"],
                    )
                ),
            ]
        )
    ]
    return BUDDY_TOOLS


# ── System prompt ────────────────────────────────────────────────────────────────

def _build_system_prompt(trip: dict, packing_list: dict) -> str:
    destination  = trip.get("destination", "Not set").title()
    start_date   = trip.get("start_date", "")
    end_date     = trip.get("end_date", "")
    travel_mode  = trip.get("travel_mode", "")
    trip_type    = trip.get("trip_type", "") or "N/A"
    profile      = trip.get("profile", "")
    bag_type     = trip.get("bag_type", "bag")
    weight_limit = float(trip.get("weight_limit") or 7)
    activities   = trip.get("activities") or []
    children     = int(trip.get("children") or 0)
    adults       = int(trip.get("adults") or 1)
    child_age    = trip.get("child_age", "")
    weather      = trip.get("weather_data") or packing_list.get("weather") or {}
    personalization = trip.get("personalization") or []
    shifting_items = trip.get("shifting_items") or []

    total_weight = float(packing_list.get("total_weight") or 0)
    remaining_wt = float(packing_list.get("remaining_weight") or (weight_limit - total_weight))
    overloaded   = bool(packing_list.get("overloaded", False))
    categories   = packing_list.get("categories", {})
    packed_count = int(packing_list.get("packed_count") or 0)
    total_count  = int(packing_list.get("total_count") or sum(len(v) for v in categories.values()))

    # Full packing list detail
    list_lines = []
    for cat, items in categories.items():
        if not items:
            continue
        list_lines.append(f"  [{cat}]")
        for it in items:
            packed_mark = "✓" if it.get("is_packed") else "○"
            list_lines.append(
                f"    {packed_mark} {it.get('name','?')} x{it.get('quantity',1)} ({it.get('weight',0)} kg total)"
            )
    list_text = "\n".join(list_lines) if list_lines else "  No items yet."

    # Weather
    if weather and weather.get("status") in ("available", "partial"):
        weather_line = (
            f"  Status: Live forecast available\n"
            f"  Condition: {weather.get('dominant_condition', 'Mixed')}\n"
            f"  Temperature: {weather.get('min_temp')}–{weather.get('max_temp')}°C\n"
            f"  Rain chance: {weather.get('rain_probability', 0)}%\n"
            f"  Wind: {weather.get('wind_speed', 0)} km/h"
        )
    elif weather and weather.get("status") == "out_of_range":
        weather_line = "  Status: Future dates — forecast not yet available. Standard packing logic applied."
    else:
        weather_line = "  Status: Unavailable — do not invent weather conditions."

    weight_status = (
        f"⚠️ OVER LIMIT by {round(total_weight - weight_limit, 2)} kg"
        if overloaded
        else f"✓ Within limit — {round(remaining_wt, 2)} kg remaining"
    )

    activities_str = ", ".join(activities) if activities else "None specified"
    children_info = f"{children} child(ren), age: {child_age}" if children > 0 else "None"
    personal_str = ", ".join(personalization) if personalization else "None"
    shifting_str = ", ".join(shifting_items) if shifting_items else "None"

    return f"""You are BagBuddy AI Travel Assistant — a friendly, practical personal travel and packing assistant embedded in the BagBuddy app.

YOUR CAPABILITIES:
- Answer travel and packing questions using the user's trip data
- Use add_packing_item when user asks to add something
- Use remove_packing_item when user explicitly asks to remove something  
- Use update_item_quantity when user asks to change a quantity
- For ambiguous removes (e.g. "remove some jeans" without clarity), ask which ones before using the tool
- For destructive bulk actions (clearing many items), ask for confirmation first

PERSONALITY:
- Warm, concise, and encouraging
- Use bullet points for lists
- Do not mention Gemini, Google, or any AI model name
- Do not invent weather data, weights, or items not in the list
- Be honest when information is unavailable

━━━ CURRENT TRIP ━━━
Destination  : {destination}
Dates        : {start_date} → {end_date}
Travel mode  : {travel_mode}
Trip type    : {trip_type}
Profile      : {profile}
Activities   : {activities_str}
Adults       : {adults}
Children     : {children_info}
Bag          : {bag_type} | Limit: {weight_limit} kg
Personal prefs: {personal_str}
Hostel items : {shifting_str}

━━━ WEATHER ━━━
{weather_line}

━━━ BAG WEIGHT ━━━
Total weight : {total_weight} kg
Status       : {weight_status}
Packed       : {packed_count} / {total_count} items

━━━ FULL PACKING LIST (✓ = packed, ○ = not yet packed) ━━━
{list_text}

IMPORTANT RULES:
1. When user says "add [item]", call add_packing_item immediately — do not ask for confirmation for single adds
2. When user says "remove [item]" and it's unambiguous, call remove_packing_item
3. After using a tool, confirm success naturally: "✓ I've added Umbrella to your packing list!"
4. Never claim to add/remove items without using the function tool
5. Keep responses under 150 words unless asked for detail
""".strip()


# ── Main chat function ───────────────────────────────────────────────────────────

def chat(
    user_message: str,
    trip: dict,
    packing_list: dict,
    history: list
) -> tuple:
    """
    Returns (success: bool, reply: str, action: dict)
    action is {} for pure conversation, or a dict with type/name/category/quantity/etc for mutations.
    """
    if not is_configured():
        return False, (
            "BagBuddy AI isn't set up yet. "
            "Add your GEMINI_API_KEY to the .env file to activate the assistant. "
            "Get a free key at: https://aistudio.google.com/app/apikey"
        ), {}

    api_key = _resolve_api_key()

    try:
        client = genai.Client(api_key=api_key)
        system_prompt = _build_system_prompt(trip, packing_list)

        # Build contents from history
        contents = []
        for turn in history:
            role  = turn.get("role", "user")
            parts = turn.get("parts", [])
            text  = parts[0] if parts else ""
            if text and role in ("user", "model"):
                contents.append(
                    genai_types.Content(
                        role=role,
                        parts=[genai_types.Part(text=text)]
                    )
                )

        contents.append(
            genai_types.Content(
                role="user",
                parts=[genai_types.Part(text=user_message)]
            )
        )

        tools = _get_tools()

        # First API call — may include a function call
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=genai_types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.65,
                max_output_tokens=600,
                tools=tools,
            )
        )

        # Check for a function call in the response
        action = {}
        fn_call = None
        fn_text_reply = ""

        if response.candidates:
            for part in response.candidates[0].content.parts:
                if hasattr(part, "function_call") and part.function_call:
                    fn_call = part.function_call
                    break
                if hasattr(part, "text") and part.text:
                    fn_text_reply += part.text

        if fn_call:
            fn_name = fn_call.name
            fn_args = dict(fn_call.args) if fn_call.args else {}

            # Build the action dict
            if fn_name == "add_packing_item":
                action = {
                    "type": "add_item",
                    "name": str(fn_args.get("name", "")).strip(),
                    "category": str(fn_args.get("category", "General")).strip(),
                    "quantity": int(fn_args.get("quantity") or 1),
                    "note": str(fn_args.get("note") or "").strip(),
                }
            elif fn_name == "remove_packing_item":
                action = {
                    "type": "remove_item",
                    "name": str(fn_args.get("name", "")).strip(),
                }
            elif fn_name == "update_item_quantity":
                action = {
                    "type": "update_quantity",
                    "name": str(fn_args.get("name", "")).strip(),
                    "quantity": int(fn_args.get("quantity") or 1),
                }

            # Make a second call with function result so Gemini writes the reply
            # The web route performs the mutation only after this function returns.
            # Do not let the model claim that a requested operation has succeeded.
            fn_result_text = f"Action '{fn_name}' was requested with args: {fn_args}. Do not claim it succeeded; the app will confirm the result."

            contents_with_result = list(contents) + [
                genai_types.Content(
                    role="model",
                    parts=[genai_types.Part(function_call=fn_call)]
                ),
                genai_types.Content(
                    role="user",
                    parts=[genai_types.Part(
                        function_response=genai_types.FunctionResponse(
                            name=fn_name,
                            response={"result": fn_result_text}
                        )
                    )]
                ),
            ]

            reply_response = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=contents_with_result,
                config=genai_types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.65,
                    max_output_tokens=300,
                )
            )
            reply = reply_response.text.strip() if reply_response.text else _default_action_reply(fn_name, fn_args)
        else:
            # Pure text response
            reply = (response.text or "").strip()
            if not reply:
                reply = "I didn't get a response. Please try again."

        return True, reply, action

    except Exception as e:
        err_str = str(e).lower()
        logger.error(f"Gemini chat error: {e}")
        traceback.print_exc()

        if any(k in err_str for k in ("api_key", "api key", "401", "unauthenticated")):
            return False, "The Gemini API key looks invalid. Please check your GEMINI_API_KEY in the .env file.", {}
        if any(k in err_str for k in ("quota", "rate", "429", "resource_exhausted")):
            return False, "Rate limit reached. Please wait a moment and try again.", {}
        if any(k in err_str for k in ("connect", "network", "timeout", "getaddrinfo", "errno")):
            return False, "Could not reach the AI service. Please check your internet connection.", {}
        if "404" in err_str or "not found" in err_str:
            return False, "The configured Gemini model is unavailable. Update GEMINI_MODEL in .env and restart BagBuddy.", {}

        return False, "Something went wrong with the AI assistant. Please try again.", {}


def _default_action_reply(fn_name: str, fn_args: dict) -> str:
    if fn_name == "add_packing_item":
        return f"✓ Added **{fn_args.get('name', 'item')}** to your packing list."
    if fn_name == "remove_packing_item":
        return f"✓ Removed **{fn_args.get('name', 'item')}** from your packing list."
    if fn_name == "update_item_quantity":
        return f"✓ Updated **{fn_args.get('name', 'item')}** quantity to {fn_args.get('quantity', 1)}."
    return "Done!"
