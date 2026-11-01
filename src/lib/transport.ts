import type { Trip, TransportLeg, TransportType } from '../types';

/**
 * Transport-leg helpers shared by the trip form, dashboard, packing engine,
 * and chat. A trip's journey is an ordered list of legs; the old single
 * `travel_mode` value is only a legacy summary/fallback.
 *
 * Baggage rule: airline baggage limits apply ONLY to plane legs. The
 * enforced limit for a trip is the smallest allowance across its plane
 * legs (a bag has to satisfy every flight it takes). Trips without plane
 * legs — or whose plane allowance the user hasn't entered — have no limit
 * at all: nothing is shown and nothing is enforced.
 */

export const TRANSPORT_TYPES: { value: TransportType; label: string; icon: string }[] = [
  { value: 'Plane', label: 'Plane', icon: '✈' },
  { value: 'Train', label: 'Train', icon: '🚆' },
  { value: 'Bus', label: 'Bus', icon: '🚌' },
  { value: 'Car', label: 'Car', icon: '🚗' },
  { value: 'Hostel', label: 'Hostel move', icon: '🧳' },
  { value: 'Other', label: 'Other', icon: '🧭' },
];

/** Normalise any stored/legacy transport value ('Flight', 'flight', …) to a TransportType. */
export function normalizeTransportType(value: unknown): TransportType {
  if (typeof value !== 'string') return 'Other';
  switch (value.trim().toLowerCase()) {
    case 'plane':
    case 'flight':
      return 'Plane';
    case 'train':
      return 'Train';
    case 'bus':
      return 'Bus';
    case 'car':
      return 'Car';
    case 'hostel':
      return 'Hostel';
    default:
      return 'Other';
  }
}

export function transportLabel(type: TransportType): string {
  return TRANSPORT_TYPES.find(t => t.value === type)?.label ?? 'Other';
}

export function transportIcon(type: TransportType): string {
  return TRANSPORT_TYPES.find(t => t.value === type)?.icon ?? '🧭';
}

let legSequence = 0;

export function createTransportLeg(partial: Partial<TransportLeg> = {}): TransportLeg {
  return {
    id: partial.id ?? `leg_${Date.now()}_${legSequence++}`,
    origin: partial.origin ?? '',
    destination: partial.destination ?? '',
    transport_type: partial.transport_type ? normalizeTransportType(partial.transport_type) : 'Plane',
    departure_time: partial.departure_time ?? '',
    arrival_time: partial.arrival_time ?? '',
    baggage_allowance_kg:
      typeof partial.baggage_allowance_kg === 'number' && partial.baggage_allowance_kg > 0
        ? partial.baggage_allowance_kg
        : null,
  };
}

/** Validate and normalise legs coming from the database (jsonb) or older saved data. */
export function asTransportLegs(value: unknown): TransportLeg[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((raw, index) => ({
      id: typeof raw.id === 'string' && raw.id ? raw.id : `leg_${index}`,
      origin: typeof raw.origin === 'string' ? raw.origin : '',
      destination: typeof raw.destination === 'string' ? raw.destination : '',
      transport_type: normalizeTransportType(raw.transport_type),
      departure_time: typeof raw.departure_time === 'string' ? raw.departure_time : '',
      arrival_time: typeof raw.arrival_time === 'string' ? raw.arrival_time : '',
      baggage_allowance_kg:
        typeof raw.baggage_allowance_kg === 'number' && raw.baggage_allowance_kg > 0
          ? raw.baggage_allowance_kg
          : null,
    }));
}

/**
 * Build the single leg an old trip would have had, from its stored
 * `travel_mode`. The leg's destination is the trip destination; the origin
 * was never stored for legacy trips, so it stays empty.
 */
export function synthesizeLegsFromTravelMode(
  trip: Pick<Trip, 'travel_mode' | 'destination' | 'weight_limit'>,
): TransportLeg[] {
  if (!trip.travel_mode || trip.travel_mode === 'Multi') return [];
  const type = normalizeTransportType(trip.travel_mode);
  return [
    {
      id: 'legacy_leg',
      origin: '',
      destination: trip.destination ?? '',
      transport_type: type,
      departure_time: '',
      arrival_time: '',
      // A legacy flight trip's trip-wide limit was its airline allowance.
      baggage_allowance_kg: type === 'Plane' ? trip.weight_limit ?? null : null,
    },
  ];
}

