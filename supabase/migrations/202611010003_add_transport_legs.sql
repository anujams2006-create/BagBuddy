-- BagBuddy: a trip's journey becomes an ordered list of transport legs
-- (for example Pune -> Mumbai by Car, Mumbai -> Delhi by Plane,
-- Delhi -> Jaipur by Bus) instead of one trip-wide travel_mode.
--
-- Storage: `transport_legs` is a jsonb array of
--   { id, origin, destination, transport_type,
--     departure_time, arrival_time, baggage_allowance_kg }
-- mirroring the shape the app already uses for activities/personalization.
--
-- Compatibility:
-- * `travel_mode` is kept and still written by the app as a legacy summary:
--   the single leg's old name (Plane -> 'Flight'), or 'Multi'.
-- * Existing trips are backfilled with exactly one leg synthesised from
--   their stored travel_mode and destination (origin was never stored, so
--   it is left empty). Their packing items and other fields are untouched.
-- * Baggage: `weight_limit` historically held a trip-wide limit. From now on
--   it holds the effective airline allowance for plane legs only, and it is
--   nullable: null means "no plane legs" or "allowance not known yet", in
--   which case the app shows and enforces no limit. Existing values are
--   preserved; for a legacy flight trip the backfill copies the stored
--   limit onto its plane leg, where it keeps applying exactly as before.

alter table public.trips
  add column if not exists transport_legs jsonb not null default '[]'::jsonb;

alter table public.trips
  alter column weight_limit drop not null;

alter table public.trips
  drop constraint if exists trips_weight_limit_check;

alter table public.trips
  add constraint trips_weight_limit_check
    check (weight_limit is null or weight_limit > 0);

update public.trips
set transport_legs = jsonb_build_array(
  jsonb_build_object(
    'id', 'legacy_' || id::text,
    'origin', '',
    'destination', destination,
    'transport_type', case travel_mode when 'Flight' then 'Plane' else travel_mode end,
    'departure_time', '',
    'arrival_time', '',
    'baggage_allowance_kg', case when travel_mode = 'Flight' then weight_limit else null end
  )
)
where transport_legs = '[]'::jsonb
  and travel_mode is not null
  and travel_mode <> ''
  and travel_mode <> 'Multi';

comment on column public.trips.transport_legs is
  'Ordered journey legs: [{id, origin, destination, transport_type, departure_time, arrival_time, baggage_allowance_kg}]. transport_type is Plane, Train, Bus, Car, Hostel, or Other. baggage_allowance_kg is only used on Plane legs.';
comment on column public.trips.weight_limit is
  'Effective baggage limit in kg: the smallest airline allowance across the trip''s plane legs. Null when the trip has no plane legs or the allowance is unknown; the app then shows and enforces no limit.';
