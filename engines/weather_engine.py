# engines/weather_engine.py
"""
Centralized Weather Engine for BagBuddy.

Provides reliable, production-ready weather forecast retrieval and multi-day analysis
for travel destinations and travel dates.

Supports:
- Primary / zero-friction provider: Open-Meteo (global geocoding + 16-day daily forecast, no key needed)
- Configurable provider: WeatherAPI.com (when WEATHER_API_KEY is configured in .env)
- In-memory TTL caching to avoid redundant API calls
- Date range boundary checks (detects when trips exceed available forecast horizon)
- Graceful error handling (API failures, timeouts, invalid destinations, network errors)
  without leaking keys, stack traces, or crashing the app.
"""

import os
import time
import logging
import requests
from datetime import datetime, date, timedelta, timezone
from typing import Dict, Any, Optional, List, Tuple

logger = logging.getLogger("bagbuddy.weather")

# ==============================================================================
# CONFIGURATION & CONSTANTS
# ==============================================================================

# Timeouts in seconds for external requests
GEOCODING_TIMEOUT = 8
FORECAST_TIMEOUT = 10

# In-memory cache: (cache_key) -> (timestamp, data)
_WEATHER_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
CACHE_TTL_SECONDS = 1800  # 30 minutes

# Temperature & Weather Thresholds (°C, %, km/h)
TEMP_THRESHOLDS = {
    "EXTREME_HEAT": 35.0,   # >= 35°C
    "HOT": 30.0,            # >= 30°C
    "WARM_MIN": 24.0,       # 24°C - 29.9°C
    "MILD_MIN": 18.0,       # 18°C - 23.9°C
    "COOL_MIN": 10.0,       # 10°C - 17.9°C
    "COLD_MAX": 10.0,       # < 10°C
    "FREEZING_MAX": 5.0,    # < 5°C
    "RAIN_PROB_THRESHOLD": 40,  # >= 40%
    "WIND_SPEED_THRESHOLD": 25.0,  # >= 25 km/h
}

# WMO Weather Interpretation Codes (Open-Meteo standard) -> (Condition, Icon)
WMO_CODE_MAP = {
    0: ("Clear", "☀️"),
    1: ("Mainly Clear", "🌤️"),
    2: ("Partly Cloudy", "⛅"),
    3: ("Overcast", "☁️"),
    45: ("Foggy", "🌫️"),
    48: ("Depositing Rime Fog", "🌫️"),
    51: ("Light Drizzle", "🌦️"),
    53: ("Moderate Drizzle", "🌦️"),
    55: ("Dense Drizzle", "🌧️"),
    56: ("Light Freezing Drizzle", "🌧️"),
    57: ("Dense Freezing Drizzle", "🌧️"),
    61: ("Slight Rain", "🌧️"),
    62: ("Moderate Rain", "🌧️"),
    63: ("Moderate Rain", "🌧️"),
    65: ("Heavy Rain", "🌧️"),
    66: ("Light Freezing Rain", "🌧️"),
    67: ("Heavy Freezing Rain", "🌧️"),
    71: ("Slight Snow", "❄️"),
    73: ("Moderate Snow", "❄️"),
    75: ("Heavy Snow", "❄️"),
    77: ("Snow Grains", "❄️"),
    80: ("Rain Showers", "🌦️"),
    81: ("Moderate Rain Showers", "🌧️"),
    82: ("Violent Rain Showers", "🌧️"),
    85: ("Snow Showers", "❄️"),
    86: ("Heavy Snow Showers", "❄️"),
    95: ("Thunderstorm", "⛈️"),
    96: ("Thunderstorm with Hail", "⛈️"),
    97: ("Thunderstorm with Hail", "⛈️"),
    99: ("Thunderstorm with Heavy Hail", "⛈️"),
}


