-- ==============================================================================
-- BAGBUDDY — SUPABASE PRODUCTION DATABASE SCHEMA & SECURITY POLICIES
-- ==============================================================================
-- Run this SQL in your Supabase project's SQL Editor to set up the production
-- database tables, indexes, triggers, and Row Level Security (RLS) policies.
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==============================================================================
-- 2. USER PROFILES TABLE
-- ==============================================================================
-- Mirrors auth.users and stores application-specific profile metadata.
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.profiles IS 'User profiles linked to Supabase Auth accounts.';

-- ==============================================================================
-- 3. TRIPS TABLE
-- ==============================================================================
-- Stores user trips, travel mode, baggage allowance, and generated packing lists.
CREATE TABLE IF NOT EXISTS public.trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    destination TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    travel_mode TEXT NOT NULL,
    trip_type TEXT,
    profile TEXT,
    adults INTEGER DEFAULT 1 NOT NULL CHECK (adults >= 0),
    children INTEGER DEFAULT 0 NOT NULL CHECK (children >= 0),
    child_age TEXT,
    bag_type TEXT DEFAULT 'Backpack' NOT NULL,
    weight_limit NUMERIC(5, 2) DEFAULT 7.0 NOT NULL CHECK (weight_limit > 0),
    activities JSONB DEFAULT '[]'::jsonb NOT NULL,
    makeup JSONB DEFAULT '[]'::jsonb NOT NULL,
    toiletries JSONB DEFAULT '[]'::jsonb NOT NULL,
    shifting_items JSONB DEFAULT '[]'::jsonb NOT NULL,
    personalization JSONB DEFAULT '[]'::jsonb NOT NULL,
    packing_list JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

COMMENT ON TABLE public.trips IS 'Personalized travel plans and packing lists per user.';

-- ==============================================================================
-- 4. PERFORMANCE INDEXES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_trips_user_id ON public.trips(user_id);
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON public.trips(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- ==============================================================================
-- 5. AUTOMATIC PROFILE CREATION TRIGGER
-- ==============================================================================
-- When a user signs up through Supabase Auth, automatically create their profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        NEW.email
    )
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email,
        updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger firing after user creation in auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==============================================================================
-- 6. ROW LEVEL SECURITY (RLS)
-- ==============================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- PROFILES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Service role has full access to profiles" ON public.profiles;
CREATE POLICY "Service role has full access to profiles"
    ON public.profiles FOR ALL
    USING (auth.role() = 'service_role');

-- ------------------------------------------------------------------------------
-- TRIPS POLICIES
-- ------------------------------------------------------------------------------
-- Users can only read their own trips
DROP POLICY IF EXISTS "Users can view own trips" ON public.trips;
CREATE POLICY "Users can view own trips"
    ON public.trips FOR SELECT
    USING (auth.uid() = user_id);

-- Users can only create trips for themselves
DROP POLICY IF EXISTS "Users can insert own trips" ON public.trips;
CREATE POLICY "Users can insert own trips"
    ON public.trips FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Users can only update their own trips
DROP POLICY IF EXISTS "Users can update own trips" ON public.trips;
CREATE POLICY "Users can update own trips"
    ON public.trips FOR UPDATE
    USING (auth.uid() = user_id);

-- Users can only delete their own trips
DROP POLICY IF EXISTS "Users can delete own trips" ON public.trips;
CREATE POLICY "Users can delete own trips"
    ON public.trips FOR DELETE
    USING (auth.uid() = user_id);

-- Service role bypass for server administrative tasks
DROP POLICY IF EXISTS "Service role has full access to trips" ON public.trips;
CREATE POLICY "Service role has full access to trips"
    ON public.trips FOR ALL
    USING (auth.role() = 'service_role');
