# test_weather_integration.py
"""
Automated Test Suite for BagBuddy Weather API Integration.
Tests all 10 requirements defined in the specification.
"""

import unittest
from datetime import datetime, timedelta
from engines.weather_engine import get_weather, get_location, get_forecast, TEMP_THRESHOLDS
from packing_engine import generate_packing_list, find_item
import database
from supabase_client import supabase_db


class TestBagBuddyWeatherIntegration(unittest.TestCase):

    def setUp(self):
        database.init_db()

    # -------------------------------------------------------------------------
    # TEST 1: Hot destination
    # Expected: Light clothes, sunglasses, cap, sunscreen, water bottle, no heavy winter clothing
    # -------------------------------------------------------------------------
    def test_01_hot_destination(self):
        trip = {
            "destination": "Dubai",
            "start_date": "2026-06-01",
            "end_date": "2026-06-05",
            "travel_mode": "Flight",
            "trip_type": "Vacation",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 10.0,
            "activities": []
        }
        hot_weather = {
            "status": "available",
            "location": "Dubai, United Arab Emirates",
            "min_temp": 28.0,
            "max_temp": 38.0,
            "rain_probability": 5,
            "dominant_condition": "Sunny",
            "conditions": ["Clear", "Sunny"],
            "wind_speed": 14.0
        }
        result = generate_packing_list(trip, weather_data=hot_weather)

        # Check that sun protection and hot weather items are recommended
        item_names = [i["name"] for i in result["items"]]
        self.assertIn("Sunscreen", item_names)
        self.assertIn("Sunglasses", item_names)
        self.assertIn("Cap / Sun Hat", item_names)
        self.assertIn("Reusable Water Bottle", item_names)

        # Ensure heavy cold-weather items are NOT recommended
        self.assertNotIn("Warm Jacket", item_names)
        self.assertNotIn("Thermal Wear (Top & Bottom)", item_names)
        self.assertNotIn("Sweater / Fleece", item_names)

        # Check weather reason is attached
        sunscreen = find_item(result["categories"], "Sunscreen")
        self.assertIsNotNone(sunscreen)
        self.assertTrue("weather_reason" in sunscreen)

    # -------------------------------------------------------------------------
    # TEST 2: Cold destination
    # Expected: Warm jacket, sweater, warm socks, thermal wear if freezing, lip balm
    # -------------------------------------------------------------------------
    def test_02_cold_destination(self):
        trip = {
            "destination": "Manali",
            "start_date": "2026-12-10",
            "end_date": "2026-12-14",
            "travel_mode": "Car",
            "trip_type": "Vacation",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 15.0,
            "activities": []
        }
        cold_weather = {
            "status": "available",
            "location": "Manali, Himachal Pradesh, India",
            "min_temp": 2.0,  # Below 5°C freezing threshold
            "max_temp": 9.0,   # Cold daytime (<10°C)
            "rain_probability": 15,
            "dominant_condition": "Cold / Clear",
            "conditions": ["Clear"],
            "wind_speed": 10.0
        }
        result = generate_packing_list(trip, weather_data=cold_weather)
        item_names = [i["name"] for i in result["items"]]

        self.assertIn("Warm Jacket", item_names)
        self.assertIn("Sweater / Fleece", item_names)
        self.assertIn("Warm Socks", item_names)
        self.assertIn("Thermal Wear (Top & Bottom)", item_names)
        self.assertIn("Gloves & Beanie Cap", item_names)

        jacket = find_item(result["categories"], "Warm Jacket")
        self.assertIn("temperatures may fall below 10°C", jacket["weather_reason"])

    # -------------------------------------------------------------------------
    # TEST 3: Rainy destination
    # Expected: Umbrella, raincoat/poncho, waterproof bag cover, quick-dry clothes
    # -------------------------------------------------------------------------
    def test_03_rainy_destination(self):
        trip = {
            "destination": "Cherrapunji",
            "start_date": "2026-07-10",
            "end_date": "2026-07-15",
            "travel_mode": "Car",
            "trip_type": "Vacation",
            "profile": "Female",
            "adults": 1,
            "children": 0,
            "weight_limit": 12.0,
            "activities": []
        }
        rainy_weather = {
            "status": "available",
            "location": "Cherrapunji, Meghalaya, India",
            "min_temp": 18.0,
            "max_temp": 23.0,
            "rain_probability": 85,
            "dominant_condition": "Rain",
            "conditions": ["Rain", "Heavy Rain"],
            "wind_speed": 15.0
        }
        result = generate_packing_list(trip, weather_data=rainy_weather)
        item_names = [i["name"] for i in result["items"]]

        self.assertIn("Umbrella", item_names)
        self.assertIn("Raincoat / Poncho", item_names)
        self.assertIn("Waterproof Bag Cover", item_names)
        self.assertIn("Quick-Dry Clothes", item_names)

        umbrella = find_item(result["categories"], "Umbrella")
        self.assertIn("rain is expected", umbrella["weather_reason"])

    # -------------------------------------------------------------------------
    # TEST 4: Mixed weather
    # Expected: Cool morning layers + rain protection + moderate daytime gear
    # -------------------------------------------------------------------------
    def test_04_mixed_weather(self):
        trip = {
            "destination": "Shimla",
            "start_date": "2026-10-10",
            "end_date": "2026-10-14",
            "travel_mode": "Train",
            "trip_type": "Vacation",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 15.0,
            "activities": ["Hiking"]
        }
        mixed_weather = {
            "status": "available",
            "location": "Shimla, Himachal Pradesh, India",
            "min_temp": 8.0,   # Chilly (<10°C)
            "max_temp": 21.0,  # Mild afternoon
            "rain_probability": 60,
            "dominant_condition": "Rain Possible",
            "conditions": ["Cloudy", "Rain Showers"],
            "wind_speed": 18.0
        }
        result = generate_packing_list(trip, weather_data=mixed_weather)
        item_names = [i["name"] for i in result["items"]]

        # Should have both cold-morning warm layers and rain gear
        self.assertIn("Warm Jacket", item_names)
        self.assertIn("Sweater / Fleece", item_names)
        self.assertIn("Umbrella", item_names)
        self.assertIn("Raincoat / Poncho", item_names)
        self.assertIn("Waterproof Shoe Covers / Gaiters", item_names)

    # -------------------------------------------------------------------------
    # TEST 5: Multi-day trip
    # Expected: Weather metrics calculated across all travel dates (min, max, peak rain)
    # -------------------------------------------------------------------------
    def test_05_multi_day_trip_weather_analysis(self):
        # Test Open-Meteo live multi-day calculation for today + next 3 days
        today = datetime.now().date()
        start = (today + timedelta(days=1)).strftime("%Y-%m-%d")
        end = (today + timedelta(days=4)).strftime("%Y-%m-%d")

        weather = get_weather("Manali", start, end)
        self.assertIn(weather.get("status"), ["available", "partial", "unavailable"])

        if weather.get("status") == "available":
            self.assertIn("min_temp", weather)
            self.assertIn("max_temp", weather)
            self.assertIn("rain_probability", weather)
            self.assertIn("summary", weather)
            self.assertGreaterEqual(len(weather.get("daily_forecasts", [])), 1)
            self.assertLessEqual(weather["min_temp"], weather["max_temp"])

    # -------------------------------------------------------------------------
    # TEST 6: Weather API failure handling
    # Expected: Packing list still generates cleanly without unhandled crash
    # -------------------------------------------------------------------------
    def test_06_weather_api_failure_handling(self):
        trip = {
            "destination": "SomeCity",
            "start_date": "2026-10-10",
            "end_date": "2026-10-14",
            "travel_mode": "Flight",
            "trip_type": "Vacation",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 7.0,
            "activities": ["Sightseeing"]
        }
        failed_weather = {
            "status": "unavailable",
            "location": "SomeCity",
            "message": "Weather service temporarily unavailable."
        }
        # Must NOT throw exception
        result = generate_packing_list(trip, weather_data=failed_weather)
        self.assertIsNotNone(result)
        self.assertGreater(len(result["items"]), 0)
        self.assertIn("👕 Clothes", result["categories"])

    # -------------------------------------------------------------------------
    # TEST 7: Invalid destination
    # Expected: Graceful fallback without crash
    # -------------------------------------------------------------------------
    def test_07_invalid_destination(self):
        weather = get_weather("NonExistentXYZCity987654321", "2026-10-10", "2026-10-14")
        self.assertIn(weather.get("status"), ["unavailable", "out_of_range"])
        self.assertIsNotNone(weather.get("message"))

    # -------------------------------------------------------------------------
    # TEST 8: Children included
    # Expected: Weather-sensitive children's items (warm jacket, rain gear, sun hat)
    # -------------------------------------------------------------------------
    def test_08_children_weather_adaptation(self):
        trip = {
            "destination": "Shimla",
            "start_date": "2026-11-01",
            "end_date": "2026-11-05",
            "travel_mode": "Car",
            "trip_type": "Vacation",
            "profile": "Family",
            "adults": 2,
            "children": 2,
            "child_age": "5 and 8",
            "weight_limit": 20.0,
            "activities": []
        }
        cold_rainy_weather = {
            "status": "available",
            "location": "Shimla",
            "min_temp": 6.0,
            "max_temp": 14.0,
            "rain_probability": 70,
            "dominant_condition": "Rain Possible",
            "conditions": ["Rain"],
            "wind_speed": 12.0
        }
        result = generate_packing_list(trip, weather_data=cold_rainy_weather)
        item_names = [i["name"] for i in result["items"]]

        self.assertIn("Children's Warm Jacket", item_names)
        self.assertIn("Children's Raincoat", item_names)
        self.assertIn("Children's Warm Socks", item_names)

    # -------------------------------------------------------------------------
    # TEST 9: Bag weight limit overload
    # Expected: Overload detected and smart bag advice includes wearing heavy jacket/shoes
    # -------------------------------------------------------------------------
    def test_09_bag_weight_limit_overload_advice(self):
        trip = {
            "destination": "Leh",
            "start_date": "2026-10-01",
            "end_date": "2026-10-10",
            "travel_mode": "Flight",
            "trip_type": "Adventure",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 3.0,  # Intentionally low to trigger overload
            "activities": ["Hiking"]
        }
        cold_weather = {
            "status": "available",
            "location": "Leh, Ladakh",
            "min_temp": 1.0,
            "max_temp": 11.0,
            "rain_probability": 10,
            "dominant_condition": "Cold",
            "conditions": ["Clear"],
            "wind_speed": 18.0
        }
        result = generate_packing_list(trip, weather_data=cold_weather)
        self.assertTrue(result["overloaded"])
        self.assertGreater(len(result["items_to_remove"]), 0)
        self.assertGreater(len(result["bag_advice"]), 0)

        # Advice should suggest wearing the jacket during transit
        advice_text = " ".join(result["bag_advice"])
        self.assertIn("jacket", advice_text.lower())

    # -------------------------------------------------------------------------
    # TEST 10: Existing Supabase / database trips (no regression)
    # Expected: Can save and load trip with weather data without errors
    # -------------------------------------------------------------------------
    def test_10_database_and_session_trip_persistence(self):
        trip_data = {
            "destination": "Goa",
            "start_date": "2026-11-10",
            "end_date": "2026-11-15",
            "travel_mode": "Flight",
            "trip_type": "Vacation",
            "profile": "Male",
            "adults": 1,
            "children": 0,
            "weight_limit": 10.0,
            "activities": ["Beach"],
            "weather_data": {
                "status": "available",
                "min_temp": 24.0,
                "max_temp": 32.0,
                "rain_probability": 10,
                "dominant_condition": "Sunny"
            }
        }
        packing_list = generate_packing_list(trip_data, weather_data=trip_data["weather_data"])

        # Test local sqlite persistence
        tid = database.create_trip(
            user_id=1,
            destination=trip_data["destination"],
            start_date=trip_data["start_date"],
            end_date=trip_data["end_date"],
            travel_mode=trip_data["travel_mode"],
            trip_type=trip_data["trip_type"],
            profile=trip_data["profile"],
            adults=1,
            children=0,
            child_age="",
            bag_type="Backpack",
            weight_limit=10.0,
            activities=trip_data["activities"],
            packing_list=packing_list,
            weather_data=trip_data["weather_data"]
        )
        self.assertIsNotNone(tid)

        saved_trip = database.get_trip_by_id(tid, 1)
        self.assertIsNotNone(saved_trip)
        self.assertEqual(saved_trip["destination"], "Goa")
        self.assertEqual(saved_trip["weather_data"].get("dominant_condition"), "Sunny")
        self.assertIn("weather", saved_trip["packing_list"])


if __name__ == "__main__":
    unittest.main()