def _get_api_key() -> str:
    """Safely retrieves WEATHER_API_KEY from environment or config."""
    try:
        import config
        return getattr(config, "WEATHER_API_KEY", "").strip() or os.getenv("WEATHER_API_KEY", "").strip()
    except Exception:
        return os.getenv("WEATHER_API_KEY", "").strip()


def _get_provider() -> str:
    """Determines the active weather provider."""
    provider = os.getenv("WEATHER_PROVIDER", "").strip().lower()
    if provider:
        return provider
    api_key = _get_api_key()
    if api_key:
        return "weatherapi"
    return "open-meteo"


# ==============================================================================
# CACHING HELPERS
# ==============================================================================

def _get_cache(key: str) -> Optional[Dict[str, Any]]:
    """Retrieves cached response if still within TTL."""
    if key in _WEATHER_CACHE:
        timestamp, data = _WEATHER_CACHE[key]
        if time.time() - timestamp < CACHE_TTL_SECONDS:
            return data
        else:
            del _WEATHER_CACHE[key]
    return None


def _set_cache(key: str, data: Dict[str, Any]) -> None:
    """Stores response in cache with current timestamp."""
    _WEATHER_CACHE[key] = (time.time(), data)


# ==============================================================================
# POPULAR DESTINATION COORDINATES
# ==============================================================================
POPULAR_DESTINATIONS = {
    "goa": {
        "latitude": 15.4989,
        "longitude": 73.8278,
        "name": "Goa",
        "country": "India",
        "display_name": "Goa, India"
    },
    "manali": {
        "latitude": 32.2574,
        "longitude": 77.1748,
        "name": "Manali",
        "country": "India",
        "display_name": "Manali, Himachal Pradesh, India"
    },
    "kullu": {
        "latitude": 31.9579,
        "longitude": 77.1095,
        "name": "Kullu",
        "country": "India",
        "display_name": "Kullu, Himachal Pradesh, India"
    },
    "shimla": {
        "latitude": 31.1048,
        "longitude": 77.1734,
        "name": "Shimla",
        "country": "India",
        "display_name": "Shimla, Himachal Pradesh, India"
    },
    "leh": {
        "latitude": 34.1526,
        "longitude": 77.5771,
        "name": "Leh",
        "country": "India",
        "display_name": "Leh, Ladakh, India"
    },
    "ooty": {
        "latitude": 11.4102,
        "longitude": 76.6950,
        "name": "Ooty",
        "country": "India",
        "display_name": "Ooty, Tamil Nadu, India"
    },
    "munnar": {
        "latitude": 10.0889,
        "longitude": 77.0595,
        "name": "Munnar",
        "country": "India",
        "display_name": "Munnar, Kerala, India"
    },
    "rishikesh": {
        "latitude": 30.0869,
        "longitude": 78.2676,
        "name": "Rishikesh",
        "country": "India",
        "display_name": "Rishikesh, Uttarakhand, India"
    },
    "nainital": {
        "latitude": 29.3919,
        "longitude": 79.4542,
        "name": "Nainital",
        "country": "India",
        "display_name": "Nainital, Uttarakhand, India"
    },
    "mussoorie": {
        "latitude": 30.4598,
        "longitude": 78.0644,
        "name": "Mussoorie",
        "country": "India",
        "display_name": "Mussoorie, Uttarakhand, India"
    }
}


# ==============================================================================
# GEOCODING / LOCATION SEARCH
# ==============================================================================

