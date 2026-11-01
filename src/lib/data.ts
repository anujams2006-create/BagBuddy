import type { User, Trip, PackingItem, PackingListResult } from '../types';
import { supabase } from './supabase';

type TripRow = Omit<Trip, 'id' | 'created_at'> & {
  id: string;
  user_id: string;
  created_at: string;
};

type PackingItemRow = PackingItem & { trip_id: string };

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toTrip(row: TripRow): Trip {
  return {
    id: row.id,
    destination: row.destination,
    start_date: row.start_date,
    end_date: row.end_date,
    travel_mode: row.travel_mode,
    trip_type: row.trip_type,
    profile: row.profile,
    adults: row.adults,
    children: row.children,
    child_age: row.child_age ?? '',
    bag_type: row.bag_type,
    weight_limit: Number(row.weight_limit),
    activities: asStringArray(row.activities),
    personalization: asStringArray(row.personalization),
    toiletries: asStringArray(row.toiletries),
    shifting_items: asStringArray(row.shifting_items),
    created_at: row.created_at,
  };
}

function toPackingItem(row: PackingItemRow): PackingItem {
  return {
    id: row.id,
    name: row.name,
    quantity: Number(row.quantity),
    weight: Number(row.weight),
    category: row.category,
    packed: row.packed,
  };
}

export function packingListFromItems(trip: Trip, items: PackingItem[]): PackingListResult {
  const categories: Record<string, PackingItem[]> = {};
  for (const item of items) {
    (categories[item.category] ??= []).push(item);
  }
  const total_weight = Number(items.reduce((total, item) => total + item.weight, 0).toFixed(2));
  const remaining_weight = Number((trip.weight_limit - total_weight).toFixed(2));
  const start = new Date(`${trip.start_date}T00:00:00Z`);
  const end = new Date(`${trip.end_date}T00:00:00Z`);
  const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);

  return {
    categories,
    items,
    duration,
    destination: trip.destination,
    profile: trip.profile,
    travel_mode: trip.travel_mode,
    total_weight,
    weight_limit: trip.weight_limit,
    remaining_weight,
    overloaded: total_weight > trip.weight_limit,
    items_to_remove: [],
  };
}

export async function currentUser(): Promise<User | null> {
  const { data, error } = await supabase().auth.getUser();
  if (error || !data.user) return null;
  const { data: profile, error: profileError } = await supabase()
    .from('profiles')
    .select('name')
    .eq('id', data.user.id)
    .single();
  if (profileError) throw profileError;
  return { id: data.user.id, name: profile.name, email: data.user.email ?? '' };
}

export async function listTrips(): Promise<Trip[]> {
  const { data, error } = await supabase().from('trips').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data as TripRow[]).map(toTrip);
}

export async function loadPackingList(trip: Trip): Promise<PackingListResult> {
  if (!trip.id) throw new Error('Trip ID is required.');
  const { data, error } = await supabase().from('packing_items').select('*').eq('trip_id', trip.id).order('created_at');
  if (error) throw error;
  return packingListFromItems(trip, (data as PackingItemRow[]).map(toPackingItem));
}

export async function createTrip(trip: Trip, list: PackingListResult, userId: string): Promise<Trip> {
  const { id: _ignoredId, created_at: _ignoredCreatedAt, ...tripFields } = trip;
  const { data: tripRow, error: tripError } = await supabase()
    .from('trips')
    .insert({ ...tripFields, user_id: userId })
    .select('*')
    .single();
  if (tripError) throw tripError;

  const created = toTrip(tripRow as TripRow);
  const rows = list.items.map(item => ({ ...item, trip_id: created.id }));
  if (rows.length) {
    const { error: itemError } = await supabase().from('packing_items').insert(rows);
    if (itemError) {
      await supabase().from('trips').delete().eq('id', created.id);
      throw itemError;
    }
  }
  return created;
}

export async function deleteTrip(tripId: string): Promise<void> {
  const { error } = await supabase().from('trips').delete().eq('id', tripId);
  if (error) throw error;
}

// The UI edits a complete packing list. Synchronising by primary key keeps rows normalized
// while preserving the existing component interface.
export async function syncPackingItems(tripId: string, items: PackingItem[]): Promise<void> {
  const { data: existing, error: existingError } = await supabase().from('packing_items').select('id').eq('trip_id', tripId);
  if (existingError) throw existingError;
  const nextIds = new Set(items.map(item => item.id));
  const removedIds = (existing as Array<{ id: string }>).map(item => item.id).filter(id => !nextIds.has(id));
  if (removedIds.length) {
    const { error } = await supabase().from('packing_items').delete().in('id', removedIds);
    if (error) throw error;
  }
  if (items.length) {
    const rows = items.map(item => ({ ...item, trip_id: tripId }));
    const { error } = await supabase().from('packing_items').upsert(rows);
    if (error) throw error;
  }
}
