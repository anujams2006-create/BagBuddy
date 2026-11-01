-- BagBuddy: store the verified place a user picked for a trip so weather can
-- be fetched for exact coordinates and trip dates from Open-Meteo.
--
-- `destination` keeps holding the human-readable display name of the selected
-- place (for example "Panaji, Goa, India"). The columns below are nullable so
-- trips created before place selection keep working unchanged: a null
-- latitude/longitude marks a legacy trip whose location is text-only, and the
-- app resolves it approximately (and labels it as such) instead of failing.
-- No existing rows are modified or deleted by this migration.

alter table public.trips
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists timezone text;

alter table public.trips
  drop constraint if exists trips_latitude_range,
  drop constraint if exists trips_longitude_range;

alter table public.trips
  add constraint trips_latitude_range
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  add constraint trips_longitude_range
    check (longitude is null or (longitude >= -180 and longitude <= 180));

comment on column public.trips.latitude is
  'Latitude of the place selected from Open-Meteo Geocoding. Null for legacy trips that only stored a text destination.';
comment on column public.trips.longitude is
  'Longitude of the place selected from Open-Meteo Geocoding. Null for legacy trips that only stored a text destination.';
comment on column public.trips.timezone is
  'IANA timezone of the selected place (for example Asia/Kolkata), as returned by Open-Meteo Geocoding. Null for legacy trips.';