def get_location(destination: str) -> Optional[Dict[str, Any]]:
    """
    Resolves a human-entered destination string to coordinates and normalized name.
    Returns:
        dict with keys: 'latitude', 'longitude', 'name', 'country', 'display_name'
        or None if not found / error.
    """
    if not destination or not destination.strip():
        return None

    cleaned_query = destination.strip()
    q_lower = cleaned_query.lower()

    # Fast-path for prominent holiday destinations
    if q_lower in POPULAR_DESTINATIONS:
        return POPULAR_DESTINATIONS[q_lower]

    cache_key = f"geo_{q_lower}"
    cached = _get_cache(cache_key)
    if cached:
        return cached

    # 1. Open-Meteo Geocoding API (free, fast, global)
    try:
        url = "https://geocoding-api.open-meteo.com/v1/search"
        params = {
            "name": cleaned_query,
            "count": 5,
            "language": "en",
            "format": "json"
        }
        res = requests.get(url, params=params, timeout=GEOCODING_TIMEOUT)
        if res.status_code == 200:
            data = res.json()
            results = data.get("results")
            if results and len(results) > 0:
                best = results[0]
                name = best.get("name", cleaned_query)
                admin1 = best.get("admin1", "")
                country = best.get("country", "")
                parts = [p for p in [name, admin1, country] if p]
                display_name = ", ".join(parts) if parts else name

                loc_data = {
                    "latitude": round(float(best["latitude"]), 4),
                    "longitude": round(float(best["longitude"]), 4),
                    "name": name,
                    "country": country,
                    "display_name": display_name
                }
                _set_cache(cache_key, loc_data)
                return loc_data

    except Exception as e:
        logger.warning(f"Geocoding lookup failed for '{destination}': {e}")

    # 2. WeatherAPI.com Geocoding fallback if key is configured
    api_key = _get_api_key()
    if api_key:
        try:
            url = "https://api.weatherapi.com/v1/search.json"
            params = {"key": api_key, "q": cleaned_query}
            res = requests.get(url, params=params, timeout=GEOCODING_TIMEOUT)
            if res.status_code == 200:
                results = res.json()
                if isinstance(results, list) and len(results) > 0:
                    best = results[0]
                    name = best.get("name", cleaned_query)
                    region = best.get("region", "")
                    country = best.get("country", "")
                    parts = [p for p in [name, region, country] if p]
                    display_name = ", ".join(parts) if parts else name

                    loc_data = {
                        "latitude": round(float(best["lat"]), 4),
                        "longitude": round(float(best["lon"]), 4),
                        "name": name,
                        "country": country,
                        "display_name": display_name
                    }
                    _set_cache(cache_key, loc_data)
                    return loc_data
        except Exception as e:
            logger.warning(f"WeatherAPI search fallback failed for '{destination}': {e}")

    return None


# ==============================================================================
# FORECAST RETRIEVAL: OPEN-METEO
# ==============================================================================

def _fetch_open_meteo_forecast(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str
) -> Dict[str, Any]:
    """
    Queries Open-Meteo for up to 16 days of daily forecast data.
    """
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "daily": [
            "weathercode",
            "temperature_2m_max",
            "temperature_2m_min",
            "precipitation_probability_max",
            "windspeed_10m_max",
            "relative_humidity_2m_mean"
        ],
        "forecast_days": 16,
        "timezone": "auto"
    }

    try:
        res = requests.get(url, params=params, timeout=FORECAST_TIMEOUT)
    except Exception as e:
        logger.warning(f"Open-Meteo request failed: {e}")
        return {"status": "unavailable", "message": "Weather service request failed."}
    if res.status_code != 200:
        logger.warning(f"Open-Meteo forecast HTTP {res.status_code}: {res.text[:120]}")
        return {"status": "unavailable", "message": "Weather service temporarily unavailable."}

    data = res.json()
    daily = data.get("daily", {})
    times = daily.get("time", [])

    if not times:
        return {"status": "unavailable", "message": "Forecast details unavailable."}

    max_temps = daily.get("temperature_2m_max", [])
    min_temps = daily.get("temperature_2m_min", [])
    weathercodes = daily.get("weathercode", [])
    rain_probs = daily.get("precipitation_probability_max", [])
    wind_speeds = daily.get("windspeed_10m_max", [])
    humidities = daily.get("relative_humidity_2m_mean", [])

    # Filter for dates within trip range [start_date, end_date]
    daily_items = []
    for i, day_str in enumerate(times):
        if start_date <= day_str <= end_date:
            w_code = weathercodes[i] if i < len(weathercodes) else 0
            cond_name, cond_icon = WMO_CODE_MAP.get(w_code, ("Fair", "🌤️"))
            daily_items.append({
                "date": day_str,
                "min_temp": round(float(min_temps[i]), 1) if i < len(min_temps) and min_temps[i] is not None else None,
                "max_temp": round(float(max_temps[i]), 1) if i < len(max_temps) and max_temps[i] is not None else None,
                "condition": cond_name,
                "icon": cond_icon,
                "rain_prob": int(rain_probs[i]) if i < len(rain_probs) and rain_probs[i] is not None else 0,
                "wind_speed": round(float(wind_speeds[i]), 1) if i < len(wind_speeds) and wind_speeds[i] is not None else 0.0,
                "humidity": int(humidities[i]) if i < len(humidities) and humidities[i] is not None else 50,
            })

    # If no days overlapped (e.g. trip is in the future > 16 days or in past)
    if not daily_items:
        max_forecast_date = times[-1]
        if start_date > max_forecast_date:
            return {
                "status": "out_of_range",
                "message": "Detailed weather forecast is not available yet for these travel dates. Weather-based recommendations will be added when a forecast becomes available."
            }
        return {
            "status": "unavailable",
            "message": "Weather forecast is unavailable for the selected dates."
        }

    return {
        "status": "available",
        "daily_forecasts": daily_items,
        "is_partial": len(daily_items) < _date_span(start_date, end_date)
    }


