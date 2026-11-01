import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const authClient = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

app.use(cors());
app.use(express.json());

async function requireAuthenticatedUser(req: express.Request, res: express.Response): Promise<string | null> {
  if (!authClient) {
    res.status(503).json({ error: 'Supabase server authentication is not configured.' });
    return null;
  }
  const bearer = req.header('authorization');
  const token = bearer?.startsWith('Bearer ') ? bearer.slice('Bearer '.length) : null;
  if (!token) {
    res.status(401).json({ error: 'Authentication is required.' });
    return null;
  }
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) {
    res.status(401).json({ error: 'Your session is invalid or has expired.' });
    return null;
  }
  return data.user.id;
}


// Initialize Google GenAI if key is present
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Secure chat tools.
//
// The model never gets database access. It can only call the small set of
// tools below; every tool runs on the server with the SIGNED-IN USER's
// Supabase token (so Postgres RLS applies) and additionally scopes every
// query by the user id taken from the verified session — never from the
// request body or from model-supplied arguments. Tool arguments are
// validated on the server, referenced trips/items are re-checked for
// ownership before any read or write, and destructive actions require an
// explicit conversational confirmation (see remove_packing_item).
//
// This block is intentionally duplicated in `api/chat.ts`: Vercel functions
// in this project are self-contained, so the two copies must be kept in step.
// ---------------------------------------------------------------------------

interface ChatDb {
  listTrips(userId: string): Promise<any[]>;
  getTrip(userId: string, tripId: string): Promise<any | null>;
  listPackingItems(tripId: string): Promise<any[]>;
  insertPackingItem(row: Record<string, unknown>): Promise<any>;
  updatePackingItem(itemId: string, tripId: string, patch: Record<string, unknown>): Promise<void>;
  deletePackingItem(itemId: string, tripId: string): Promise<void>;
  updateTrip(tripId: string, userId: string, patch: Record<string, unknown>): Promise<any>;
}

interface ResolvedChatPlace {
  displayName: string;
  latitude: number;
  longitude: number;
  timezone: string | null;
}

interface ChatToolContext {
  userId: string;
  activeTripId: string | null;
  db: ChatDb;
  geocodePlace: (name: string) => Promise<ResolvedChatPlace | null>;
  fetchWeather: (trip: any) => Promise<any>;
}

interface ChatToolOutcome {
  result: Record<string, unknown>;
  dataChanged?: boolean;
  changeSummary?: string;
}

const CHAT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAT_ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolve a free-text place name to coordinates for update_trip_details,
// using the same Open-Meteo geocoding source and the same
// exact-match-then-population strategy as the weather implementation.
async function resolvePlaceByName(name: string): Promise<ResolvedChatPlace | null> {
  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`
  );
  if (!response.ok) return null;
  const data: any = await response.json().catch(() => null);
  const results: any[] = Array.isArray(data?.results) ? data.results : [];
  if (!results.length) return null;
  const normalise = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const target = normalise(name);
  const populationOf = (candidate: any) => (typeof candidate?.population === 'number' ? candidate.population : 0);
  const exact = results.filter(c => normalise(String(c?.name ?? '')) === target);
  const prefix = results.filter(c => normalise(String(c?.name ?? '')).startsWith(target));
  const pool = exact.length ? exact : prefix.length ? prefix : results;
  const place = [...pool].sort((a, b) => populationOf(b) - populationOf(a))[0];
  if (!place || typeof place.latitude !== 'number' || typeof place.longitude !== 'number') return null;
  const displayName = [place.name, place.admin1, place.country]
    .filter((part: unknown, index: number, all: unknown[]) => typeof part === 'string' && part && all.indexOf(part) === index)
    .join(', ');
  return {
    displayName: displayName || String(place.name),
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: typeof place.timezone === 'string' ? place.timezone : null,
  };
}

// Supabase implementation of ChatDb. Every call goes through a client built
// from the caller's own access token (RLS enforced by Postgres) and is
// additionally filtered by user id where the schema supports it.
function createSupabaseChatDb(accessToken: string, url: string, publishableKey: string): ChatDb {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const dbError = () => new Error('Database request failed.');
  return {
    async listTrips(userId) {
      const { data, error } = await client.from('trips').select('*').eq('user_id', userId)
        .order('start_date', { ascending: true }).limit(20);
      if (error) throw dbError();
      return data ?? [];
    },
    async getTrip(userId, tripId) {
      const { data, error } = await client.from('trips').select('*')
        .eq('id', tripId).eq('user_id', userId).limit(1);
      if (error) throw dbError();
      return data?.[0] ?? null;
    },
    async listPackingItems(tripId) {
      const { data, error } = await client.from('packing_items').select('*')
        .eq('trip_id', tripId).order('created_at', { ascending: true });
      if (error) throw dbError();
      return data ?? [];
    },
    async insertPackingItem(row) {
      const { data, error } = await client.from('packing_items').insert(row).select().single();
      if (error) throw dbError();
      return data;
    },
    async updatePackingItem(itemId, tripId, patch) {
      const { error } = await client.from('packing_items').update(patch)
        .eq('id', itemId).eq('trip_id', tripId);
      if (error) throw dbError();
    },
    async deletePackingItem(itemId, tripId) {
      const { error } = await client.from('packing_items').delete()
        .eq('id', itemId).eq('trip_id', tripId);
      if (error) throw dbError();
    },
    async updateTrip(tripId, userId, patch) {
      const { data, error } = await client.from('trips').update(patch)
        .eq('id', tripId).eq('user_id', userId).select().single();
      if (error) throw dbError();
      return data;
    },
  };
}

function chatCleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength ? trimmed : null;
}
function chatCleanInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}
function chatCleanNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function chatItemView(item: any) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    weight_kg: item.weight,
    packed: !!item.packed,
  };
}

function chatTripView(trip: any) {
  const legs = (Array.isArray(trip?.transport_legs) ? trip.transport_legs : []).map((leg: any) => ({
    from: leg.origin || null,
    to: leg.destination,
    type: leg.transport_type === 'Flight' ? 'Plane' : leg.transport_type,
    ...(leg.transport_type === 'Plane' || leg.transport_type === 'Flight'
      ? { airline_baggage_allowance_kg: typeof leg.baggage_allowance_kg === 'number' ? leg.baggage_allowance_kg : null }
      : {}),
    ...(leg.departure_time ? { departure_time: leg.departure_time } : {}),
    ...(leg.arrival_time ? { arrival_time: leg.arrival_time } : {}),
  }));
  return {
    id: trip.id,
    destination: trip.destination,
    start_date: trip.start_date,
    end_date: trip.end_date,
    transport_summary: chatTransportSummary(trip),
    legs,
    has_flight_leg: chatHasPlaneLeg(trip),
    // Effective airline limit for plane legs only; null means no limit
    // applies (no flight, or allowance not provided) — never invent one.
    baggage_limit_kg: typeof trip.weight_limit === 'number' ? trip.weight_limit : null,
    bag_type: trip.bag_type ?? null,
  };
}

// Resolve which trip a tool call targets and verify ownership. The model may
// pass any trip_id it likes; only trips owned by the session user resolve,
// and everything else reports the same "not found" as a missing trip.
async function chatLoadOwnedTrip(
  ctx: ChatToolContext,
  args: Record<string, any>
): Promise<{ trip: any } | { error: Record<string, unknown> }> {
  const raw = typeof args?.trip_id === 'string' && args.trip_id.trim() ? args.trip_id.trim() : ctx.activeTripId;
  if (!raw) {
    return {
      error: {
        error: 'No trip was specified and no trip is currently open in the app.',
        clarification_needed: true,
        hint: 'Ask the user which trip they mean. Call get_my_trips if you need to list their trips by destination and dates.',
      },
    };
  }
  if (!CHAT_UUID_RE.test(raw)) return { error: { error: 'That trip reference is not valid.' } };
  const trip = await ctx.db.getTrip(ctx.userId, raw);
  if (!trip) return { error: { error: 'Trip not found.' } };
  return { trip };
}

async function chatFindItem(
  ctx: ChatToolContext,
  tripId: string,
  args: Record<string, any>
): Promise<{ item: any } | { error: Record<string, unknown> }> {
  const items = await ctx.db.listPackingItems(tripId);
  if (typeof args?.item_id === 'string' && args.item_id) {
    const byId = items.find(item => item.id === args.item_id);
    return byId ? { item: byId } : { error: { error: 'That item is not on this trip\'s packing list.' } };
  }
  const name = chatCleanString(args?.item_name, 120);
  if (!name) return { error: { error: 'Tell me which item you mean (its name or id).', clarification_needed: true } };
  const lower = name.toLowerCase();
  const exact = items.filter(item => String(item.name).toLowerCase() === lower);
  const pool = exact.length ? exact : items.filter(item => String(item.name).toLowerCase().includes(lower));
  if (!pool.length) return { error: { error: `No item matching "${name}" is on this trip's packing list.` } };
  if (pool.length > 1) {
    return {
      error: {
        error: `Several items match "${name}". Ask the user which one they mean.`,
        clarification_needed: true,
        candidates: pool.map(chatItemView),
      },
    };
  }
  return { item: pool[0] };
}

