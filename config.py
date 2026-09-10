import os
from dotenv import load_dotenv

# Load local .env file if present
load_dotenv()

# Environment & Debugging
FLASK_ENV = os.getenv("FLASK_ENV", "production")
DEBUG = os.getenv("DEBUG", "False").strip().lower() in ("true", "1", "t", "yes")

# Secret key for session signing
SECRET_KEY = os.getenv(
    "SECRET_KEY",
    "bagbuddy-production-secret-key-replace-in-env"
)

# Supabase Production Infrastructure
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip()
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

# External APIs
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "").strip()
AI_API_KEY = os.getenv("AI_API_KEY", "").strip()