# ==============================================================================
# FORECAST RETRIEVAL: WEATHERAPI.COM
# ==============================================================================

def _fetch_weatherapi_forecast(
    destination: str,
    start_date: str,
    end_date: str
) -> Dict[str, Any]:
    """
    Queries WeatherAPI.com forecast endpoint for the given location.
    """
    api_key = _get_api_key()
    if not api_key:
        return {"status": "unavailable", "message": "Weather API key not configured."}

    url = "https://api.weatherapi.com/v1/forecast.json"
    params = {
        "key": api_key,
        "q": destination,
        "days": 14,
        "aqi": "no",
        "alerts": "no"
    }

    try:
        res = requests.get(url, params=params, timeout=FORECAST_TIMEOUT)
        if res.status_code != 200:
            logger.warning(f"WeatherAPI HTTP {res.status_code}: {res.text[:120]}")
            return {"status": "unavailable", "message": "Weather service temporarily unavailable."}

        data = res.json()
        forecast_days = data.get("forecast", {}).get("forecastday", [])
        if not forecast_days:
            return {"status": "unavailable", "message": "Forecast details unavailable."}

        daily_items = []
        for item in forecast_days:
            day_str = item.get("date", "")
            if start_date <= day_str <= end_date:
                day_info = item.get("day", {})
                cond_info = day_info.get("condition", {})
                cond_text = cond_info.get("text", "Fair")

                daily_items.append({
                    "date": day_str,
                    "min_temp": round(float(day_info.get("mintemp_c", 0)), 1),
                    "max_temp": round(float(day_info.get("maxtemp_c", 0)), 1),
                    "condition": cond_text,
                    "icon": _condition_to_icon(cond_text),
                    "rain_prob": int(day_info.get("daily_chance_of_rain", 0)),
                    "wind_speed": round(float(day_info.get("maxwind_kph", 0)), 1),
                    "humidity": int(day_info.get("avghumidity", 50)),
                })

        if not daily_items:
            max_date = forecast_days[-1].get("date", "")
            if start_date > max_date:
                return {
                    "status": "out_of_range",
                    "message": "Detailed weather forecast is not available yet for these travel dates. Weather-based recommendations will be added when a forecast becomes available."
                }
            return {
                "status": "unavailable",
                "message": "Weather forecast is unavailable for the selected dates."
            }

        return {
            "status": "available",
            "daily_forecasts": daily_items,
            "location_name": data.get("location", {}).get("name", destination),
            "country": data.get("location", {}).get("country", ""),
            "is_partial": len(daily_items) < _date_span(start_date, end_date)
        }

    except Exception as e:
        logger.error(f"WeatherAPI fetch failed: {e}")
        return {"status": "unavailable", "message": "Could not connect to weather provider."}


