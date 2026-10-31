# weather_engine.py
"""
Root-level Weather Engine facade for BagBuddy.
Re-exports the implementation from engines/weather_engine.py.
"""

from engines.weather_engine import (
    get_weather,
    get_location,
    get_forecast,
    TEMP_THRESHOLDS,
    WMO_CODE_MAP,
)

__all__ = [
    "get_weather",
    "get_location",
    "get_forecast",
    "TEMP_THRESHOLDS",
    "WMO_CODE_MAP",
]