async function executeChatTool(
  ctx: ChatToolContext,
  name: string,
  args: Record<string, any>
): Promise<ChatToolOutcome> {
  try {
    switch (name) {
      case 'get_my_trips': {
        const trips = await ctx.db.listTrips(ctx.userId);
        return { result: { trips: trips.map(chatTripView) } };
      }
      case 'get_trip_details': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        return { result: { trip: chatTripView(loaded.trip) } };
      }
      case 'get_packing_list': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const items = await ctx.db.listPackingItems(loaded.trip.id);
        const totalWeight = Math.round(items.reduce((sum, i) => sum + (Number(i.weight) || 0), 0) * 100) / 100;
        return {
          result: {
            trip_id: loaded.trip.id,
            trip_destination: loaded.trip.destination,
            items: items.map(chatItemView),
            total_weight_kg: totalWeight,
            packed_count: items.filter(i => i.packed).length,
            baggage_limit_kg: typeof loaded.trip.weight_limit === 'number' ? loaded.trip.weight_limit : null,
            has_flight_leg: chatHasPlaneLeg(loaded.trip),
          },
        };
      }
      case 'get_trip_weather': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const weather = await ctx.fetchWeather(loaded.trip);
        return {
          result: {
            trip_id: loaded.trip.id,
            trip_destination: loaded.trip.destination,
            weather_status: weather?.status ?? 'unavailable',
            location: weather?.location ?? null,
            timezone: weather?.timezone ?? null,
            requested_start_date: weather?.requested_start_date ?? loaded.trip.start_date,
            requested_end_date: weather?.requested_end_date ?? loaded.trip.end_date,
            horizon_end: weather?.horizon_end ?? null,
            forecast_days: Array.isArray(weather?.days) ? weather.days.slice(0, 16) : [],
            notes: Array.isArray(weather?.notes) ? weather.notes : [],
            source: 'Open-Meteo',
          },
        };
      }
      case 'add_packing_item': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const itemName = chatCleanString(args?.item_name, 80);
        if (!itemName) return { result: { error: 'An item name (1–80 characters) is required.' } };
        const category = chatCleanString(args?.category, 40) ?? 'Other Essentials';
        const quantity = args?.quantity == null ? 1 : chatCleanInt(args.quantity, 1, 20);
        if (quantity == null) return { result: { error: 'Quantity must be a whole number between 1 and 20.' } };
        const unitWeight = args?.weight == null ? 0.25 : chatCleanNumber(args.weight, 0, 25);
        if (unitWeight == null) return { result: { error: 'Weight must be between 0 and 25 kg per item.' } };
        const row = {
          id: `chat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
          trip_id: loaded.trip.id,
          name: itemName,
          category,
          quantity,
          weight: Math.round(quantity * unitWeight * 100) / 100,
          packed: false,
        };
        const inserted = await ctx.db.insertPackingItem(row);
        return {
          result: { added: chatItemView(inserted ?? row), trip_destination: loaded.trip.destination },
          dataChanged: true,
          changeSummary: `added "${itemName}" to the ${loaded.trip.destination} packing list`,
        };
      }
      case 'update_packing_item': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const found = await chatFindItem(ctx, loaded.trip.id, args);
        if ('error' in found) return { result: found.error };
        const patch: Record<string, unknown> = {};
        if (typeof args?.packed === 'boolean') patch.packed = args.packed;
        if (args?.quantity != null) {
          const q = chatCleanInt(args.quantity, 1, 100);
          if (q == null) return { result: { error: 'Quantity must be a whole number between 1 and 100.' } };
          patch.quantity = q;
        }
        if (args?.new_name != null) {
          const renamed = chatCleanString(args.new_name, 80);
          if (!renamed) return { result: { error: 'The new name must be 1–80 characters.' } };
          patch.name = renamed;
        }
        if (!Object.keys(patch).length) {
          return { result: { error: 'Nothing to update: provide packed, quantity, or new_name.', clarification_needed: true } };
        }
        await ctx.db.updatePackingItem(found.item.id, loaded.trip.id, patch);
        return {
          result: { updated: chatItemView({ ...found.item, ...patch }), trip_destination: loaded.trip.destination },
          dataChanged: true,
          changeSummary: `updated "${found.item.name}" on the ${loaded.trip.destination} packing list`,
        };
      }
      case 'remove_packing_item': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const found = await chatFindItem(ctx, loaded.trip.id, args);
        if ('error' in found) return { result: found.error };
        if (args?.confirm !== true) {
          // Destructive action: never delete on the first call. The model
          // must ask the user and call again with confirm: true only after
          // the user explicitly agrees.
          return {
            result: {
              requires_confirmation: true,
              item: chatItemView(found.item),
              instruction: 'Do not delete yet. Ask the user to confirm removing this item, and call remove_packing_item again with the same item and confirm: true only after they clearly agree.',
            },
          };
        }
        await ctx.db.deletePackingItem(found.item.id, loaded.trip.id);
        return {
          result: { removed: chatItemView(found.item), trip_destination: loaded.trip.destination },
          dataChanged: true,
          changeSummary: `removed "${found.item.name}" from the ${loaded.trip.destination} packing list`,
        };
      }
      case 'update_trip_details': {
        const loaded = await chatLoadOwnedTrip(ctx, args);
        if ('error' in loaded) return { result: loaded.error };
        const trip = loaded.trip;
        const patch: Record<string, unknown> = {};
        const changed: string[] = [];
        if (args?.destination != null) {
          const destination = chatCleanString(args.destination, 120);
          if (!destination) return { result: { error: 'The destination must be 1–120 characters.' } };
          const place = await ctx.geocodePlace(destination);
          if (!place) {
            return { result: { error: `I couldn't find a place called "${destination}". Ask the user for a more specific place name; nothing was changed.` } };
          }
          patch.destination = place.displayName;
          patch.latitude = place.latitude;
          patch.longitude = place.longitude;
          patch.timezone = place.timezone;
          changed.push(`destination → ${place.displayName}`);
        }
        let startDate = trip.start_date as string;
        let endDate = trip.end_date as string;
        if (args?.start_date != null) {
          if (typeof args.start_date !== 'string' || !CHAT_ISO_DATE_RE.test(args.start_date)) {
            return { result: { error: 'start_date must be an ISO date (YYYY-MM-DD).' } };
          }
          startDate = args.start_date;
          patch.start_date = startDate;
          changed.push(`start date → ${startDate}`);
        }
        if (args?.end_date != null) {
          if (typeof args.end_date !== 'string' || !CHAT_ISO_DATE_RE.test(args.end_date)) {
            return { result: { error: 'end_date must be an ISO date (YYYY-MM-DD).' } };
          }
          endDate = args.end_date;
          patch.end_date = endDate;
          changed.push(`end date → ${endDate}`);
        }
        if (startDate && endDate && endDate < startDate) {
          return { result: { error: `The end date (${endDate}) would be before the start date (${startDate}). Nothing was changed.` } };
        }
        if (!changed.length) {
          return { result: { error: 'Nothing to update: provide a destination, start_date, or end_date.', clarification_needed: true } };
        }
        const updated = await ctx.db.updateTrip(trip.id, ctx.userId, patch);
        return {
          result: { updated_trip: chatTripView(updated ?? { ...trip, ...patch }), changed },
          dataChanged: true,
          changeSummary: `updated the ${trip.destination} trip (${changed.join(', ')})`,
        };
      }
      default:
        return { result: { error: `Unknown tool "${name}".` } };
    }
  } catch (error) {
    console.error(`Chat tool ${name} failed:`, error instanceof Error ? error.message : error);
    return { result: { error: 'That operation could not be completed. No private data was exposed; please try again.' } };
  }
}

