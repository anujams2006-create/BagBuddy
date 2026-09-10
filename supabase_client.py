# ==============================================================================
# BAGBUDDY — SUPABASE PRODUCTION CLIENT & REPOSITORY
# ==============================================================================
import logging
import traceback
from typing import Optional, Tuple, Dict, Any, List
import config

logger = logging.getLogger("bagbuddy.supabase")

# Attempt importing the official Supabase library
try:
    from supabase import create_client, Client
    SUPABASE_LIB_AVAILABLE = True
except ImportError:
    create_client = None
    Client = None
    SUPABASE_LIB_AVAILABLE = False


class SupabaseService:
    """
    Manages persistent user authentication, profiles, and trip data via Supabase.
    Falls back gracefully to local storage if Supabase credentials are not yet set
    during local development or test suites.
    """

    def __init__(self):
        self.url = config.SUPABASE_URL
        self.key = config.SUPABASE_SERVICE_ROLE_KEY or config.SUPABASE_ANON_KEY
        self.anon_key = config.SUPABASE_ANON_KEY
        self._client: Optional[Any] = None
        self._initialized = False

    def is_configured(self) -> bool:
        """Returns True if Supabase credentials and library are available."""
        return bool(self.url and self.anon_key and SUPABASE_LIB_AVAILABLE)

    def get_client(self) -> Optional[Any]:
        """Lazy-loads and returns the Supabase client instance."""
        if not self.is_configured():
            return None

        if self._client is None:
            try:
                # Prefer service role key if available server-side, else public anon key
                auth_key = self.key if self.key else self.anon_key
                self._client = create_client(self.url, auth_key)
                logger.info("Connected to Supabase production infrastructure.")
            except Exception as e:
                logger.error(f"Failed to initialize Supabase client: {e}")
                traceback.print_exc()
                self._client = None

        return self._client

    # ==========================================================================
    # AUTHENTICATION & PROFILES
    # ==========================================================================

    def sign_up(self, name: str, email: str, password: str) -> Tuple[bool, Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Signs up a user with Supabase Auth.
        Returns: (success, user_id, name, email, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            user_id = database.create_user(name, email, password)
            if user_id:
                return True, str(user_id), name, email, None
            return False, None, None, None, "An account with this email already exists."

        try:
            res = client.auth.sign_up({
                "email": email,
                "password": password,
                "options": {
                    "data": {"name": name}
                }
            })

            if not res or not res.user:
                return False, None, None, None, "Could not create account. Please try again."

            user_id = str(res.user.id)
            user_name = name or email.split("@")[0]

            # Upsert into public.profiles to guarantee profile exists
            try:
                client.table("profiles").upsert({
                    "id": user_id,
                    "name": user_name,
                    "email": email
                }).execute()
            except Exception as pe:
                logger.warning(f"Profile upsert note (handled by trigger or: {pe})")

            return True, user_id, user_name, email, None

        except Exception as e:
            err_msg = str(e).lower()
            logger.error(f"Supabase sign_up error: {e}")
            if "already registered" in err_msg or "user already exists" in err_msg:
                return False, None, None, None, "An account with this email already exists."
            return False, None, None, None, "Could not create account. Please check your details."

    def sign_in(self, email: str, password: str) -> Tuple[bool, Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Authenticates a user with Supabase Auth.
        Returns: (success, user_id, name, email, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            user = database.get_user_by_email(email)
            if user and database.verify_password(user["password"], password):
                return True, str(user["id"]), user["name"], user["email"], None
            return False, None, None, None, "Invalid email or password."

        try:
            res = client.auth.sign_in_with_password({
                "email": email,
                "password": password
            })

            if not res or not res.user:
                return False, None, None, None, "Invalid email or password."

            user_id = str(res.user.id)

            # Retrieve user name from metadata or profiles table
            name = None
            if res.user.user_metadata and "name" in res.user.user_metadata:
                name = res.user.user_metadata["name"]

            if not name:
                try:
                    prof = client.table("profiles").select("name").eq("id", user_id).single().execute()
                    if prof and prof.data:
                        name = prof.data.get("name")
                except Exception:
                    pass

            if not name:
                name = email.split("@")[0]

            return True, user_id, name, email, None

        except Exception as e:
            logger.warning(f"Supabase sign_in failed: {e}")
            return False, None, None, None, "Invalid email or password."

    # ==========================================================================
    # TRIPS MANAGEMENT
    # ==========================================================================

    def create_trip(self, user_id: str, trip_data: Dict[str, Any], packing_list: Dict[str, Any]) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Persists a newly planned trip and its generated packing checklist in Supabase.
        Returns: (success, trip_id, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            trip_id = database.create_trip(
                user_id=int(user_id) if str(user_id).isdigit() else 1,
                destination=trip_data.get("destination", ""),
                start_date=trip_data.get("start_date", ""),
                end_date=trip_data.get("end_date", ""),
                travel_mode=trip_data.get("travel_mode", ""),
                trip_type=trip_data.get("trip_type", ""),
                profile=trip_data.get("profile", ""),
                adults=trip_data.get("adults", 1),
                children=trip_data.get("children", 0),
                child_age=trip_data.get("child_age", ""),
                bag_type=trip_data.get("bag_type", "Backpack"),
                weight_limit=trip_data.get("weight_limit", 7.0)
            )
            return True, str(trip_id), None

        try:
            payload = {
                "user_id": str(user_id),
                "destination": trip_data.get("destination", "").strip(),
                "start_date": str(trip_data.get("start_date", "")),
                "end_date": str(trip_data.get("end_date", "")),
                "travel_mode": str(trip_data.get("travel_mode", "")),
                "trip_type": trip_data.get("trip_type") or None,
                "profile": trip_data.get("profile") or None,
                "adults": int(trip_data.get("adults", 1) or 1),
                "children": int(trip_data.get("children", 0) or 0),
                "child_age": trip_data.get("child_age") or None,
                "bag_type": str(trip_data.get("bag_type", "Backpack")),
                "weight_limit": float(trip_data.get("weight_limit", 7.0) or 7.0),
                "activities": trip_data.get("activities", []),
                "makeup": trip_data.get("makeup", []),
                "toiletries": trip_data.get("toiletries", []),
                "shifting_items": trip_data.get("shifting_items", []),
                "personalization": trip_data.get("personalization", []),
                "packing_list": packing_list or {}
            }

            res = client.table("trips").insert(payload).execute()
            if res and res.data and len(res.data) > 0:
                created_id = str(res.data[0].get("id"))
                return True, created_id, None

            return False, None, "We could not save your trip. Please try again."

        except Exception as e:
            logger.error(f"Supabase create_trip error: {e}")
            traceback.print_exc()
            return False, None, "We could not save your trip right now. Please try again."

    def get_user_trips(self, user_id: str) -> List[Dict[str, Any]]:
        """
        Retrieves all trips belonging strictly to the authenticated user.
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            rows = database.get_user_trips(uid)
            return [dict(row) for row in rows]

        try:
            res = client.table("trips")\
                .select("*")\
                .eq("user_id", str(user_id))\
                .order("created_at", desc=True)\
                .execute()
            return res.data or []
        except Exception as e:
            logger.error(f"Supabase get_user_trips error: {e}")
            return []

    def get_trip_by_id(self, trip_id: str, user_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves a single trip, verifying ownership strictly.
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            conn = database.get_db()
            uid = int(user_id) if str(user_id).isdigit() else 1
            tid = int(trip_id) if str(trip_id).isdigit() else 1
            row = conn.execute("SELECT * FROM trips WHERE id = ? AND user_id = ?", (tid, uid)).fetchone()
            conn.close()
            return dict(row) if row else None

        try:
            res = client.table("trips")\
                .select("*")\
                .eq("id", str(trip_id))\
                .eq("user_id", str(user_id))\
                .single()\
                .execute()
            return res.data if res else None
        except Exception as e:
            logger.error(f"Supabase get_trip_by_id error: {e}")
            return None

    def delete_trip(self, trip_id: str, user_id: str) -> bool:
        """
        Deletes a trip if and only if it belongs to user_id.
        """
        client = self.get_client()
        if not client:
            # Fallback to local database
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            tid = int(trip_id) if str(trip_id).isdigit() else 1
            database.delete_trip(tid, uid)
            return True

        try:
            client.table("trips")\
                .delete()\
                .eq("id", str(trip_id))\
                .eq("user_id", str(user_id))\
                .execute()
            return True
        except Exception as e:
            logger.error(f"Supabase delete_trip error: {e}")
            return False


# Singleton instance exported for application usage
supabase_db = SupabaseService()
