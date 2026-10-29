import { User, Trip, PackingListResult } from './types';
import { generatePackingList } from './packingEngine';

const USERS_KEY = 'bagbuddy_users';
const CURRENT_USER_KEY = 'bagbuddy_current_user';
const TRIPS_KEY = 'bagbuddy_trips';
const CURRENT_TRIP_KEY = 'bagbuddy_current_trip';
const CURRENT_PACKING_KEY = 'bagbuddy_current_packing';

// Initialize with demo user & default sample trip if empty
function initializeDefaults() {
  if (typeof window === 'undefined') return;

  const users = localStorage.getItem(USERS_KEY);
  if (!users) {
    const demoUser = {
      id: 'usr_demo_1',
      name: 'Anuja Shelke',
      email: 'anuja@bagbuddy.app',
      password: 'password123',
    };
    localStorage.setItem(USERS_KEY, JSON.stringify([demoUser]));
    localStorage.setItem(
      CURRENT_USER_KEY,
      JSON.stringify({ id: demoUser.id, name: demoUser.name, email: demoUser.email })
    );

    // Initial sample trip to Goa
    const sampleTrip: Trip = {
      id: 'trip_demo_1',
      destination: 'Goa',
      start_date: '2026-11-15',
      end_date: '2026-11-20',
      travel_mode: 'Flight',
      trip_type: 'Vacation',
      profile: 'Female',
      adults: 1,
      children: 0,
      child_age: '',
      bag_type: 'Cabin Bag',
      weight_limit: 7.0,
      activities: ['Beach', 'Swimming', 'Sightseeing'],
      personalization: ['Sunscreen', 'Skincare', 'Scarf / Stole'],
      toiletries: ['Toothbrush', 'Toothpaste', 'Soap', 'Sunscreen'],
      shifting_items: [],
      created_at: new Date().toISOString(),
    };

    const samplePacking = generatePackingList(sampleTrip);
    localStorage.setItem(TRIPS_KEY, JSON.stringify([sampleTrip]));
    localStorage.setItem(CURRENT_TRIP_KEY, JSON.stringify(sampleTrip));
    localStorage.setItem(CURRENT_PACKING_KEY, JSON.stringify(samplePacking));
  }
}

initializeDefaults();

export function getCurrentUser(): User | null {
  try {
    const data = localStorage.getItem(CURRENT_USER_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null): void {
  if (user) {
    localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
}

export function signup(name: string, email: string, password: string): { success: boolean; user?: User; error?: string } {
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedName = name.trim();

    if (!trimmedName || !trimmedEmail || !password) {
      return { success: false, error: 'Please fill all fields.' };
    }

    const usersStr = localStorage.getItem(USERS_KEY) || '[]';
    const users = JSON.parse(usersStr);

    if (users.some((u: any) => u.email === trimmedEmail)) {
      return { success: false, error: 'An account with this email already exists.' };
    }

    const newUser = {
      id: `usr_${Date.now()}`,
      name: trimmedName,
      email: trimmedEmail,
      password,
    };

    users.push(newUser);
    localStorage.setItem(USERS_KEY, JSON.stringify(users));

    const user: User = { id: newUser.id, name: newUser.name, email: newUser.email };
    setCurrentUser(user);
    return { success: true, user };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error creating account.' };
  }
}

export function login(email: string, password: string): { success: boolean; user?: User; error?: string } {
  try {
    const trimmedEmail = email.trim().toLowerCase();
    const usersStr = localStorage.getItem(USERS_KEY) || '[]';
    const users = JSON.parse(usersStr);

    const user = users.find((u: any) => u.email === trimmedEmail && u.password === password);
    if (!user) {
      return { success: false, error: 'Invalid email or password.' };
    }

    const authenticated: User = { id: user.id, name: user.name, email: user.email };
    setCurrentUser(authenticated);
    return { success: true, user: authenticated };
  } catch (err: any) {
    return { success: false, error: err.message || 'Error logging in.' };
  }
}

export function logout(): void {
  setCurrentUser(null);
}

export function getTrips(): Trip[] {
  try {
    const tripsStr = localStorage.getItem(TRIPS_KEY) || '[]';
    return JSON.parse(tripsStr);
  } catch {
    return [];
  }
}

export function saveTrip(trip: Trip, packingList: PackingListResult): Trip {
  const trips = getTrips();
  const tripId = trip.id || `trip_${Date.now()}`;
  const completeTrip: Trip = {
    ...trip,
    id: tripId,
    created_at: trip.created_at || new Date().toISOString(),
  };

  const existingIndex = trips.findIndex(t => t.id === tripId);
  if (existingIndex >= 0) {
    trips[existingIndex] = completeTrip;
  } else {
    trips.unshift(completeTrip);
  }

  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));
  localStorage.setItem(CURRENT_TRIP_KEY, JSON.stringify(completeTrip));
  localStorage.setItem(CURRENT_PACKING_KEY, JSON.stringify(packingList));

  return completeTrip;
}

export function deleteTrip(tripId: string): void {
  const trips = getTrips().filter(t => t.id !== tripId);
  localStorage.setItem(TRIPS_KEY, JSON.stringify(trips));

  const current = getCurrentTrip();
  if (current && current.id === tripId) {
    localStorage.removeItem(CURRENT_TRIP_KEY);
    localStorage.removeItem(CURRENT_PACKING_KEY);
  }
}

export function getCurrentTrip(): Trip | null {
  try {
    const data = localStorage.getItem(CURRENT_TRIP_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setCurrentTrip(trip: Trip | null): void {
  if (trip) {
    localStorage.setItem(CURRENT_TRIP_KEY, JSON.stringify(trip));
  } else {
    localStorage.removeItem(CURRENT_TRIP_KEY);
  }
}

export function getCurrentPackingList(): PackingListResult | null {
  try {
    const data = localStorage.getItem(CURRENT_PACKING_KEY);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

export function setCurrentPackingList(list: PackingListResult | null): void {
  if (list) {
    localStorage.setItem(CURRENT_PACKING_KEY, JSON.stringify(list));
  } else {
    localStorage.removeItem(CURRENT_PACKING_KEY);
  }
}
