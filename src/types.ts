/** Transport types a trip leg can use. Legacy trips stored 'Flight', which is normalised to 'Plane'. */
export type TransportType = 'Plane' | 'Train' | 'Bus' | 'Car' | 'Hostel' | 'Other';

/**
 * One leg of a journey, e.g. Pune → Mumbai by Car.
 * `baggage_allowance_kg` is only meaningful for Plane legs: it is the
 * allowance that airline gives for that flight, entered by the user.
 * It stays null when the allowance is unknown — BagBuddy never invents one.
 */
export interface TransportLeg {
  id: string;
  origin: string;
  destination: string;
  transport_type: TransportType;
  /** Optional 'HH:MM' times, when the user knows them. */
  departure_time?: string;
  arrival_time?: string;
  baggage_allowance_kg?: number | null;
}

export interface Trip {
  id?: string;
  /** Human-readable display name of the selected place, e.g. "Panaji, Goa, India". */
  destination: string;
  /**
   * Coordinates of the place chosen from Open-Meteo Geocoding.
   * Null/absent on legacy trips that were saved with a free-text destination only.
   */
  latitude?: number | null;
  longitude?: number | null;
  /** IANA timezone of the selected place, e.g. "Asia/Kolkata". Null on legacy trips. */
  timezone?: string | null;
  start_date: string;
  end_date: string;
  /**
   * Legacy single-mode summary kept for backward compatibility (existing
   * columns, badges, and old trips). New code should read `transport_legs`;
   * this holds the single leg's legacy name, or 'Multi' for multi-leg trips.
   */
  travel_mode: string;
  /** The journey as an ordered list of legs. Empty/absent on legacy trips. */
  transport_legs?: TransportLeg[];
  trip_type: string;
  profile: string;
  adults: number;
  children: number;
  child_age?: string;
  bag_type: string;
  /**
   * Effective baggage limit in kg: the smallest airline allowance across the
   * trip's plane legs. Null when the trip has no plane legs, or when the
   * allowance is unknown — in both cases no limit is shown or enforced.
   */
  weight_limit: number | null;
  activities: string[];
  personalization: string[];
  toiletries: string[];
  shifting_items: string[];
  created_at?: string;
}

export interface PackingItem {
  id: string;
  name: string;
  quantity: number;
  weight: number;
  category: string;
  packed: boolean;
}

export interface PackingListResult {
  categories: Record<string, PackingItem[]>;
  items: PackingItem[];
  duration: number;
  destination: string;
  profile: string;
  travel_mode: string;
  total_weight: number;
  /** Null when no baggage limit applies (no plane legs / allowance unknown). */
  weight_limit: number | null;
  /** Null whenever `weight_limit` is null. */
  remaining_weight: number | null;
  overloaded: boolean;
  items_to_remove: PackingItem[];
}

export interface User {
  id: string;
  name: string;
  email: string;
}