# ==============================================================================
# MULTI-DAY ANALYSIS & SUMMARY GENERATOR
# ==============================================================================

def _date_span(start_date: str, end_date: str) -> int:
    """Calculates number of days between two YYYY-MM-DD dates."""
    try:
        d1 = datetime.strptime(start_date, "%Y-%m-%d").date()
        d2 = datetime.strptime(end_date, "%Y-%m-%d").date()
        return max(1, (d2 - d1).days + 1)
    except Exception:
        return 1


def _condition_to_icon(condition: str) -> str:
    """Maps text condition to an emoji icon."""
    c = (condition or "").lower()
    if "thunder" in c or "storm" in c:
        return "⛈️"
    if "snow" in c or "blizzard" in c or "ice" in c or "sleet" in c:
        return "❄️"
    if "rain" in c or "drizzle" in c or "shower" in c:
        return "🌧️"
    if "cloud" in c or "overcast" in c:
        return "☁️"
    if "fog" in c or "mist" in c:
        return "🌫️"
    if "clear" in c or "sun" in c:
        return "☀️"
    return "🌤️"


def _generate_human_summary(
    min_temp: float,
    max_temp: float,
    max_rain_prob: int,
    dominant_condition: str,
    max_wind: float
) -> str:
    """
    Generates a natural, realistic summary of the overall trip weather.
    """
    temp_desc = []
    if max_temp >= TEMP_THRESHOLDS["EXTREME_HEAT"]:
        temp_desc.append("Very hot days")
    elif max_temp >= TEMP_THRESHOLDS["HOT"]:
        temp_desc.append("Warm afternoons")
    elif max_temp >= TEMP_THRESHOLDS["WARM_MIN"]:
        temp_desc.append("Pleasant warm days")
    elif max_temp >= TEMP_THRESHOLDS["MILD_MIN"]:
        temp_desc.append("Mild daytime weather")
    elif max_temp >= TEMP_THRESHOLDS["COOL_MIN"]:
        temp_desc.append("Cool daytime temperatures")
    else:
        temp_desc.append("Cold daytime conditions")

    if min_temp < TEMP_THRESHOLDS["FREEZING_MAX"]:
        temp_desc.append("freezing nights")
    elif min_temp < TEMP_THRESHOLDS["COLD_MAX"]:
        temp_desc.append("cold mornings and evenings")
    elif min_temp < TEMP_THRESHOLDS["COOL_MIN"]:
        temp_desc.append("chilly nights")
    elif min_temp < TEMP_THRESHOLDS["MILD_MIN"]:
        temp_desc.append("cool evenings")

    base = " with ".join(temp_desc) if len(temp_desc) > 1 else temp_desc[0]

    precip_note = ""
    if max_rain_prob >= 70:
        precip_note = f", with frequent rain expected ({max_rain_prob}% chance)"
    elif max_rain_prob >= TEMP_THRESHOLDS["RAIN_PROB_THRESHOLD"]:
        precip_note = f", with a chance of rain ({max_rain_prob}%)"
    elif "rain" in dominant_condition.lower():
        precip_note = ", with possible passing showers"

    wind_note = ""
    if max_wind >= TEMP_THRESHOLDS["WIND_SPEED_THRESHOLD"]:
        wind_note = " and gusty winds"

    # Clothing recommendation snippet
    advice = []
    if min_temp < TEMP_THRESHOLDS["COLD_MAX"]:
        advice.append("warm layers")
    elif min_temp < TEMP_THRESHOLDS["COOL_MIN"]:
        advice.append("a light jacket")

    if max_rain_prob >= TEMP_THRESHOLDS["RAIN_PROB_THRESHOLD"]:
        advice.append("rain protection")
    elif max_temp >= TEMP_THRESHOLDS["HOT"]:
        advice.append("sun protection")

    advice_str = ""
    if advice:
        advice_str = f" Pack {' and '.join(advice)}."

    return f"{base}{precip_note}{wind_note}. ({round(min_temp)}°C – {round(max_temp)}°C).{advice_str}"


