import type { IncomingMessage, ServerResponse } from 'node:http';

// Weather: real date-specific forecasts from Open-Meteo (no API key needed).
//
// This logic is intentionally duplicated in `server.ts` (the local Express
// server): Vercel functions in this project are self-contained, so the two
// copies must be kept in step.
//
// Behaviour:
// - With latitude/longitude (a place the user selected), fetch the daily
//   forecast for exactly the trip dates that fall inside Open-Meteo's
//   forecast horizon (today .. today + 15 days, in the place's timezone).
// - Trip dates beyond the horizon are reported honestly via the payload
//   `status` ("too_far_future" / "partial") — never filled with invented or
//   current weather.
// - Without coordinates (a legacy trip saved with free-text destination),
//   resolve the best geocoding match and flag the result `approximate`.

type Request = IncomingMessage & { query?: Record<string, string | string[] | undefined> };

const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_HORIZON_DAYS = 15;

function weatherConditionForCode(code: number): string {
  if (code === 0) return 'Clear sky';
  if (code === 1) return 'Mainly clear';
  if (code === 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code === 51 || code === 53 || code === 55) return 'Drizzle';
  if (code === 56 || code === 57) return 'Freezing drizzle';
  if (code === 61) return 'Light rain';
  if (code === 63) return 'Rain';
  if (code === 65) return 'Heavy rain';
  if (code === 66 || code === 67) return 'Freezing rain';
  if (code === 71) return 'Light snow';
  if (code === 73) return 'Snow';
  if (code === 75) return 'Heavy snow';
  if (code === 77) return 'Snow grains';
  if (code === 80) return 'Light rain showers';
  if (code === 81) return 'Rain showers';
  if (code === 82) return 'Violent rain showers';
  if (code === 85 || code === 86) return 'Snow showers';
  if (code === 95) return 'Thunderstorm';
  if (code === 96 || code === 99) return 'Thunderstorm with hail';
  return 'Mixed conditions';
}

function isIsoDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's date (yyyy-mm-dd) in the given IANA timezone, falling back to UTC. */
function todayIsoInTimezone(timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function parseCoordinate(value: string | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

interface TripWeatherOutcome {
  httpStatus: number;
  payload: Record<string, unknown>;
}

async function getTripWeather(params: {
  latitude?: string | null;
  longitude?: string | null;
  timezone?: string | null;
  locationName?: string | null;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Promise<TripWeatherOutcome> {
  const startDate = params.startDate ?? '';
  const endDate = params.endDate ?? '';
  if (!isIsoDateString(startDate) || !isIsoDateString(endDate)) {
    return { httpStatus: 400, payload: { error: 'start_date and end_date are required in YYYY-MM-DD format.' } };
  }
  if (endDate < startDate) {
    return { httpStatus: 400, payload: { error: 'end_date must be on or after start_date.' } };
  }

  let latitude = parseCoordinate(params.latitude, -90, 90);
  let longitude = parseCoordinate(params.longitude, -180, 180);
  if ((latitude === null) !== (longitude === null)) {
    return { httpStatus: 400, payload: { error: 'latitude and longitude must be provided together and in range.' } };
  }
  if (params.latitude && latitude === null) {
    return { httpStatus: 400, payload: { error: 'latitude is out of range.' } };
  }
  if (params.longitude && longitude === null) {
    return { httpStatus: 400, payload: { error: 'longitude is out of range.' } };
  }

  let timezone = params.timezone?.trim() || null;
  let locationName = params.locationName?.trim() || '';
  let approximate = false;

  if (latitude === null || longitude === null) {
    // Legacy trip: only a free-text destination was stored. Resolve the best
    // geocoding match so the trip still gets weather, clearly labelled.
    const destination = (params.destination ?? '').trim();
    if (!destination) {
      return { httpStatus: 400, payload: { error: 'Provide latitude and longitude, or a destination to resolve.' } };
    }
    let place: any = null;
    try {
      const geoResponse = await fetch(
        `${OPEN_METEO_GEOCODING_URL}?name=${encodeURIComponent(destination)}&count=10&language=en&format=json`
      );
      if (!geoResponse.ok) throw new Error(`Geocoding failed (${geoResponse.status})`);
      const geoData: any = await geoResponse.json();
      const results: any[] = Array.isArray(geoData?.results) ? geoData.results : [];
      // Geocoding search is fuzzy and can rank an unrelated place first, so
      // prefer an exact (then prefix) name match, breaking ties by population.
      const normaliseName = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
      const target = normaliseName(destination);
      const populationOf = (candidate: any) => (typeof candidate?.population === 'number' ? candidate.population : 0);
      const exactMatches = results.filter(candidate => normaliseName(String(candidate?.name ?? '')) === target);
      const prefixMatches = results.filter(candidate => normaliseName(String(candidate?.name ?? '')).startsWith(target));
      const pool = exactMatches.length ? exactMatches : prefixMatches.length ? prefixMatches : results;
      place = [...pool].sort((a, b) => populationOf(b) - populationOf(a))[0] ?? null;
    } catch {
      return { httpStatus: 502, payload: { error: 'The weather service is unavailable right now. Please try again shortly.' } };
    }
    if (!place) {
      return {
        httpStatus: 200,
        payload: {
          status: 'location_not_found',
          location: null,
          requested_start_date: startDate,
          requested_end_date: endDate,
          horizon_end: todayIsoInTimezone(null),
          timezone: null,
          days: [],
          notes: [`We could not match "${destination}" to a real place, so no weather can be shown for this trip.`],
          source: 'Open-Meteo',
        },
      };
    }
    latitude = Number(place.latitude);
    longitude = Number(place.longitude);
    timezone = typeof place.timezone === 'string' ? place.timezone : null;
    locationName = [place.name, place.admin1, place.country]
      .filter((part: unknown, index: number, all: unknown[]) => typeof part === 'string' && part && all.indexOf(part) === index)
      .join(', ');
    approximate = true;
  }

  const today = todayIsoInTimezone(timezone);
  let horizonEnd = addDaysToIsoDate(today, FORECAST_HORIZON_DAYS);
  const basePayload = {
    location: {
      name: locationName || (params.destination ?? '').trim(),
      latitude,
      longitude,
      timezone: timezone ?? 'auto',
      approximate,
    },
    requested_start_date: startDate,
    requested_end_date: endDate,
    timezone,
    source: 'Open-Meteo',
  };

  if (endDate < today) {
    return {
      httpStatus: 200,
      payload: {
        ...basePayload,
        status: 'past',
        horizon_end: horizonEnd,
        days: [],
        notes: ['This trip has already taken place, so there is no forecast to show for it.'],
      },
    };
  }
  if (startDate > horizonEnd) {
    return {
      httpStatus: 200,
      payload: {
        ...basePayload,
        status: 'too_far_future',
        horizon_end: horizonEnd,
        days: [],
        notes: [
          `A reliable daily forecast is not available yet for ${startDate}. Open-Meteo currently forecasts up to ${horizonEnd} for this location; check again closer to departure.`,
        ],
      },
    };
  }

  const fetchStart = startDate < today ? today : startDate;
  let fetchEnd = endDate < horizonEnd ? endDate : horizonEnd;

  const buildForecastUrl = (from: string, to: string) =>
    `${OPEN_METEO_FORECAST_URL}?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=${encodeURIComponent(timezone ?? 'auto')}&start_date=${from}&end_date=${to}`;

  try {
    let forecastResponse = await fetch(buildForecastUrl(fetchStart, fetchEnd));
    if (forecastResponse.status === 400) {
      // Open-Meteo reports its exact allowed range; honour it and retry once
      // with the range clamped to the real horizon.
      const errorBody: any = await forecastResponse.json().catch(() => null);
      const allowedTo = typeof errorBody?.reason === 'string'
        ? errorBody.reason.match(/to (\d{4}-\d{2}-\d{2})/)?.[1]
        : undefined;
      if (allowedTo) {
        horizonEnd = allowedTo;
        if (fetchStart > horizonEnd) {
          return {
            httpStatus: 200,
            payload: {
              ...basePayload,
              status: 'too_far_future',
              horizon_end: horizonEnd,
              days: [],
              notes: [
                `A reliable daily forecast is not available yet for ${startDate}. Open-Meteo currently forecasts up to ${horizonEnd} for this location; check again closer to departure.`,
              ],
            },
          };
        }
        fetchEnd = fetchEnd < horizonEnd ? fetchEnd : horizonEnd;
        forecastResponse = await fetch(buildForecastUrl(fetchStart, fetchEnd));
      }
    }
    if (!forecastResponse.ok) throw new Error(`Forecast failed (${forecastResponse.status})`);
    const forecast: any = await forecastResponse.json();
    const daily = forecast?.daily;
    if (!daily || !Array.isArray(daily.time)) throw new Error('Forecast response was missing daily data.');

    const resolvedTimezone = typeof forecast.timezone === 'string' ? forecast.timezone : timezone;
    const days = daily.time.map((date: string, index: number) => ({
      date,
      weather_code: Number(daily.weather_code?.[index] ?? -1),
      condition: weatherConditionForCode(Number(daily.weather_code?.[index] ?? -1)),
      temperature_max: daily.temperature_2m_max?.[index] ?? null,
      temperature_min: daily.temperature_2m_min?.[index] ?? null,
      precipitation_probability_max: daily.precipitation_probability_max?.[index] ?? null,
    }));

    const notes: string[] = [];
    if (approximate) {
      notes.push('This location was matched from the destination name saved for this older trip, so it may not be exact. New trips ask you to pick the place from suggestions.');
    }
    if (fetchStart > startDate) {
      notes.push('The first part of this trip has already passed, so the forecast starts today.');
    }
    if (fetchEnd < endDate) {
      notes.push(`A reliable forecast is not available yet for the rest of this trip after ${fetchEnd}; check again closer to those dates.`);
    }

    return {
      httpStatus: 200,
      payload: {
        ...basePayload,
        location: { ...basePayload.location, timezone: resolvedTimezone ?? basePayload.location.timezone },
        timezone: resolvedTimezone,
        status: fetchStart === startDate && fetchEnd === endDate ? 'forecast' : 'partial',
        horizon_end: horizonEnd,
        days,
        notes,
      },
    };
  } catch {
    return { httpStatus: 502, payload: { error: 'The weather service is unavailable right now. Please try again shortly.' } };
  }
}

export default async function handler(req: Request, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }
  const url = new URL(req.url ?? '/', 'https://bagbuddy.local');
  const queryValue = (name: string): string | null => {
    const fromQuery = req.query?.[name];
    if (typeof fromQuery === 'string') return fromQuery;
    return url.searchParams.get(name);
  };
  const result = await getTripWeather({
    latitude: queryValue('latitude'),
    longitude: queryValue('longitude'),
    timezone: queryValue('timezone'),
    locationName: queryValue('location'),
    destination: queryValue('destination'),
    startDate: queryValue('start_date'),
    endDate: queryValue('end_date'),
  });
  res.statusCode = result.httpStatus;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(result.payload));
}
