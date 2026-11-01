# BagBuddy

BagBuddy is a React, TypeScript, and Vite travel-packing app. Supabase Auth and
Postgres are the only supported persistence layer; the local development server
is the TypeScript Express server in `server.ts`.

## Local setup

1. Create a Supabase project and apply `supabase/migrations/202611010001_initial_bagbuddy.sql` through the SQL Editor or Supabase CLI.
2. In Supabase Auth, enable Email/Password. Configure Site URL and redirect URLs for your local and Vercel URLs if email confirmation is enabled.
3. Copy `.env.example` to `.env` and supply the project URL, publishable key, and optional Gemini key. Do not commit `.env`.
4. Run `npm install`, then `npm run dev`.

The browser receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.
They are public client configuration, not secrets. All app-data access is enforced
by the migration's Row Level Security policies. `GEMINI_API_KEY` remains server-only.
BagBuddy does not use or require a Supabase service-role key.

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