def _aggregate_trip_weather(
    destination_name: str,
    start_date: str,
    end_date: str,
    daily_items: List[Dict[str, Any]],
    is_partial: bool = False
) -> Dict[str, Any]:
    """
    Computes aggregated metrics across all available travel dates.
    """
    valid_mins = [d["min_temp"] for d in daily_items if d["min_temp"] is not None]
    valid_maxs = [d["max_temp"] for d in daily_items if d["max_temp"] is not None]
    rain_probs = [d["rain_prob"] for d in daily_items if d["rain_prob"] is not None]
    wind_speeds = [d["wind_speed"] for d in daily_items if d["wind_speed"] is not None]
    humidities = [d["humidity"] for d in daily_items if d["humidity"] is not None]

    min_temp = min(valid_mins) if valid_mins else 15.0
    max_temp = max(valid_maxs) if valid_maxs else 25.0
    avg_temp = round((min_temp + max_temp) / 2.0, 1)

    max_rain = max(rain_probs) if rain_probs else 0
    max_wind = max(wind_speeds) if wind_speeds else 0.0
    avg_humidity = round(sum(humidities) / len(humidities)) if humidities else 50

    # Collect distinct conditions
    conditions = []
    cond_counts: Dict[str, int] = {}
    for d in daily_items:
        c = d.get("condition", "Fair")
        if c not in conditions:
            conditions.append(c)
        cond_counts[c] = cond_counts.get(c, 0) + 1

    # Determine dominant condition
    dominant_condition = "Fair"
    if max_rain >= 50:
        dominant_condition = "Rain Expected" if max_rain >= 70 else "Rain Possible"
    elif any("rain" in c.lower() for c in conditions):
        dominant_condition = "Passing Showers"
    elif any("snow" in c.lower() for c in conditions):
        dominant_condition = "Snow"
    elif any("cloud" in c.lower() for c in conditions):
        dominant_condition = "Cloudy"
    elif any("clear" in c.lower() or "sun" in c.lower() for c in conditions):
        dominant_condition = "Clear / Sunny"
    elif conditions:
        dominant_condition = max(cond_counts, key=cond_counts.get)

    icon = _condition_to_icon(dominant_condition)

    summary = _generate_human_summary(
        min_temp=min_temp,
        max_temp=max_temp,
        max_rain_prob=max_rain,
        dominant_condition=dominant_condition,
        max_wind=max_wind
    )

    return {
        "status": "available",
        "location": destination_name,
        "start_date": start_date,
        "end_date": end_date,
        "min_temp": round(min_temp, 1),
        "max_temp": round(max_temp, 1),
        "avg_temp": avg_temp,
        "dominant_condition": dominant_condition,
        "conditions": conditions,
        "icon": icon,
        "rain_probability": max_rain,
        "humidity": avg_humidity,
        "wind_speed": max_wind,
        "summary": summary,
        "daily_forecasts": daily_items,
        "is_partial": is_partial,
        "message": None,
        "fetched_at": datetime.now(timezone.utc).isoformat()
    }


# ==============================================================================
# PUBLIC ENTRY POINT: GET_WEATHER
# ==============================================================================

def get_forecast(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    destination_name: str = ""
) -> Dict[str, Any]:
    """
    Fetches and normalizes forecast for exact coordinates.
    """
    res = _fetch_open_meteo_forecast(latitude, longitude, start_date, end_date)
    if res.get("status") == "available":
        daily_items = res.get("daily_forecasts", [])
        return _aggregate_trip_weather(
            destination_name=destination_name or f"{latitude},{longitude}",
            start_date=start_date,
            end_date=end_date,
            daily_items=daily_items,
            is_partial=res.get("is_partial", False)
        )
    return res


