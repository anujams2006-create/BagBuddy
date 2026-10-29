export interface Trip {
  id?: string;
  destination: string;
  start_date: string;
  end_date: string;
  travel_mode: string;
  trip_type: string;
  profile: string;
  adults: number;
  children: number;
  child_age?: string;
  bag_type: string;
  weight_limit: number;
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
  weight_limit: number;
  remaining_weight: number;
  overloaded: boolean;
  items_to_remove: PackingItem[];
}

export interface User {
  id: string;
  name: string;
  email: string;
}
