import type { Trip } from '../types';

/**
 * Weather + place-selection helpers.
 *
 * Place search talks directly to the Open-Meteo Geocoding API from the
 * browser: it is free, needs no API key, and allows CORS. Forecasts are
 * fetched through BagBuddy's own `/api/weather` route (implemented in both
 * `server.ts` for local dev and `api/weather.ts` for Vercel), which calls the
 * Open-Meteo Forecast API for the trip's coordinates and dates.
 */

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** A real place returned by Open-Meteo Geocoding. */
export interface PlaceResult {
  id: number;
  name: string;
  /** Region / state, when Open-Meteo provides one. */
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  /** IANA timezone, e.g. "Asia/Kolkata". */
  timezone?: string;
  /** "Name, Region, Country" — what gets stored as the trip destination. */
  displayName: string;
}

interface GeocodingApiResult {
  id: number;
  name: string;
  admin1?: string;
  country?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

export function placeDisplayName(place: { name: string; admin1?: string; country?: string }): string {
  const parts: string[] = [];
  for (const part of [place.name, place.admin1, place.country]) {
    if (part && !parts.includes(part)) parts.push(part);
  }
  return parts.join(', ');
}

/**
 * Search real places matching `query`. Returns an empty list for very short
 * queries instead of calling the API. Honours the AbortSignal so callers can
 * cancel superseded requests while typing.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceResult[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(trimmed)}&count=6&language=en&format=json`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Place search failed (${response.status}).`);
  }
  const data = (await response.json()) as { results?: GeocodingApiResult[] };
  return (data.results ?? []).map(result => ({
    id: result.id,
    name: result.name,
    admin1: result.admin1,
    country: result.country,
    latitude: result.latitude,
    longitude: result.longitude,
    timezone: result.timezone,
    displayName: placeDisplayName(result),
  }));
}

/** One day of forecast for the trip, as returned by `/api/weather`. */
export interface WeatherDay {
  date: string;
  weather_code: number;
  condition: string;
  temperature_max: number | null;
  temperature_min: number | null;
  /** Null when Open-Meteo has no precipitation probability for that day. */
  precipitation_probability_max: number | null;
}

export type TripWeatherStatus =
  /** Every trip date has a forecast. */
  | 'forecast'
  /** Only part of the trip has a forecast; `notes` explains which part. */
  | 'partial'
  /** The whole trip starts after the last forecastable day (`horizon_end`). */
  | 'too_far_future'
  /** The whole trip is in the past, so there is nothing to forecast. */
  | 'past'
  /** A legacy text-only location could not be matched to a real place. */
  | 'location_not_found';

export interface TripWeather {
  status: TripWeatherStatus;
  location: {
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
    /**
     * True when the coordinates were matched from a legacy trip's free-text
     * destination rather than picked by the user from place suggestions.
     */
    approximate: boolean;
  } | null;
  requested_start_date: string;
  requested_end_date: string;
  /** Last date Open-Meteo can currently forecast for this location. */
  horizon_end: string;
  timezone: string | null;
  days: WeatherDay[];
  notes: string[];
  source: 'Open-Meteo';
}

interface WeatherApiError {
  error?: string;
}

/**
 * Fetch date-specific weather for a trip from BagBuddy's weather route.
 * Trips with stored coordinates use them directly; legacy trips fall back to
 * their text destination, which the server resolves approximately.
 * Throws on transport or upstream failures so callers can show an error state.
 */
export async function fetchTripWeather(trip: Trip, signal?: AbortSignal): Promise<TripWeather> {
  const params = new URLSearchParams({
    start_date: trip.start_date,
    end_date: trip.end_date,
  });
  if (typeof trip.latitude === 'number' && typeof trip.longitude === 'number') {
    params.set('latitude', String(trip.latitude));
    params.set('longitude', String(trip.longitude));
    if (trip.timezone) params.set('timezone', trip.timezone);
    params.set('location', trip.destination);
  } else {
    params.set('destination', trip.destination);
  }

  const response = await fetch(`/api/weather?${params.toString()}`, { signal });
  const data = (await response.json().catch(() => null)) as TripWeather | WeatherApiError | null;
  if (!response.ok || !data || typeof data !== 'object' || !('status' in data)) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error
      : `Weather request failed (${response.status}).`;
    throw new Error(message);
  }
  return data as TripWeather;
}

/**
 * Cache of in-flight/resolved weather lookups, keyed by everything that
 * determines the answer. The dashboard card and the chat assistant share it
 * so a trip's weather is only requested once per page session.
 */
const weatherCache = new Map<string, Promise<TripWeather>>();

export function getTripWeather(trip: Trip): Promise<TripWeather> {
  const key = [
    trip.id ?? trip.destination,
    trip.latitude ?? '',
    trip.longitude ?? '',
    trip.start_date,
    trip.end_date,
  ].join('|');
  const cached = weatherCache.get(key);
  if (cached) return cached;
  const request = fetchTripWeather(trip);
  weatherCache.set(key, request);
  // Do not cache failures: a later retry (or the chat) should be able to succeed.
  request.catch(() => {
    if (weatherCache.get(key) === request) weatherCache.delete(key);
  });
  return request;
}

/** Format an ISO date (yyyy-mm-dd) for display, without timezone shifting it. */
export function formatWeatherDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}
