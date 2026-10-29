import { Trip, PackingItem, PackingListResult } from './types';

export function calculateDuration(startDate: string, endDate: string): number {
  try {
    if (!startDate || !endDate) return 1;
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime();
    if (isNaN(start) || isNaN(end)) return 1;
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(days, 1);
  } catch {
    return 1;
  }
}

function addItem(
  categories: Record<string, PackingItem[]>,
  category: string,
  name: string,
  quantity: number,
  unitWeight: number
) {
  if (quantity <= 0) return;

  const qty = Math.round(quantity);
  const weight = Number((qty * unitWeight).toFixed(2));
  const id = `${category}_${name}_${Math.random().toString(36).substring(2, 7)}`;

  const item: PackingItem = {
    id,
    name,
    quantity: qty,
    weight,
    category,
    packed: false,
  };

  if (!categories[category]) {
    categories[category] = [];
  }
  categories[category].push(item);
}

export function generatePackingList(trip: Trip): PackingListResult {
  const destination = trip.destination || '';
  const startDate = trip.start_date || '';
  const endDate = trip.end_date || '';
  const duration = calculateDuration(startDate, endDate);
  const travelMode = trip.travel_mode || '';
  const tripType = trip.trip_type || '';
  const profile = trip.profile || '';
  const activities = trip.activities || [];
  const toiletries = trip.toiletries || [];
  const personalization = trip.personalization || [];
  const shiftingItems = trip.shifting_items || [];
  const adults = Number(trip.adults) || 1;
  const children = Number(trip.children) || 0;
  const weightLimit = Number(trip.weight_limit) || 7.0;

  const categories: Record<string, PackingItem[]> = {};

  // =====================================================
  // PROFILE SPECIFIC
  // =====================================================
  if (profile === 'Male') {
    addItem(categories, '👕 Clothes', 'T-Shirts / Tops', Math.max(2, duration), 0.18);
    addItem(categories, '👕 Clothes', 'Pants / Bottoms', Math.max(1, Math.floor((duration + 1) / 2)), 0.35);
    addItem(categories, '👕 Clothes', 'Underwear', duration, 0.06);
    addItem(categories, '👕 Clothes', 'Socks', duration, 0.04);
    addItem(categories, '🛏️ Sleepwear', 'Nightwear', Math.max(1, Math.floor(duration / 2)), 0.20);
    addItem(categories, '👟 Footwear', 'Everyday Shoes', 1, 0.80);
    addItem(categories, '👟 Footwear', 'Slippers', 1, 0.30);
  } else if (profile === 'Female') {
    addItem(categories, '👗 Clothes', 'T-Shirts / Tops', Math.max(2, duration), 0.18);
    addItem(categories, '👗 Clothes', 'Pants / Bottoms', Math.max(1, Math.floor((duration + 1) / 2)), 0.35);
    addItem(categories, '👗 Clothes', 'Underwear', duration, 0.06);
    addItem(categories, '👗 Clothes', 'Socks', duration, 0.04);
    addItem(categories, "👗 Women's Essentials", 'Scarf / Stole', 1, 0.15);
    addItem(categories, "👗 Women's Essentials", 'Personal Hygiene Products', 1, 0.15);
    addItem(categories, '👟 Footwear', 'Everyday Shoes', 1, 0.80);
    addItem(categories, '👟 Footwear', 'Slippers', 1, 0.30);
  } else if (profile === 'Children') {
    const childCount = Math.max(children, 1);
    addItem(categories, "🧒 Children's Clothes", 'T-Shirts / Tops', childCount * Math.max(2, duration), 0.10);
    addItem(categories, "🧒 Children's Clothes", 'Pants / Bottoms', childCount * Math.max(1, Math.floor((duration + 1) / 2)), 0.20);
    addItem(categories, "🧒 Children's Clothes", 'Underwear', childCount * duration, 0.04);
    addItem(categories, "🧒 Children's Clothes", 'Socks', childCount * duration, 0.03);
    addItem(categories, "🧒 Children's Essentials", "Children's Shoes", childCount, 0.45);
    addItem(categories, "🧒 Children's Essentials", "Children's Toiletries", childCount, 0.10);
    addItem(categories, "🧒 Children's Essentials", 'Snacks', childCount, 0.15);
  } else if (profile === 'Family') {
    if (adults > 0) {
      addItem(categories, '👕 Adult Clothes', 'T-Shirts / Tops', adults * Math.max(2, duration), 0.18);
      addItem(categories, '👕 Adult Clothes', 'Pants / Bottoms', adults * Math.max(1, Math.floor((duration + 1) / 2)), 0.35);
      addItem(categories, '👕 Adult Clothes', 'Underwear', adults * duration, 0.06);
      addItem(categories, '👕 Adult Clothes', 'Socks', adults * duration, 0.04);
      addItem(categories, '👟 Footwear', 'Adult Shoes', adults, 0.80);
    }
    if (children > 0) {
      addItem(categories, "🧒 Children's Clothes", 'T-Shirts / Tops', children * Math.max(2, duration), 0.10);
      addItem(categories, "🧒 Children's Clothes", 'Pants / Bottoms', children * Math.max(1, Math.floor((duration + 1) / 2)), 0.20);
      addItem(categories, "🧒 Children's Clothes", 'Underwear', children * duration, 0.04);
      addItem(categories, "🧒 Children's Clothes", 'Socks', children * duration, 0.03);
      addItem(categories, '👟 Footwear', "Children's Shoes", children, 0.45);
    }
    addItem(categories, '👨‍👩‍👧 Family Essentials', 'Family First Aid Kit', 1, 0.30);
    addItem(categories, '👨‍👩‍👧 Family Essentials', 'Snacks', Math.max(1, adults + children), 0.15);
  } else {
    // Default / Other
    addItem(categories, 'Clothing', 'T-Shirts / Tops', Math.max(2, duration), 0.18);
    addItem(categories, 'Clothing', 'Pants / Bottoms', Math.max(1, Math.floor((duration + 1) / 2)), 0.35);
    addItem(categories, 'Clothing', 'Underwear', duration, 0.06);
    addItem(categories, 'Clothing', 'Socks', duration, 0.04);
    addItem(categories, 'Sleepwear', 'Nightwear', Math.max(1, Math.floor(duration / 2)), 0.20);
    addItem(categories, 'Footwear', 'Everyday Shoes', 1, 0.80);
    addItem(categories, 'Footwear', 'Slippers', 1, 0.30);
  }

  // Common Toiletries
  const people = Math.max(adults + children, 1);
  if (children > 0 && profile !== 'Children' && profile !== 'Family') {
    addItem(categories, "Children's Essentials", "Children's clothes", children * Math.max(2, duration), 0.10);
    addItem(categories, "Children's Essentials", "Children's toiletries", children, 0.10);
    addItem(categories, "Children's Essentials", 'Snacks', children, 0.15);
  }

  addItem(categories, '🧴 Toiletries', 'Toothbrush', people, 0.03);
  addItem(categories, '🧴 Toiletries', 'Toothpaste', 1, 0.08);
  addItem(categories, '🧴 Toiletries', 'Soap', 1, 0.10);
  addItem(categories, '🧴 Toiletries', 'Shampoo', 1, 0.10);
  addItem(categories, '🧴 Toiletries', 'Deodorant', 1, 0.10);

  const defaultToiletries = new Set(['Toothbrush', 'Toothpaste', 'Soap', 'Shampoo', 'Deodorant']);
  for (const item of toiletries) {
    if (!defaultToiletries.has(item)) {
      addItem(categories, '🧴 Toiletries', item, 1, 0.08);
    }
  }

  // Personalization preferences
  const personalCareSet = new Set(['Skincare', 'Makeup', 'Hair care', 'Sanitary essentials', 'Shaving kit', 'Beard care']);
  for (const item of personalization) {
    const isCare = personalCareSet.has(item);
    const category = isCare ? 'Personal Care' : 'Accessories';
    const weight = isCare ? 0.12 : 0.10;
    addItem(categories, category, item, 1, weight);
  }

  // Electronics
  addItem(categories, '🔌 Electronics', 'Phone Charger', people, 0.10);
  addItem(categories, '🔌 Electronics', 'Power Bank', 1, 0.20);

  // Documents
  addItem(categories, '📄 Documents', 'ID / Passport', people, 0.05);
  addItem(categories, '📄 Documents', 'Travel Documents', 1, 0.05);

  // Activities
  if (activities.includes('Beach')) {
    addItem(categories, '🏖️ Beach', 'Swimwear', people, 0.15);
    addItem(categories, '🏖️ Beach', 'Sunglasses', people, 0.03);
    addItem(categories, '🏖️ Beach', 'Sunscreen', 1, 0.10);
  }
  if (activities.includes('Hiking')) {
    addItem(categories, '🥾 Hiking', 'Hiking Shoes', people, 0.70);
    addItem(categories, '🥾 Hiking', 'Water Bottle', people, 0.20);
    addItem(categories, '🥾 Hiking', 'Small Backpack', 1, 0.40);
  }
  if (activities.includes('Swimming')) {
    addItem(categories, '🏊 Swimming', 'Swimming Clothes', people, 0.15);
    addItem(categories, '🏊 Swimming', 'Swimming Towel', people, 0.20);
  }
  if (activities.includes('Sightseeing')) {
    addItem(categories, '📸 Sightseeing', 'Sunglasses', people, 0.03);
    addItem(categories, '📸 Sightseeing', 'Day Bag', 1, 0.30);
  }
  if (activities.includes('Gym')) {
    addItem(categories, '🏋️ Gym', 'Workout Clothes', people, 0.20);
    addItem(categories, '🏋️ Gym', 'Gym Towel', people, 0.10);
  }
  if (activities.includes('Photography')) {
    addItem(categories, '📷 Photography', 'Camera & Lenses', 1, 0.90);
    addItem(categories, '📷 Photography', 'Extra Memory Cards & Batteries', 1, 0.15);
  }
  if (activities.includes('Party')) {
    addItem(categories, '✨ Party', 'Party Outfit', people, 0.35);
    addItem(categories, '✨ Party', 'Perfume / Cologne', 1, 0.15);
  }

  // Travel Mode
  if (travelMode === 'Hostel') {
    const hostelDefaults = [
      { name: 'Bedsheet', weight: 0.50 },
      { name: 'Pillow Cover', weight: 0.15 },
      { name: 'Blanket', weight: 0.80 },
      { name: 'Towels', weight: 0.30 },
      { name: 'Hangers', weight: 0.20 },
      { name: 'Laundry Bag', weight: 0.15 },
      { name: 'Lock & Keys', weight: 0.10 },
      { name: 'Storage Bags', weight: 0.10 },
      { name: 'Basic Utensils', weight: 0.40 },
      { name: 'Water Bottle', weight: 0.20 },
      { name: 'Extension Board', weight: 0.30 }
    ];
    for (const item of hostelDefaults) {
      addItem(categories, '🏠 Hostel Essentials', item.name, 1, item.weight);
    }
    // Also include shifting items if selected
    for (const item of shiftingItems) {
      if (!hostelDefaults.some(d => d.name.toLowerCase() === item.toLowerCase())) {
        addItem(categories, '🏠 Hostel Essentials', item, 1, 0.25);
      }
    }
  } else if (travelMode === 'Flight') {
    addItem(categories, '✈️ Travel Essentials', 'Neck Pillow', 1, 0.25);
    addItem(categories, '✈️ Travel Essentials', 'Travel Pouch', 1, 0.10);
  } else if (travelMode === 'Train') {
    addItem(categories, '🚆 Train Essentials', 'Travel Pillow', 1, 0.30);
    addItem(categories, '🚆 Train Essentials', 'Eye Mask', 1, 0.03);
  } else if (travelMode === 'Bus') {
    addItem(categories, '🚌 Bus Essentials', 'Neck Pillow', 1, 0.25);
    addItem(categories, '🚌 Bus Essentials', 'Water Bottle', 1, 0.20);
  } else if (travelMode === 'Car') {
    addItem(categories, '🚗 Car Essentials', 'Travel Pillow', 1, 0.30);
    addItem(categories, '🚗 Car Essentials', 'Car Charger', 1, 0.10);
  }

  // Trip Type
  if (tripType === 'Business') {
    addItem(categories, '💼 Business', 'Formal Shirt', Math.max(1, Math.floor(duration / 2)), 0.20);
    addItem(categories, '💼 Business', 'Formal Pants', Math.max(1, Math.floor(duration / 2)), 0.35);
    addItem(categories, '💼 Business', 'Laptop', 1, 1.50);
    addItem(categories, '💼 Business', 'Laptop Charger', 1, 0.20);
  } else if (tripType === 'College') {
    addItem(categories, '🎓 College', 'Notebook', 2, 0.25);
    addItem(categories, '🎓 College', 'Pen', 3, 0.01);
    addItem(categories, '🎓 College', 'College ID', 1, 0.02);
  }

  // Aggregate items and weight
  const allItems: PackingItem[] = [];
  for (const catItems of Object.values(categories)) {
    allItems.push(...catItems);
  }

  const totalWeight = Number(
    allItems.reduce((sum, item) => sum + item.weight, 0).toFixed(2)
  );

  const remainingWeight = Number((weightLimit - totalWeight).toFixed(2));
  const overloaded = totalWeight > weightLimit;

  // Items to remove suggestion
  const itemsToRemove: PackingItem[] = [];
  if (overloaded) {
    const excess = totalWeight - weightLimit;
    const sorted = [...allItems].sort((a, b) => b.weight - a.weight);
    let removedWeight = 0;
    for (const item of sorted) {
      if (removedWeight >= excess) break;
      itemsToRemove.push(item);
      removedWeight += item.weight;
    }
  }

  return {
    categories,
    items: allItems,
    duration,
    destination,
    profile,
    travel_mode: travelMode,
    total_weight: totalWeight,
    weight_limit: weightLimit,
    remaining_weight: remainingWeight,
    overloaded,
    items_to_remove: itemsToRemove,
  };
}