const chatToolDeclarations = [
  {
    name: 'get_my_trips',
    description: "List the signed-in user's own trips (destination, dates, transport, baggage limit). Use when the user asks about their trips or when you need to identify which trip they mean.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_trip_details',
    description: 'Get details of one of the user\'s trips: destination, dates, transport legs and the plane-leg baggage limit. Defaults to the trip open in the app when trip_id is omitted.',
    parameters: { type: Type.OBJECT, properties: { trip_id: { type: Type.STRING, description: 'Trip id from get_my_trips or the open trip. Optional.' } } },
  },
  {
    name: 'get_packing_list',
    description: "Get one trip's packing list with packed status, total weight and the baggage limit (null when no limit applies). Use for packing, weight and 'what have I packed / what is missing' questions.",
    parameters: { type: Type.OBJECT, properties: { trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' } } },
  },
  {
    name: 'get_trip_weather',
    description: "Get the real Open-Meteo forecast for one trip's destination and dates. This is the ONLY allowed source for trip weather answers. forecast_days may be empty when the trip is beyond the forecast horizon, in the past, or the place cannot be resolved.",
    parameters: { type: Type.OBJECT, properties: { trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' } } },
  },
  {
    name: 'add_packing_item',
    description: "Add an item to a trip's packing list. weight is an estimated per-item weight in kg.",
    parameters: { type: Type.OBJECT, properties: {
      trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' },
      item_name: { type: Type.STRING, description: 'Item name.' },
      category: { type: Type.STRING, description: 'Packing category, e.g. "🔌 Electronics". Optional.' },
      quantity: { type: Type.NUMBER, description: 'Quantity, default 1.' },
      weight: { type: Type.NUMBER, description: 'Estimated weight per item in kg, default 0.25.' },
    }, required: ['item_name'] },
  },
  {
    name: 'update_packing_item',
    description: "Update one packing item: mark packed/unpacked, change quantity, or rename it. Identify the item by item_name (from get_packing_list) or item_id.",
    parameters: { type: Type.OBJECT, properties: {
      trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' },
      item_name: { type: Type.STRING, description: 'Current item name.' },
      item_id: { type: Type.STRING, description: 'Item id, if known.' },
      packed: { type: Type.BOOLEAN, description: 'New packed status.' },
      quantity: { type: Type.NUMBER, description: 'New quantity.' },
      new_name: { type: Type.STRING, description: 'New item name (rename).' },
    } },
  },
  {
    name: 'remove_packing_item',
    description: "Remove one item from a trip's packing list. DESTRUCTIVE: call first WITHOUT confirm; the tool returns requires_confirmation and you must ask the user. Only call again with confirm: true after the user explicitly agrees.",
    parameters: { type: Type.OBJECT, properties: {
      trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' },
      item_name: { type: Type.STRING, description: 'Item name.' },
      item_id: { type: Type.STRING, description: 'Item id, if known.' },
      confirm: { type: Type.BOOLEAN, description: 'Must be true, and only after the user explicitly confirmed the removal in the conversation.' },
    } },
  },
  {
    name: 'update_trip_details',
    description: "Update a trip's destination and/or dates. A new destination is resolved to a real place server-side (coordinates and timezone are refreshed so weather keeps working). Report the resolved place name back to the user.",
    parameters: { type: Type.OBJECT, properties: {
      trip_id: { type: Type.STRING, description: 'Trip id. Optional; defaults to the open trip.' },
      destination: { type: Type.STRING, description: 'New destination place name.' },
      start_date: { type: Type.STRING, description: 'New start date, YYYY-MM-DD.' },
      end_date: { type: Type.STRING, description: 'New end date, YYYY-MM-DD.' },
    } },
  },
];

// Gemini conversation with server-side tool execution. The model chooses
// tools; the server executes them against the user's own data and feeds the
// results back, for up to 5 rounds.
async function runGeminiToolChatImpl(
  aiClient: any,
  model: string,
  message: string,
  history: { role: string; text: string }[],
  ctx: ChatToolContext,
  roundTimeoutMs: number
): Promise<{ reply: string; dataChanged: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are "BagBuddy AI", the assistant inside the BagBuddy travel-packing app. You help the signed-in user with THEIR OWN trips and packing lists, using the provided tools. Today's date is ${today}.

CONTEXT
- The trip currently open in the app has id ${ctx.activeTripId ?? '(none is open)'}. Treat it as the default when the user says "my trip" without naming another; tools default to it when trip_id is omitted.
- The user's identity is handled by the server. NEVER ask for, accept, or pass a user id, and never claim access to anyone else's data.

RULES
1. Fetch only what the question needs. Weather question -> get_trip_weather (get_trip_details only if dates/route matter). Packing or weight question -> get_packing_list. "What trips do I have" -> get_my_trips. Do not fetch unrelated data.
2. Never invent trips, packing items, weather, or baggage allowances. Use only tool results. If a tool returns an error or empty data, say so plainly.
3. Weather answers come ONLY from get_trip_weather. Answer the user's actual question FIRST and conversationally - rain question: a clear yes/no plus the rain chances on the relevant days; jacket question: a clear yes/no citing the lowest temperatures; then add at most a line of supporting detail. Do NOT recite the whole day-by-day forecast unless the user asks for the full forecast. If forecast_days is empty (beyond the horizon, past trip, unresolved place), say a reliable forecast is not available for those dates yet. Clearly separate any general seasonal advice from the actual forecast.
4. Baggage limits apply ONLY to plane legs. baggage_limit_kg null means NO limit applies (no flight, or the airline allowance was never provided) - never state or assume a limit then.
5. Ambiguity: if a tool result has clarification_needed, ask ONE concise question using the candidates given. Do not guess.
6. Removing an item is destructive: call remove_packing_item WITHOUT confirm first; it returns requires_confirmation. Then ask the user, and only call it again with confirm: true after they clearly agree in a later message. Never set confirm: true on your own initiative.
7. After a successful write, briefly state exactly what changed (item name, new destination, new dates).
8. Requests outside BagBuddy's capabilities (booking flights, payments, other people's trips, deleting whole trips) cannot be done with these tools: explain that briefly and help generally if you can.
9. Keep replies natural, friendly and concise. No raw JSON, no tool names.`;

  const contents: any[] = history.slice(-6).map(h => ({
    role: h.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: h.text }],
  }));
  contents.push({ role: 'user', parts: [{ text: message }] });

  let dataChanged = false;
  const changes: string[] = [];
  for (let round = 0; round < 5; round++) {
    const call = aiClient.models.generateContent({
      model,
      contents,
      config: { systemInstruction: systemPrompt, tools: [{ functionDeclarations: chatToolDeclarations }] },
    });
    let response: any;
    try {
      response = roundTimeoutMs > 0
        ? await Promise.race([
            call,
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), roundTimeoutMs)),
          ])
        : await call;
    } catch (error) {
      // A failure on the very first call usually means the model name is
      // unavailable for this API key; the wrapper retries with the next
      // candidate model in that case.
      if (round === 0) (error as any).modelUnavailable = true;
      throw error;
    }
    const calls = response.functionCalls ?? [];
    if (!calls.length) {
      const text = typeof response.text === 'string' ? response.text.trim() : '';
      if (text) return { reply: text, dataChanged };
      if (changes.length) return { reply: `Done — ${changes.join('; ')}.`, dataChanged };
      return { reply: "I couldn't work out an answer for that. Could you rephrase it?", dataChanged };
    }
    contents.push({ role: 'model', parts: calls.map((c: any) => ({ functionCall: { name: c.name, args: c.args ?? {} } })) });
    const responseParts: any[] = [];
    for (const c of calls) {
      const outcome = await executeChatTool(ctx, c.name ?? '', (c.args ?? {}) as Record<string, any>);
      if (outcome.dataChanged) {
        dataChanged = true;
        if (outcome.changeSummary) changes.push(outcome.changeSummary);
      }
      responseParts.push({ functionResponse: { name: c.name, response: outcome.result } });
    }
    contents.push({ role: 'user', parts: responseParts });
  }
  return {
    reply: changes.length
      ? `Done — ${changes.join('; ')}. (I stopped there because the request needed many steps.)`
      : 'That request needed more steps than I can take in one go. Please try splitting it into smaller requests.',
    dataChanged,
  };
}

// Tries each candidate model in order: if the first call fails (for example
// because a configured model name does not exist for this API key), the next
// model is tried before giving up to the deterministic fallback.
async function runGeminiToolChat(
  aiClient: any,
  models: string[],
  message: string,
  history: { role: string; text: string }[],
  ctx: ChatToolContext,
  roundTimeoutMs: number
): Promise<{ reply: string; dataChanged: boolean; engine: string }> {
  let lastError: unknown = null;
  for (const model of models) {
    try {
      const out = await runGeminiToolChatImpl(aiClient, model, message, history, ctx, roundTimeoutMs);
      return { ...out, engine: 'gemini' };
    } catch (error) {
      lastError = error;
      if (!(error as any)?.modelUnavailable) throw error;
      console.warn(`Gemini model "${model}" unavailable; trying next candidate.`);
    }
  }
  throw lastError ?? new Error('No Gemini model available.');
}

// Wrapper that tags fallback replies so the client can show when the full AI
// is unavailable (basic mode) instead of silently sounding scripted.
async function fallbackToolChat(
  message: string,
  ctx: ChatToolContext
): Promise<{ reply: string; dataChanged: boolean; engine: string }> {
  const out = await fallbackToolChatImpl(message, ctx);
  return { ...out, engine: 'fallback' };
}

// Question-aware weather answers for the deterministic fallback. Everything
// below is computed only from the real forecast payload — the wording adapts
// to what was actually asked (rain? jacket? temperature?) instead of dumping
// the raw day list.
function chatAnswerWeatherQuestion(message: string, w: Record<string, any>, fallbackDestination: string): string {
  const lower = message.toLowerCase();
  const dest = w.location?.name ?? fallbackDestination;
  const days: any[] = Array.isArray(w.forecast_days) ? w.forecast_days : [];
  if (!days.length) {
    if (w.weather_status === 'too_far_future') {
      return `A reliable daily forecast isn't available yet for your trip to ${fallbackDestination} (${w.requested_start_date} to ${w.requested_end_date}). Open-Meteo currently forecasts up to ${w.horizon_end}, so check again closer to departure — I won't guess temperatures or rain in the meantime.`;
    }
    if (w.weather_status === 'past') {
      return `That trip to ${fallbackDestination} has already taken place, so there's no forecast to check for it.`;
    }
    if (w.weather_status === 'location_not_found') {
      return `I couldn't match "${fallbackDestination}" to a real place, so I can't show weather for this trip. Editing the trip and picking the destination from the suggestions will fix it.`;
    }
    return `I don't have forecast data for ${fallbackDestination} for those dates, so I can't give you accurate temperatures or rain chances. The weather card on your dashboard shows the forecast as soon as it's available.`;
  }
  const partialNote = w.weather_status === 'partial'
    ? ' (That only covers the first part of your trip — the remaining dates are still beyond the forecast horizon.)'
    : '';
  const range = `${w.requested_start_date} to ${w.requested_end_date}`;
  const minTemp = Math.min(...days.map((d: any) => Number(d.temperature_min)).filter(Number.isFinite));
  const maxTemp = Math.max(...days.map((d: any) => Number(d.temperature_max)).filter(Number.isFinite));
  const pops = days.map((d: any) => d.precipitation_probability_max).filter((v: any) => typeof v === 'number') as number[];
  const maxPop = pops.length ? Math.max(...pops) : null;
  const wettest = days.reduce((a: any, b: any) =>
    (b.precipitation_probability_max ?? -1) > (a.precipitation_probability_max ?? -1) ? b : a, days[0]);

  if (/rain|drizzle|shower|wet|umbrella|monsoon/.test(lower)) {
    if (maxPop == null) {
      return `The forecast for ${dest} (${range}) doesn't include rain chances, so I can't answer that reliably.${partialNote}`;
    }
    if (maxPop >= 60) {
      return `Yes — rain is likely during your trip to ${dest}. The highest chance is ${Math.round(maxPop)}% on ${wettest.date} (${wettest.condition}). Pack an umbrella or a rain jacket.${partialNote}`;
    }
    if (maxPop >= 30) {
      return `There's some chance of rain in ${dest}: up to ${Math.round(maxPop)}% on ${wettest.date} (${wettest.condition}), and lower on the other days. A compact umbrella is a sensible precaution.${partialNote}`;
    }
    return `Rain is unlikely in ${dest} during your trip — the highest rain chance on any day is only ${Math.round(maxPop)}%, and most days look dry. You can probably leave the umbrella behind.${partialNote}`;
  }
  if (/jacket|coat|warm cloth|cold|chilly|freezing|sweater|hoodie|layer/.test(lower)) {
    if (minTemp <= 8) {
      return `Yes, definitely take a warm jacket for ${dest} — temperatures drop to ${minTemp}°C during your trip (${range}), even though days can reach ${maxTemp}°C.${partialNote}`;
    }
    if (minTemp <= 14) {
      return `Yes, take a jacket for ${dest} — lows are around ${minTemp}°C, so mornings and evenings will feel chilly, even with days up to ${maxTemp}°C.${partialNote}`;
    }
    if (minTemp <= 19) {
      return `A light jacket or an extra layer for the evenings should be enough for ${dest} — it only dips to about ${minTemp}°C, with days up to ${maxTemp}°C. No need for heavy winter wear.${partialNote}`;
    }
    return `You most likely won't need a jacket in ${dest} — even the coolest point of your trip is ${minTemp}°C, with days up to ${maxTemp}°C. Light clothing should be comfortable.${partialNote}`;
  }
  if (/temperature|how hot|how cold|degrees|warm will|weather/.test(lower)) {
    const conditions = [...new Set(days.map((d: any) => String(d.condition).toLowerCase()))].slice(0, 3).join(', ');
    return `For ${dest} during your trip (${range}): expect ${conditions}, with temperatures between ${minTemp}°C and ${maxTemp}°C${maxPop != null ? ` and rain chances up to ${Math.round(maxPop)}%` : ''}.${partialNote}`;
  }
  const conditions = [...new Set(days.map((d: any) => String(d.condition).toLowerCase()))].slice(0, 3).join(', ');
  return `Here's the forecast for ${dest} (${range}): ${conditions}, ${minTemp}°C to ${maxTemp}°C${maxPop != null ? `, rain chances up to ${Math.round(maxPop)}%` : ''}.${partialNote}`;
}

function chatGuessCategoryAndWeight(rawName: string): { category: string; weight: number } {
  if (/shirt|pant|sock|dress|jacket|sweater|coat|jeans|hoodie|trouser|t-shirt/i.test(rawName)) return { category: '👕 Clothes', weight: 0.3 };
  if (/soap|shampoo|brush|paste|lotion|sunscreen|cream|perfume|deodorant|toiletry/i.test(rawName)) return { category: '🧴 Toiletries', weight: 0.15 };
  if (/charger|cable|battery|phone|camera|laptop|adapter|headphone|power bank/i.test(rawName)) return { category: '🔌 Electronics', weight: 0.2 };
  if (/passport|ticket|visa|id|license|card|document/i.test(rawName)) return { category: '📄 Documents', weight: 0.05 };
  if (/shoe|sandal|boot|slipper|sneaker|footwear/i.test(rawName)) return { category: '👟 Footwear', weight: 0.7 };
  if (/umbrella|raincoat|poncho/i.test(rawName)) return { category: 'Other Essentials', weight: 0.35 };
  return { category: 'Other Essentials', weight: 0.25 };
}

// Deterministic fallback (no Gemini key, or Gemini error). It runs the SAME
// validated tools, so its security properties are identical; it just matches
// a smaller set of phrasings and asks for clarification more often.
async function fallbackToolChatImpl(
  message: string,
  ctx: ChatToolContext
): Promise<{ reply: string; dataChanged: boolean }> {
  const lower = message.toLowerCase().trim();
  const tool = (toolName: string, args: Record<string, any> = {}) => executeChatTool(ctx, toolName, args);
  const noTrip = async (): Promise<string> => {
    const mine = await tool('get_my_trips');
    const trips = (mine.result.trips as any[]) ?? [];
    if (!trips.length) return 'You have no trips yet. Create one first, then I can help with its packing list and weather.';
    const names = trips.map(t => `${t.destination} (${t.start_date} to ${t.end_date})`).join('; ');
    return `Which trip do you mean? Open it in the app, or tell me which: ${names}.`;
  };
  const surfaceError = async (result: Record<string, any>): Promise<string> => {
    if (result.clarification_needed && Array.isArray(result.candidates)) {
      return `${result.error} Options: ${result.candidates.map((c: any) => c.name).join(', ')}.`;
    }
    if (result.clarification_needed) return noTrip();
    return String(result.error ?? 'Something went wrong with that request.');
  };

  // Confirmed removal: "yes, remove the charger" / "confirm remove charger".
  const confirmRemove = lower.match(/^(?:yes|yeah|confirm|confirmed|ok|go ahead)[,.]?\s+(?:please\s+)?(?:remove|delete)\s+(?:the\s+|an?\s+)?(.+)$/i);
  if (confirmRemove?.[1]) {
    const out = await tool('remove_packing_item', { item_name: confirmRemove[1].trim(), confirm: true });
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    return { reply: `✓ Removed ${(out.result.removed as any)?.name} from your packing list.`, dataChanged: true };
  }
  // Removal request: the tool refuses to delete without confirmation.
  const removeMatch = lower.match(/^(?:remove|delete|take out|leave behind)\s+(?:the\s+|an?\s+)?(.+)$/i);
  if (removeMatch?.[1]) {
    const out = await tool('remove_packing_item', { item_name: removeMatch[1].trim() });
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    if (out.result.requires_confirmation) {
      const item = out.result.item as any;
      return { reply: `Remove "${item.name}" from your packing list? Reply "Yes, remove ${item.name}" to confirm.`, dataChanged: false };
    }
    return { reply: 'Done.', dataChanged: out.dataChanged ?? false };
  }
  // Destination change.
  const destMatch = message.match(/(?:change|update|set|move)(?:\s+my)?\s+trip(?:'s)?\s+destination\s+to\s+(.+?)\.?$/i)
    ?? message.match(/destination\s+to\s+(.+?)\.?$/i);
  if (destMatch?.[1]) {
    const out = await tool('update_trip_details', { destination: destMatch[1].trim() });
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const updated = out.result.updated_trip as any;
    return { reply: `✓ Destination changed to ${updated.destination}. Your weather and trip details now use the new location.`, dataChanged: true };
  }
  // Add an item.
  const cleaned = lower
    .replace(/\s+to\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .replace(/\s+from\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .trim();
  const addMatch = cleaned.match(/^(?:add|pack|include|put)\s+(?:an?\s+|some\s+)?(.+)$/i);
  if (addMatch?.[1] && !lower.includes('should i') && !lower.includes('what should') && !lower.includes('why')) {
    const rawName = addMatch[1].replace(/^(an?|the|some|my)\s+/i, '').trim();
    const itemName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    const { category, weight } = chatGuessCategoryAndWeight(rawName);
    const out = await tool('add_packing_item', { item_name: itemName, category, quantity: 1, weight });
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    return { reply: `✓ Added ${itemName} to your packing list for ${(out.result as any).trip_destination}. Estimated weight: ${weight} kg.`, dataChanged: true };
  }
  // Mark packed / unpacked.
  const markMatch = lower.match(/mark\s+(?:my\s+|the\s+)?(.+?)\s+as\s+(packed|unpacked)/i);
  if (markMatch?.[1]) {
    const out = await tool('update_packing_item', { item_name: markMatch[1].trim(), packed: markMatch[2] === 'packed' });
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    return { reply: `✓ Marked ${(out.result.updated as any)?.name} as ${markMatch[2]}.`, dataChanged: true };
  }
  // What have I packed so far?
  if (lower.includes('what have i packed') || lower.includes('packed so far') || lower.includes('what is packed') || lower.includes("what's packed")) {
    const out = await tool('get_packing_list');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const items = (out.result.items as any[]).filter(i => i.packed);
    if (!items.length) return { reply: `Nothing is marked as packed yet for your trip to ${out.result.trip_destination}.`, dataChanged: false };
    return { reply: `Packed so far for ${out.result.trip_destination}: ${items.map(i => `${i.name} (×${i.quantity})`).join(', ')}.`, dataChanged: false };
  }
  // What is still missing / unpacked?
  if (lower.includes('missing') || lower.includes('still need') || lower.includes('not packed') || lower.includes('unpacked') || lower.includes('left to pack')) {
    const out = await tool('get_packing_list');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const items = (out.result.items as any[]).filter(i => !i.packed);
    if (!(out.result.items as any[]).length) return { reply: `Your packing list for ${out.result.trip_destination} is empty so far.`, dataChanged: false };
    if (!items.length) return { reply: `Everything on your list for ${out.result.trip_destination} is packed. 🎉`, dataChanged: false };
    return { reply: `Still to pack for ${out.result.trip_destination}: ${items.map(i => `${i.name} (×${i.quantity})`).join(', ')}.`, dataChanged: false };
  }
  // Whole packing list.
  if (lower.includes('packing list') || lower.includes('what have i got') || lower.includes("what's in my bag") || lower.includes('in my bag')) {
    const out = await tool('get_packing_list');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const items = out.result.items as any[];
    if (!items.length) return { reply: `Your packing list for ${out.result.trip_destination} is empty so far.`, dataChanged: false };
    return { reply: `Your packing list for ${out.result.trip_destination}: ${items.map(i => `${i.name} (×${i.quantity}, ${i.packed ? 'packed' : 'not packed'})`).join(', ')}. Total weight: ${out.result.total_weight_kg} kg.`, dataChanged: false };
  }
  // Weather.
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('jacket') || lower.includes('cold') || lower.includes('snow') || lower.includes('umbrella')) {
    const out = await tool('get_trip_weather');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    return { reply: chatAnswerWeatherQuestion(message, out.result, String(out.result.trip_destination ?? 'your destination')), dataChanged: false };
  }
  // Bag weight / limit.
  if (lower.includes('weight') || lower.includes('heavy') || lower.includes('overload') || lower.includes('limit')) {
    const out = await tool('get_packing_list');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const total = out.result.total_weight_kg as number;
    const limit = out.result.baggage_limit_kg as number | null;
    if (limit == null) {
      return { reply: out.result.has_flight_leg
        ? `Your bag weighs ${total} kg. Your trip includes a flight, but its baggage allowance hasn't been entered, so there's no limit to check against — I never guess an airline's allowance.`
        : `Your bag weighs ${total} kg. This trip has no flights, so no airline baggage limit applies — the weight is just for your information.`, dataChanged: false };
    }
    if (total > limit) return { reply: `Your bag weighs ${total} kg, which is ${(total - limit).toFixed(2)} kg over your ${limit} kg flight baggage limit.`, dataChanged: false };
    return { reply: `Your bag weighs ${total} kg out of your ${limit} kg flight baggage limit. You have ${(limit - total).toFixed(2)} kg remaining.`, dataChanged: false };
  }
  // My trips.
  if (lower.includes('my trips') || lower.includes('list trips') || lower.includes('what trips')) {
    const out = await tool('get_my_trips');
    const trips = (out.result.trips as any[]) ?? [];
    if (!trips.length) return { reply: 'You have no trips yet.', dataChanged: false };
    return { reply: `Your trips: ${trips.map(t => `${t.destination} (${t.start_date} to ${t.end_date})`).join('; ')}.`, dataChanged: false };
  }
  // Packing advice.
  if (lower.includes('what should i pack') || lower.includes('recommend') || lower.includes('help me pack')) {
    const out = await tool('get_trip_details');
    if (out.result.error) return { reply: await surfaceError(out.result), dataChanged: false };
    const trip = out.result.trip as any;
    return { reply: `For ${trip.destination} (${trip.transport_summary}), prioritise lightweight clothes, comfortable footwear, travel documents and device chargers. Ask me about the weather for your dates and I will use the real forecast.`, dataChanged: false };
  }
  // Default: clarify capabilities.
  if (!ctx.activeTripId) {
    const mine = await tool('get_my_trips');
    const trips = (mine.result.trips as any[]) ?? [];
    if (!trips.length) return { reply: 'I can help once you have a trip: ask me about its weather, what you have packed, or tell me to add an item.', dataChanged: false };
    return { reply: `I can help with your trips (${trips.map(t => t.destination).join(', ')}): ask about the weather, what's packed or still missing, add or remove items, or change a trip's destination or dates. Open a trip in the app and I'll use it by default.`, dataChanged: false };
  }
  const details = await tool('get_trip_details');
  const dest = (details.result.trip as any)?.destination ?? 'your trip';
  return { reply: `I can help with your trip to ${dest}: ask about the weather, what's packed or still missing, say "add a phone charger", or ask me to change the destination or dates.`, dataChanged: false };
}

// Transport helpers for chat context. Baggage limits apply only to plane legs.
function chatTransportLegs(trip: any): any[] {
  return Array.isArray(trip?.transport_legs) ? trip.transport_legs : [];
}
function chatHasPlaneLeg(trip: any): boolean {
  if (chatTransportLegs(trip).length) {
    return chatTransportLegs(trip).some((leg: any) => leg.transport_type === 'Plane' || leg.transport_type === 'Flight');
  }
  return trip?.travel_mode === 'Flight' || trip?.travel_mode === 'Plane';
}
function chatTransportSummary(trip: any): string {
  const legs = chatTransportLegs(trip);
  if (!legs.length) return trip?.travel_mode || '';
  return legs
    .map((leg: any) => `${leg.origin || '…'} → ${leg.destination || '…'} by ${leg.transport_type === 'Flight' ? 'Plane' : leg.transport_type}`)
    .join('; ');
}

// Chat API endpoint. Security model:
// - The caller is authenticated from the Supabase session token on EVERY
//   request; the user id comes only from that verified session.
// - The request body carries only the message, recent history, and the id of
//   the trip open in the app. That id is an untrusted hint: every tool
//   re-verifies ownership against the session user before reading or
//   writing, and all database access uses the caller's own token (RLS).
// - Writes are executed server-side by the validated tools above and the
//   client simply refreshes its state when `dataChanged` is true.
app.post('/api/chat', async (req, res) => {
  try {
    const userId = await requireAuthenticatedUser(req, res);
    if (!userId) return;
    if (!supabaseUrl || !supabasePublishableKey) {
      return res.status(503).json({ error: 'Supabase is not configured on the server.' });
    }
    const accessToken = (req.headers.authorization as string).slice('Bearer '.length);
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 2000) : '';
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }
    const rawActiveTripId = req.body?.activeTripId;
    const activeTripId = typeof rawActiveTripId === 'string' && CHAT_UUID_RE.test(rawActiveTripId)
      ? rawActiveTripId
      : null;
    const history = Array.isArray(req.body?.history)
      ? req.body.history.slice(-6)
          .map((h: any) => ({
            role: h?.role === 'assistant' ? 'assistant' : 'user',
            text: String(h?.content ?? h?.text ?? '').slice(0, 1000),
          }))
          .filter((h: any) => h.text)
      : [];
    const ctx: ChatToolContext = {
      userId,
      activeTripId,
      db: createSupabaseChatDb(accessToken, supabaseUrl, supabasePublishableKey),
      geocodePlace: resolvePlaceByName,
      fetchWeather: async (trip: any) => {
        const result = await getTripWeather({
          latitude: trip.latitude ?? null,
          longitude: trip.longitude ?? null,
          timezone: trip.timezone ?? null,
          locationName: trip.destination,
          destination: trip.destination,
          startDate: trip.start_date,
          endDate: trip.end_date,
        });
        return result.payload;
      },
    };
    if (ai) {
      try {
        const models = [...new Set([process.env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean))] as string[];
        const out = await runGeminiToolChat(ai, models, message, history, ctx, 25000);
        return res.json(out);
      } catch (error) {
        console.error('Gemini tool chat failed; using fallback:', error instanceof Error ? error.message : error);
      }
    }
    const out = await fallbackToolChat(message, ctx);
    return res.json(out);
  } catch (error) {
    console.error('Chat endpoint error:', error);
    return res.status(500).json({
      error: 'Failed to process chat message.',
      reply: 'I am having trouble connecting to the travel assistant right now. Please try again shortly.',
    });
  }
});

// ---------------------------------------------------------------------------
// Weather: real date-specific forecasts from Open-Meteo (no API key needed).
//
// This logic is intentionally duplicated in `api/weather.ts`: Vercel
// functions in this project are self-contained (see the "Fix Vercel API
// function bundling" change), so the two copies must be kept in step.
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
// ---------------------------------------------------------------------------

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

// Weather API endpoint
app.get('/api/weather', async (req, res) => {
  const queryValue = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  const result = await getTripWeather({
    latitude: queryValue(req.query.latitude),
    longitude: queryValue(req.query.longitude),
    timezone: queryValue(req.query.timezone),
    locationName: queryValue(req.query.location),
    destination: queryValue(req.query.destination),
    startDate: queryValue(req.query.start_date),
    endDate: queryValue(req.query.end_date),
  });
  res.status(result.httpStatus).json(result.payload);
});

// Development vs Production serving
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, host: '0.0.0.0', port },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`BagBuddy full-stack server running on http://0.0.0.0:${port}`);
  });
}

// This is the local Express/Vite entrypoint. Vercel uses standalone handlers
// in api/ and never imports this long-running server.
if (!process.env.VERCEL) {
  void startServer();
}

export default app;

// Exported for the security/behaviour test suite; the HTTP handlers above
// remain the only production entry points.
export { executeChatTool, fallbackToolChat, runGeminiToolChat };
