# BagBuddy

BagBuddy is a React, TypeScript, and Vite travel-packing app. Supabase Auth and
Postgres are the only supported persistence layer; the local development server
is the TypeScript Express server in `server.ts`.

## Local setup

1. Create a Supabase project and apply the migrations in `supabase/migrations/` in order (`202611010001_initial_bagbuddy.sql`, then `202611010002_add_trip_location_coordinates.sql`, then `202611010003_add_transport_legs.sql`) through the SQL Editor or Supabase CLI. The second migration adds nullable `latitude`, `longitude`, and `timezone` columns to `trips`; existing trips are untouched and keep working with their text-only destination. The third adds the `transport_legs` journey column described below, makes `weight_limit` nullable, and backfills existing trips with a single leg from their stored `travel_mode`.
2. In Supabase Auth, enable Email/Password. Configure Site URL and redirect URLs for your local and Vercel URLs if email confirmation is enabled.
3. Copy `.env.example` to `.env` and supply the project URL, publishable key, and optional Gemini key. Do not commit `.env`.
4. Run `npm install`, then `npm run dev`.

The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
They are public client configuration, not secrets. All app-data access is enforced
by the migration's Row Level Security policies. `GEMINI_API_KEY` remains server-only.
BagBuddy does not use or require a Supabase service-role key.

## Transport legs and baggage

A trip's journey is an ordered list of transport legs (origin → destination
by Plane, Train, Bus, Car, Hostel move, or Other), stored in the
`transport_legs` jsonb column. The trip form lets users add, edit, remove,
and reorder legs, validates that each leg is complete and that consecutive
legs connect, and packing suggestions include the essentials for every kind
of transport used. The old `travel_mode` column is still written as a legacy
summary (single-leg name, or `Multi`), and trips saved before legs existed
are backfilled by migration `202611010003` and synthesised client-side if
needed, so they load unchanged.

Airline baggage limits apply **only to plane legs**. Each flight leg can
carry the allowance that airline gives (entered by the user — never
guessed). The enforced packing limit is the smallest allowance across the
trip's flight legs, stored in `trips.weight_limit`. Trips without flights,
or whose flight allowance hasn't been entered, have `weight_limit = null`:
no limit is shown or enforced anywhere in the app, including the chat
assistant, which receives the legs and the baggage limit in its trip context.

## Weather

Trip destinations are picked from real Open-Meteo Geocoding suggestions in the
trip form, and the selected place's display name, latitude, longitude, and
timezone are stored on the trip. The dashboard weather card and the chat
assistant both use BagBuddy's `/api/weather` route (implemented in `server.ts`
for local development and as the self-contained `api/weather.ts` on Vercel),
which calls the Open-Meteo Forecast API for the trip's exact coordinates and
dates. Open-Meteo needs no API key, and no weather-related environment
variables exist.

Open-Meteo forecasts roughly 16 days ahead. Trips inside that horizon show the
real daily forecast; trips partly beyond it show the forecastable part plus a
note; trips entirely beyond it show an honest "not available yet" message
instead of invented weather. Trips saved before place selection have no
coordinates: their text destination is matched to a place approximately, and
the dashboard labels the match as approximate.

The chat assistant receives the same weather payload in its trip context and
is instructed to quote it verbatim and never invent weather when no forecast
is available.

## Vercel

Vercel builds the SPA with `npm run build` and invokes the Express app through
`api/chat.ts` and `api/weather.ts`; the existing `server.ts` does not start a
long-running listener when `VERCEL` is set. Add these environment variables in
Vercel Project Settings for the appropriate environments:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (only if AI responses are desired)

Set the Supabase Auth Site URL to the production Vercel URL and add preview/local
URLs as Redirect URLs. Deploying or configuring a remote Supabase/Vercel project
is a manual step; this repository does not contain credentials.

## Verification

`npm run build` runs TypeScript checking and builds the production Vite bundle.
For security verification, use two test accounts and confirm that account B cannot
read or mutate account A's trips or packing items through the Supabase dashboard
or direct API requests. The RLS policies enforce ownership through `trips.user_id`.