def get_weather(
    destination: str,
    start_date: str,
    end_date: str
) -> Dict[str, Any]:
    """
    Main entry point for BagBuddy weather integration.

    Parameters:
        destination (str): City, region, or place name (e.g. 'Manali', 'Paris')
        start_date (str): Travel start date in YYYY-MM-DD format
        end_date (str): Travel end date in YYYY-MM-DD format

    Returns:
        dict: Normalized weather summary adhering to the BagBuddy specification.
              Guaranteed never to throw an unhandled exception.
    """
    if not destination or not destination.strip():
        return {
            "status": "unavailable",
            "location": destination or "Unknown",
            "message": "Please specify a travel destination to check weather."
        }

    cleaned_dest = destination.strip()

    # Validate dates
    try:
        d_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        d_end = datetime.strptime(end_date, "%Y-%m-%d").date()
        if d_end < d_start:
            return {
                "status": "unavailable",
                "location": cleaned_dest,
                "message": "Return date cannot be earlier than departure date."
            }
    except Exception:
        return {
            "status": "unavailable",
            "location": cleaned_dest,
            "message": "Valid travel dates are required to check weather forecast."
        }

    # Check cache
    cache_key = f"weather_{cleaned_dest.lower()}_{start_date}_{end_date}"
    cached = _get_cache(cache_key)
    if cached:
        return cached

    # Determine provider
    provider = _get_provider()
    result = None

    # Option A: WeatherAPI if configured
    if provider == "weatherapi":
        try:
            api_res = _fetch_weatherapi_forecast(cleaned_dest, start_date, end_date)
            if api_res.get("status") == "available":
                daily_items = api_res.get("daily_forecasts", [])
                loc_name = api_res.get("location_name", cleaned_dest)
                country = api_res.get("country", "")
                full_name = f"{loc_name}, {country}" if country else loc_name
                result = _aggregate_trip_weather(
                    destination_name=full_name,
                    start_date=start_date,
                    end_date=end_date,
                    daily_items=daily_items,
                    is_partial=api_res.get("is_partial", False)
                )
            elif api_res.get("status") == "out_of_range":
                result = {
                    "status": "out_of_range",
                    "location": cleaned_dest,
                    "start_date": start_date,
                    "end_date": end_date,
                    "message": api_res.get("message")
                }
        except Exception as e:
            logger.warning(f"WeatherAPI attempt failed, falling back to Open-Meteo: {e}")

    # Option B: Open-Meteo (Default or automatic fallback)
    if not result:
        try:
            loc = get_location(cleaned_dest)
            if not loc:
                result = {
                    "status": "unavailable",
                    "location": cleaned_dest,
                    "start_date": start_date,
                    "end_date": end_date,
                    "message": f"Could not find coordinates for destination '{cleaned_dest}'."
                }
            else:
                lat = loc["latitude"]
                lon = loc["longitude"]
                disp_name = loc["display_name"]
                result = get_forecast(lat, lon, start_date, end_date, destination_name=disp_name)

        except requests.exceptions.Timeout:
            logger.warning(f"Weather request timed out for {cleaned_dest}")
            result = {
                "status": "unavailable",
                "location": cleaned_dest,
                "start_date": start_date,
                "end_date": end_date,
                "message": "Weather service timed out. Packing list generated without live weather."
            }
        except Exception as e:
            logger.error(f"Weather engine error for {cleaned_dest}: {e}")
            result = {
                "status": "unavailable",
                "location": cleaned_dest,
                "start_date": start_date,
                "end_date": end_date,
                "message": "Weather information is currently unavailable. Your packing list was generated using your trip details and activities."
            }

    # Store in cache if meaningful result
    if result:
        _set_cache(cache_key, result)

    return result
