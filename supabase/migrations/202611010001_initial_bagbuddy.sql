-- BagBuddy's application data belongs to the authenticated Supabase user.
-- Run with `supabase db push` or apply through the Supabase SQL editor.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  destination text not null check (char_length(trim(destination)) > 0),
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  travel_mode text not null,
  trip_type text not null,
  profile text not null,
  adults integer not null default 1 check (adults > 0),
  children integer not null default 0 check (children >= 0),
  child_age text,
  bag_type text not null,
  weight_limit numeric(6, 2) not null check (weight_limit > 0),
  activities jsonb not null default '[]'::jsonb,
  personalization jsonb not null default '[]'::jsonb,
  toiletries jsonb not null default '[]'::jsonb,
  shifting_items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Packing item IDs are generated in the packing engine before they are saved.
create table public.packing_items (
  id text primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null,
  name text not null,
  quantity integer not null default 1 check (quantity > 0),
  weight numeric(8, 2) not null default 0 check (weight >= 0),
  packed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trips_user_created_at_idx on public.trips (user_id, created_at desc);
create index packing_items_trip_id_idx on public.packing_items (trip_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger trips_set_updated_at before update on public.trips
for each row execute function public.set_updated_at();
create trigger packing_items_set_updated_at before update on public.packing_items
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.packing_items enable row level security;

grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.trips to authenticated;
grant select, insert, update, delete on public.packing_items to authenticated;

create policy "profiles are private" on public.profiles
for all to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy "trips are private" on public.trips
for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "packing items belong to an owned trip" on public.packing_items
for all to authenticated
using (exists (
  select 1 from public.trips where trips.id = packing_items.trip_id and trips.user_id = auth.uid()
))
with check (exists (
  select 1 from public.trips where trips.id = packing_items.trip_id and trips.user_id = auth.uid()
));
