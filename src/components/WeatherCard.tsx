import React, { useEffect, useState } from 'react';
import type { Trip } from '../types';
import { fetchTripWeather, formatWeatherDate, type TripWeather } from '../lib/weather';

interface WeatherCardProps {
  trip: Trip;
}

type WeatherState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; weather: TripWeather };

/**
 * Dashboard weather card. Fetches date-specific Open-Meteo weather for the
 * trip's stored coordinates (or, for legacy trips, its text destination)
 * from `/api/weather` and renders every outcome honestly: forecast days,
 * partial coverage, dates beyond the forecast horizon, past trips, an
 * unmatchable legacy location, and plain API failure — which never takes
 * the rest of the dashboard down with it.
 */
export const WeatherCard: React.FC<WeatherCardProps> = ({ trip }) => {
  const [state, setState] = useState<WeatherState>({ kind: 'loading' });
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    fetchTripWeather(trip, controller.signal)
      .then(weather => setState({ kind: 'ready', weather }))
      .catch(error => {
        if ((error as Error)?.name === 'AbortError') return;
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Weather could not be loaded.',
        });
      });
    return () => controller.abort();
    // Refetch when the trip or its location/dates change, or on manual retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id, trip.destination, trip.latitude, trip.longitude, trip.start_date, trip.end_date, retryCount]);

  return (
    <section className="weather-card" aria-label="Trip weather">
      <div className="trip-summary-header">
        <div>
          <p className="trip-label">TRIP WEATHER</p>
          <h2>{trip.destination}</h2>
          <p className="weather-dates">
            {formatWeatherDate(trip.start_date)} – {formatWeatherDate(trip.end_date)}
          </p>
        </div>
        <span className="trip-status">Open-Meteo</span>
      </div>

      {state.kind === 'loading' && (
        <p className="weather-state" role="status">Loading weather for your trip dates…</p>
      )}

      {state.kind === 'error' && (
        <div className="weather-state">
          <p>Weather is unavailable right now. Your packing list is unaffected.</p>
          <p className="weather-note">{state.message}</p>
          <button
            type="button"
            className="secondary-btn"
            style={{ minHeight: '38px', padding: '6px 14px', fontSize: '0.85rem' }}
            onClick={() => setRetryCount(count => count + 1)}
          >
            Try again
          </button>
        </div>
      )}

      {state.kind === 'ready' && (
        <>
          {state.weather.location?.approximate && (
            <p className="weather-note">
              Location matched from the destination name saved for this trip:{' '}
              <strong>{state.weather.location.name}</strong>. It may not be exact — new trips let you
              pick the precise place.
            </p>
          )}

          {state.weather.days.length > 0 && (
            <>
              <p className="weather-note">
                {state.weather.status === 'partial'
                  ? 'Forecast for the part of your trip that is currently forecastable:'
                  : 'Forecast for your trip dates:'}
              </p>
              <div className="weather-days">
                {state.weather.days.map(day => (
                  <div key={day.date} className="weather-day">
                    <span className="weather-day-date">{formatWeatherDate(day.date)}</span>
                    <strong className="weather-day-condition">{day.condition}</strong>
                    <span className="weather-day-temps">
                      {day.temperature_max != null && day.temperature_min != null
                        ? `${Math.round(day.temperature_min)}° – ${Math.round(day.temperature_max)}°C`
                        : 'Temperatures unavailable'}
                    </span>
                    <span className="weather-day-rain">
                      {day.precipitation_probability_max != null
                        ? `Rain chance ${Math.round(day.precipitation_probability_max)}%`
                        : 'Rain chance unavailable'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {state.weather.status === 'too_far_future' && (
            <p className="weather-state">
              A reliable daily forecast is not available yet for these dates. Open-Meteo currently
              forecasts up to {formatWeatherDate(state.weather.horizon_end)} for this location —
              check again closer to departure and this card will show the real forecast.
            </p>
          )}

          {state.weather.status === 'past' && (
            <p className="weather-state">This trip has already taken place, so there is no forecast to show.</p>
          )}

          {state.weather.status === 'location_not_found' && (
            <p className="weather-state">
              We could not match this trip's saved destination to a real place, so weather cannot be
              shown for it. Trips planned now ask you to pick the place from suggestions.
            </p>
          )}

          {state.weather.status === 'partial' &&
            state.weather.notes
              .filter(note => !note.startsWith('This location was matched'))
              .map(note => (
                <p key={note} className="weather-note">{note}</p>
              ))}
        </>
      )}
    </section>
  );
};