/** The trip's legs: stored legs when present, otherwise the legacy synthesis. */
export function getTransportLegs(trip: Pick<Trip, 'transport_legs' | 'travel_mode' | 'destination' | 'weight_limit'>): TransportLeg[] {
  const legs = asTransportLegs(trip.transport_legs);
  return legs.length ? legs : synthesizeLegsFromTravelMode(trip);
}

export function planeLegs(legs: TransportLeg[]): TransportLeg[] {
  return legs.filter(leg => leg.transport_type === 'Plane');
}

export function tripHasPlaneLeg(trip: Pick<Trip, 'transport_legs' | 'travel_mode' | 'destination' | 'weight_limit'>): boolean {
  return planeLegs(getTransportLegs(trip)).length > 0;
}

/**
 * The baggage limit that actually applies to this trip, in kg — or null when
 * no limit applies (no plane legs) or none can be enforced (allowance not
 * entered yet). Never invents an allowance.
 */
export function effectiveBaggageLimit(
  trip: Pick<Trip, 'transport_legs' | 'travel_mode' | 'destination' | 'weight_limit'>,
): number | null {
  const planes = planeLegs(getTransportLegs(trip));
  if (!planes.length) return null;
  const allowances = planes
    .map(leg => leg.baggage_allowance_kg)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  if (allowances.length) return Math.min(...allowances);
  // Legacy fallback: pre-legs trips stored the allowance trip-wide.
  return typeof trip.weight_limit === 'number' && trip.weight_limit > 0 ? trip.weight_limit : null;
}

/** 'Plane' for one leg, 'Car → Plane → Bus' for several, legacy value otherwise. */
export function transportSummary(
  trip: Pick<Trip, 'transport_legs' | 'travel_mode' | 'destination' | 'weight_limit'>,
): string {
  const legs = getTransportLegs(trip);
  if (!legs.length) return trip.travel_mode ?? '';
  return legs.map(leg => transportLabel(leg.transport_type)).join(' → ');
}

/** 'Pune → Mumbai → Delhi → Jaipur' from the leg chain, when origins are known. */
export function routeSummary(
  trip: Pick<Trip, 'transport_legs' | 'travel_mode' | 'destination' | 'weight_limit'>,
): string {
  const legs = getTransportLegs(trip);
  if (!legs.length) return trip.destination ?? '';
  const points: string[] = [];
  for (const leg of legs) {
    if (leg.origin.trim() && points[points.length - 1] !== leg.origin.trim()) points.push(leg.origin.trim());
    if (leg.destination.trim() && points[points.length - 1] !== leg.destination.trim()) points.push(leg.destination.trim());
  }
  return points.length ? points.join(' → ') : trip.destination ?? '';
}

/** The value to keep storing in the legacy `travel_mode` column for a set of legs. */
export function legacyTravelModeValue(legs: TransportLeg[]): string {
  if (!legs.length) return '';
  if (legs.length > 1) return 'Multi';
  return legs[0].transport_type === 'Plane' ? 'Flight' : legs[0].transport_type;
}

/**
 * Form validation for the legs editor. Incomplete legs are errors, and so is
 * a broken chain (a leg starting somewhere the previous leg didn't end).
 */
export function validateTransportLegs(legs: TransportLeg[]): string[] {
  const errors: string[] = [];
  if (!legs.length) {
    errors.push('Add at least one leg to your journey.');
    return errors;
  }
  legs.forEach((leg, index) => {
    if (!leg.origin.trim()) errors.push(`Leg ${index + 1}: add where this leg starts.`);
    if (!leg.destination.trim()) errors.push(`Leg ${index + 1}: add where this leg ends.`);
    if (
      leg.transport_type === 'Plane' &&
      leg.baggage_allowance_kg != null &&
      !(leg.baggage_allowance_kg > 0)
    ) {
      errors.push(`Leg ${index + 1}: the baggage allowance must be more than 0 kg, or left blank if you don't know it yet.`);
    }
  });
  for (let i = 0; i < legs.length - 1; i++) {
    const endsAt = legs[i].destination.trim();
    const nextStartsAt = legs[i + 1].origin.trim();
    if (endsAt && nextStartsAt && endsAt.toLowerCase() !== nextStartsAt.toLowerCase()) {
      errors.push(
        `Leg ${i + 2} starts in "${nextStartsAt}" but Leg ${i + 1} ends in "${endsAt}". Fix one of them — or if there's a stop in between, add it as its own leg.`,
      );
    }
  }
  return errors;
}
