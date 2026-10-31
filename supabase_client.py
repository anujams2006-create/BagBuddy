# ==============================================================================
# BAGBUDDY — SUPABASE PRODUCTION CLIENT & DATA REPOSITORY
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
    Production data and authentication service powered by Supabase.
    Serves as the persistent source of truth for user authentication (Supabase Auth)
    and travel data (PostgreSQL profiles & trips).

    Falls back to local development storage only when Supabase credentials are not configured.
    """

    def __init__(self):
        self.url = config.SUPABASE_URL
        self.key = config.SUPABASE_KEY
        self.anon_key = config.SUPABASE_ANON_KEY
        self.service_key = config.SUPABASE_SERVICE_ROLE_KEY
        self._client: Optional[Any] = None
        self._admin_client: Optional[Any] = None

    def is_configured(self) -> bool:
        """Returns True if Supabase credentials and library are present."""
        return bool(self.url and self.key and SUPABASE_LIB_AVAILABLE)

    def get_client(self) -> Optional[Any]:
        """Lazy-loads and returns the singleton Supabase client instance."""
        if not self.is_configured():
            return None

        if self._client is None:
            try:
                # Use provided key (service_role or anon key)
                auth_key = self.key
                self._client = create_client(self.url, auth_key)
                logger.info("Connected to Supabase production infrastructure.")
            except Exception as e:
                logger.error(f"Failed to initialize Supabase client: {e}")
                traceback.print_exc()
                self._client = None

        return self._client

    def get_admin_client(self) -> Optional[Any]:
        """Lazy-loads and returns an admin Supabase client using service role / secret key if available."""
        if getattr(self, "_admin_client", None) is not None:
            return self._admin_client

        if not (self.url and self.service_key and SUPABASE_LIB_AVAILABLE):
            return None

        # If key was customized (e.g. in tests) without also customizing service_key
        if self.key != config.SUPABASE_KEY and self.service_key == config.SUPABASE_SERVICE_ROLE_KEY:
            return None

        # Check if service_key is a valid secret/service_role key
        is_secret_key = self.service_key.startswith("sb_secret_") or (self.service_key.startswith("eyJ") and len(self.service_key) > 80)
        if not is_secret_key:
            return None

        try:
            self._admin_client = create_client(self.url, self.service_key)
            logger.info("Connected to Supabase Admin infrastructure.")
        except Exception as e:
            logger.warning(f"Failed to initialize Supabase Admin client: {e}")
            self._admin_client = None

        return self._admin_client

    def get_table(self, table_name: str, token: Optional[str] = None):
        """
        Returns a PostgREST query builder for the given table.
        If a user access token is provided, attaches it so RLS policies can authenticate the user.
        """
        client = self.get_client()
        if not client:
            return None

        if token:
            try:
                return client.postgrest.auth(token).from_(table_name)
            except Exception as e:
                logger.debug(f"Could not attach user auth token to query, using default client: {e}")

        return client.table(table_name)

    # ==========================================================================
    # 1. AUTHENTICATION & USER PROFILES
    # ==========================================================================

    def sign_up(
        self,
        name: str,
        email: str,
        password: str
    ) -> Tuple[bool, Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Signs up a user with Supabase Auth and ensures their profile record exists.
        Returns: (success, user_id, name, email, token, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local development storage
            import database
            uid = database.create_user(name, email, password)
            if uid:
                return True, str(uid), name, email, None, None
            return False, None, None, None, None, "An account with this email already exists. Please log in instead."

        admin_client = self.get_admin_client()

        # Strategy A: Use Admin API to create user with email pre-confirmed
        # This prevents users from getting locked out due to unconfirmed emails
        if admin_client:
            try:
                res = admin_client.auth.admin.create_user({
                    "email": email,
                    "password": password,
                    "email_confirm": True,
                    "user_metadata": {"name": name}
                })

                if not res or not res.user:
                    return False, None, None, None, None, "Could not create account. Please check your details."

                user_id = str(res.user.id)
                user_name = name or email.split("@")[0]

                # Ensure profile record exists
                try:
                    admin_client.table("profiles").upsert({
                        "id": user_id,
                        "user_id": user_id,
                        "name": user_name,
                        "email": email
                    }).execute()
                except Exception as pe:
                    logger.debug(f"Automatic profile upsert note via admin: {pe}")

                return True, user_id, user_name, email, None, None

            except Exception as e:
                err_str = str(e).lower()
                logger.error(f"Supabase admin sign_up error: {e}")
                if ("already" in err_str and "registered" in err_str) or "user already exists" in err_str or "already exists" in err_str or "violates unique" in err_str:
                    return False, None, None, None, None, "An account with this email already exists. Please log in instead."
                if "invalid" in err_str and "email" in err_str:
                    return False, None, None, None, None, "Please enter a valid email address."
                if "password" in err_str and ("short" in err_str or "least" in err_str or "characters" in err_str):
                    return False, None, None, None, None, "Password should be at least 6 characters long."
                if "rate limit" in err_str:
                    return False, None, None, None, None, "Too many requests. Please wait a few moments before trying again."
                # Network / connection failures — fall through to Strategy B / local DB
                if any(kw in err_str for kw in ("connect", "timeout", "connection", "getaddrinfo", "errno", "network", "unreachable", "refused")):
                    logger.warning("Admin sign_up network error; falling through to Strategy B.")
                    # fall through to Strategy B below
                else:
                    msg = getattr(e, "message", None) or str(e)
                    return False, None, None, None, None, f"Could not create account: {msg}"

        # Strategy B: Standard signup via client.auth.sign_up
        try:
            res = client.auth.sign_up({
                "email": email,
                "password": password,
                "options": {
                    "data": {"name": name}
                }
            })

            if not res or not res.user:
                return False, None, None, None, None, "Could not create account. Please check your details."

            user_id = str(res.user.id)
            user_name = name or (res.user.user_metadata.get("name") if res.user.user_metadata else None) or email.split("@")[0]
            token = res.session.access_token if res.session else None

            # Ensure profile record exists in public.profiles
            try:
                table = self.get_table("profiles", token=token)
                if table:
                    table.upsert({
                        "id": user_id,
                        "user_id": user_id,
                        "name": user_name,
                        "email": email
                    }).execute()
            except Exception as pe:
                logger.debug(f"Automatic profile upsert note: {pe}")

            return True, user_id, user_name, email, token, None

        except Exception as e:
            err_str = str(e).lower()
            logger.error(f"Supabase sign_up error: {e}")
            if ("already" in err_str and "registered" in err_str) or "user already exists" in err_str or "already exists" in err_str or "violates unique" in err_str:
                return False, None, None, None, None, "An account with this email already exists. Please log in instead."
            if "invalid" in err_str and "email" in err_str:
                return False, None, None, None, None, "Please enter a valid email address."
            if "password" in err_str and ("short" in err_str or "least" in err_str or "characters" in err_str):
                return False, None, None, None, None, "Password should be at least 6 characters long."
            if "rate limit" in err_str:
                return False, None, None, None, None, "Too many requests. Please wait a few moments before trying again."
            # Network / connection error — fall back to local SQLite storage
            if any(kw in err_str for kw in ("connect", "timeout", "connection", "getaddrinfo", "errno", "network", "unreachable", "refused")):
                logger.warning("Supabase sign_up network error; falling back to local database.")
                import database
                uid = database.create_user(name, email, password)
                if uid:
                    return True, str(uid), name, email, None, None
                return False, None, None, None, None, "An account with this email already exists. Please log in instead."
            msg = getattr(e, "message", None) or str(e)
            return False, None, None, None, None, f"Could not create account: {msg}"

    def sign_in(
        self,
        email: str,
        password: str
    ) -> Tuple[bool, Optional[str], Optional[str], Optional[str], Optional[str], Optional[str]]:
        """
        Authenticates a user via Supabase Auth and retrieves their profile details.
        Returns: (success, user_id, name, email, token, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local development storage
            import database
            user = database.get_user_by_email(email)
            if user and database.verify_password(user["password"], password):
                return True, str(user["id"]), user["name"], user["email"], None, None
            return False, None, None, None, None, "Invalid email or password."

        try:
            res = client.auth.sign_in_with_password({
                "email": email,
                "password": password
            })

            if not res or not res.user:
                return False, None, None, None, None, "Invalid email or password."

            user_id = str(res.user.id)
            user_email = res.user.email or email
            token = res.session.access_token if res.session else None

            # Retrieve profile name from profiles table or user metadata
            user_name = None
            try:
                table = self.get_table("profiles", token=token)
                if table:
                    prof = table.select("name, email").eq("id", user_id).single().execute()
                    if prof and prof.data:
                        user_name = prof.data.get("name")
            except Exception as pe:
                logger.debug(f"Profile lookup note: {pe}")

            if not user_name:
                if res.user.user_metadata and "name" in res.user.user_metadata:
                    user_name = res.user.user_metadata["name"]
                else:
                    user_name = email.split("@")[0]

                # Self-heal missing profile row
                try:
                    admin_client = self.get_admin_client()
                    if admin_client:
                        admin_client.table("profiles").upsert({
                            "id": user_id,
                            "user_id": user_id,
                            "name": user_name,
                            "email": user_email
                        }).execute()
                    else:
                        table = self.get_table("profiles", token=token)
                        if table:
                            table.upsert({
                                "id": user_id,
                                "user_id": user_id,
                                "name": user_name,
                                "email": user_email
                            }).execute()
                except Exception:
                    pass

            return True, user_id, user_name, user_email, token, None

        except Exception as e:
            err_str = str(e).lower()
            logger.warning(f"Supabase sign_in failed: {e}")

            # Specific handling for unconfirmed email
            if "email not confirmed" in err_str:
                # If admin client is available, auto-confirm user and retry
                admin_client = self.get_admin_client()
                if admin_client:
                    try:
                        users = admin_client.auth.admin.list_users()
                        matching_user = next((u for u in users if u.email and u.email.lower() == email.lower()), None)
                        if matching_user:
                            admin_client.auth.admin.update_user_by_id(matching_user.id, {"email_confirm": True})
                            logger.info(f"Auto-confirmed user {matching_user.id}. Retrying sign-in.")
                            retry_res = client.auth.sign_in_with_password({
                                "email": email,
                                "password": password
                            })
                            if retry_res and retry_res.user:
                                retry_uid = str(retry_res.user.id)
                                retry_email = retry_res.user.email or email
                                retry_token = retry_res.session.access_token if retry_res.session else None
                                retry_name = (retry_res.user.user_metadata or {}).get("name") or email.split("@")[0]
                                return True, retry_uid, retry_name, retry_email, retry_token, None
                    except Exception as confirm_err:
                        logger.warning(f"Auto-confirm retry error: {confirm_err}")

                return False, None, None, None, None, "Please confirm your email address before logging in. Check your inbox for the confirmation link."

            if "invalid login credentials" in err_str or "invalid credentials" in err_str:
                return False, None, None, None, None, "Invalid email or password."

            if "user not found" in err_str:
                return False, None, None, None, None, "No account found with this email. Please sign up."

            if "rate limit" in err_str or "too many requests" in err_str:
                return False, None, None, None, None, "Too many login attempts. Please wait a few minutes."

            # Network / connection error fallback
            if any(kw in err_str for kw in ("connect", "timeout", "connection", "getaddrinfo", "errno", "network", "unreachable", "refused")):
                import database
                local_user = database.get_user_by_email(email)
                if local_user and database.verify_password(local_user["password"], password):
                    return True, str(local_user["id"]), local_user["name"], local_user["email"], None, None
                return False, None, None, None, None, "Authentication service is temporarily unavailable. Please check your connection."

            return False, None, None, None, None, "Invalid email or password."

    def get_user_profile(self, user_id: str, token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Retrieves user profile details strictly by user ID."""
        client = self.get_client()
        if not client:
            import database
            u = database.get_user_by_id(int(user_id) if str(user_id).isdigit() else 1)
            return dict(u) if u else None

        try:
            table = self.get_table("profiles", token=token)
            if table:
                res = table.select("*").eq("id", str(user_id)).single().execute()
                if res and res.data:
                    return res.data
        except Exception as e:
            logger.debug(f"Supabase get_user_profile with token note: {e}")

        # Fallback to admin client if token was missing or expired
        admin_client = self.get_admin_client()
        if admin_client:
            try:
                res = admin_client.table("profiles").select("*").eq("id", str(user_id)).single().execute()
                if res and res.data:
                    return res.data
            except Exception as e:
                logger.error(f"Supabase admin get_user_profile error: {e}")

        return None

    # ==========================================================================
    # 2. TRIPS MANAGEMENT (PERSISTENT REPOSITORY)
    # ==========================================================================

    def create_trip(
        self,
        user_id: str,
        trip_data: Dict[str, Any],
        packing_list: Dict[str, Any],
        token: Optional[str] = None
    ) -> Tuple[bool, Optional[str], Optional[str]]:
        """
        Persists a newly created trip and its generated packing list into Supabase.
        Returns: (success, trip_id, error_message)
        """
        client = self.get_client()
        if not client:
            # Fallback to local development storage
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
                weight_limit=trip_data.get("weight_limit", 7.0),
                activities=trip_data.get("activities", []),
                makeup=trip_data.get("makeup", []),
                toiletries=trip_data.get("toiletries", []),
                shifting_items=trip_data.get("shifting_items", []),
                personalization=trip_data.get("personalization", []),
                packing_list=packing_list or {},
                weather_data=trip_data.get("weather_data") or (packing_list or {}).get("weather") or {}
            )
            return True, str(trip_id), None

        try:
            weather_data = trip_data.get("weather_data") or (packing_list or {}).get("weather") or {}
            travel_modes = trip_data.get("travel_modes")
            if not travel_modes and trip_data.get("travel_mode"):
                travel_modes = [m.strip() for m in str(trip_data["travel_mode"]).split("+") if m.strip()]

            payload = {
                "user_id": str(user_id),
                "destination": str(trip_data.get("destination", "")).strip(),
                "start_date": str(trip_data.get("start_date", "")),
                "end_date": str(trip_data.get("end_date", "")),
                "travel_mode": str(trip_data.get("travel_mode", "")),
                "travel_modes": travel_modes or [],
                "trip_type": trip_data.get("trip_type") or None,
                "profile": trip_data.get("profile") or None,
                "adults": int(trip_data.get("adults", 1) or 1),
                "children": int(trip_data.get("children", 0) or 0),
                "child_age": trip_data.get("child_age") or None,
                "bag_type": str(trip_data.get("bag_type", "Backpack")),
                "weight_limit": float(trip_data.get("weight_limit", 7.0) or 7.0),
                "activities": trip_data.get("activities") or [],
                "makeup": trip_data.get("makeup") or [],
                "toiletries": trip_data.get("toiletries") or [],
                "shifting_items": trip_data.get("shifting_items") or [],
                "personalization": trip_data.get("personalization") or [],
                "packing_list": packing_list or {},
                "weather_data": weather_data
            }

            table = self.get_table("trips", token=token)
            if not table:
                return False, None, "Database service is temporarily unavailable."

            try:
                res = table.insert(payload).execute()
            except Exception as insert_err:
                err_lower = str(insert_err).lower()
                modified = False
                if "travel_modes" in err_lower and "travel_modes" in payload:
                    logger.warning("Supabase trips table missing travel_modes column; inserting without column.")
                    del payload["travel_modes"]
                    modified = True
                if "weather_data" in err_lower and "weather_data" in payload:
                    logger.warning("Supabase trips table missing weather_data column; inserting without column.")
                    del payload["weather_data"]
                    modified = True
                if modified:
                    res = table.insert(payload).execute()
                else:
                    raise insert_err

            if res and res.data and len(res.data) > 0:
                created_id = str(res.data[0].get("id"))
                return True, created_id, None

            return False, None, "Could not save your trip. Please try again."

        except Exception as e:
            logger.error(f"Supabase create_trip error: {e}")
            traceback.print_exc()
            return False, None, "We could not save your trip right now. Please try again."

    def update_trip_packing_list(
        self,
        trip_id: str,
        user_id: str,
        packing_list: Dict[str, Any],
        token: Optional[str] = None
    ) -> bool:
        """
        Updates the packing_list payload for an existing trip strictly owned by user_id.
        Enforces user isolation and security.
        """
        client = self.get_client()
        if not client:
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            tid = int(trip_id) if str(trip_id).isdigit() else 1
            return database.update_trip_packing_list(tid, uid, packing_list)

        try:
            table = self.get_table("trips", token=token)
            if not table:
                return False

            res = table.update({"packing_list": packing_list})\
                .eq("id", str(trip_id))\
                .eq("user_id", str(user_id))\
                .execute()

            if not (res and res.data and len(res.data) > 0):
                admin = self.get_admin_client()
                if admin:
                    res = admin.table("trips").update({"packing_list": packing_list})\
                        .eq("id", str(trip_id))\
                        .eq("user_id", str(user_id))\
                        .execute()

            return bool(res and res.data and len(res.data) > 0)
        except Exception as e:
            logger.error(f"Supabase update_trip_packing_list error: {e}")
            try:
                import database
                if str(user_id).isdigit() and str(trip_id).isdigit():
                    return database.update_trip_packing_list(int(trip_id), int(user_id), packing_list)
            except Exception:
                pass
            return False

    def get_user_trips(self, user_id: str, token: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Retrieves all trips belonging strictly to the specified user from Supabase.
        Enforces user isolation.
        """
        client = self.get_client()
        if not client:
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            return database.get_user_trips(uid)

        try:
            table = self.get_table("trips", token=token)
            if not table:
                return []

            res = table.select("*")\
                .eq("user_id", str(user_id))\
                .order("created_at", desc=True)\
                .execute()

            trips = res.data or []
            for t in trips:
                if not t.get("travel_modes") and t.get("travel_mode"):
                    t["travel_modes"] = [m.strip() for m in str(t["travel_mode"]).split("+") if m.strip()]
            return trips
        except Exception as e:
            logger.error(f"Supabase get_user_trips error: {e}")
            return []

    def get_trip_by_id(self, trip_id: str, user_id: str, token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Retrieves a single trip record by ID, verifying strict ownership by user_id.
        """
        client = self.get_client()
        if not client:
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            tid = int(trip_id) if str(trip_id).isdigit() else 1
            return database.get_trip_by_id(tid, uid)

        try:
            table = self.get_table("trips", token=token)
            if not table:
                return None

            res = table.select("*")\
                .eq("id", str(trip_id))\
                .eq("user_id", str(user_id))\
                .single()\
                .execute()

            trip = res.data if res else None
            if trip:
                if not trip.get("travel_modes") and trip.get("travel_mode"):
                    trip["travel_modes"] = [m.strip() for m in str(trip["travel_mode"]).split("+") if m.strip()]
            return trip
        except Exception as e:
            logger.error(f"Supabase get_trip_by_id error: {e}")
            return None

    def delete_trip(self, trip_id: str, user_id: str, token: Optional[str] = None) -> bool:
        """
        Deletes a trip if and only if it belongs to user_id.
        Prevents cross-user tampering.
        """
        client = self.get_client()
        if not client:
            import database
            uid = int(user_id) if str(user_id).isdigit() else 1
            tid = int(trip_id) if str(trip_id).isdigit() else 1
            return database.delete_trip(tid, uid)

        try:
            table = self.get_table("trips", token=token)
            if not table:
                return False

            table.delete()\
                .eq("id", str(trip_id))\
                .eq("user_id", str(user_id))\
                .execute()
            return True
        except Exception as e:
            logger.error(f"Supabase delete_trip error: {e}")
            return False


# Singleton instance exported across application
supabase_db = SupabaseService()

