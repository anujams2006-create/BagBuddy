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
# Supports both SUPABASE_KEY (simple setup) and explicit ANON / SERVICE_ROLE keys
SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()

# Publishable / Anon Key
SUPABASE_ANON_KEY = (
    os.getenv("SUPABASE_ANON_KEY", "").strip()
    or os.getenv("SUPABASE_KEY", "").strip()
)
SUPABASE_KEY = SUPABASE_ANON_KEY or os.getenv("SUPABASE_KEY", "").strip()

# Service Role / Secret Key (supports SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, or SECRET_KEY if misassigned)
raw_secret = os.getenv("SECRET_KEY", "").strip()
raw_service_role = (
    os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    or os.getenv("SUPABASE_SECRET_KEY", "").strip()
)

if not raw_service_role and (raw_secret.startswith("sb_secret_") or (raw_secret.startswith("eyJ") and len(raw_secret) > 80)):
    SUPABASE_SERVICE_ROLE_KEY = raw_secret
    SECRET_KEY = os.getenv("FLASK_SECRET_KEY", "bagbuddy-production-secret-key-replace-in-env")
else:
    SUPABASE_SERVICE_ROLE_KEY = raw_service_role or SUPABASE_KEY
    SECRET_KEY = raw_secret or "bagbuddy-production-secret-key-replace-in-env"

# External APIs
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "").strip()
WEATHER_PROVIDER = os.getenv("WEATHER_PROVIDER", "open-meteo").strip().lower()

# Gemini credentials are intentionally backend-only.  AI_API_KEY is retained as
# a backwards-compatible fallback for older local installations.
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip() or os.getenv("AI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash").strip() or "gemini-3.8-flash"


def validate_supabase_config(logger=None) -> bool:
    """
    Validates that SUPABASE_URL and SUPABASE_KEY are provided in the environment.
    Provides clear developer-facing diagnostic instructions if missing.
    """
    is_valid = bool(SUPABASE_URL and SUPABASE_KEY)
    if not is_valid:
        notice = (
            "\n" + "=" * 68 + "\n"
            "[WARNING] [BAGBUDDY BACKEND NOTICE: SUPABASE CONFIGURATION MISSING]\n"
            "Set SUPABASE_URL and SUPABASE_KEY in your environment or .env file:\n"
            "    SUPABASE_URL=https://<your-project-id>.supabase.co\n"
            "    SUPABASE_KEY=<your-supabase-api-key>\n"
            "The production backend requires these to persist users and trips.\n"
            + "=" * 68 + "\n"
        )
        if logger:
            logger.warning(notice)
        else:
            print(notice)
    return is_valid

