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

async function ownsTrip(accessToken: string, tripId: string, userId: string): Promise<boolean> {
  if (!authClient) return false;
  const userClient = createClient(supabaseUrl!, supabasePublishableKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data, error } = await userClient.from('trips').select('id, user_id').eq('id', tripId).single();
  return !error && data?.user_id === userId;
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

// Function declarations for Gemini tool calling
const addPackingItemTool: FunctionDeclaration = {
  name: 'add_packing_item',
  description: 'Add a new packing item to the user\'s current trip packing checklist.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: {
        type: Type.STRING,
        description: 'Name of the item to add (e.g. Umbrella, Raincoat, Travel Adapter).',
      },
      category: {
        type: Type.STRING,
        description: 'Category for the item: 👕 Clothes, 🧴 Toiletries, 🔌 Electronics, 📄 Documents, 👟 Footwear, Personal Care, Accessories, or Other Essentials.',
      },
      quantity: {
        type: Type.NUMBER,
        description: 'Quantity of items to pack, defaults to 1.',
      },
      weight: {
        type: Type.NUMBER,
        description: 'Estimated weight in kilograms (e.g. 0.3 for an umbrella, 0.2 for a charger, 0.1 for sunscreen).',
      },
    },
    required: ['item_name'],
  },
};

const removePackingItemTool: FunctionDeclaration = {
  name: 'remove_packing_item',
  description: 'Remove an item from the user\'s current trip packing checklist.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: {
        type: Type.STRING,
        description: 'Name of the item to remove (e.g. Jeans, Heavy Boots, Hairdryer).',
      },
    },
    required: ['item_name'],
  },
};

const togglePackedStatusTool: FunctionDeclaration = {
  name: 'toggle_packed_status',
  description: 'Mark an item as packed (true) or unpacked (false) on the packing checklist.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      item_name: {
        type: Type.STRING,
        description: 'Name of the item to mark.',
      },
      packed: {
        type: Type.BOOLEAN,
        description: 'True if packed, false if unpacked.',
      },
    },
    required: ['item_name', 'packed'],
  },
};

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

// Fallback intelligent intent parser for when API key is missing or offline
function fallbackSmartResponse(message: string, trip: any, packingList: any, weather?: any) {
  const lower = message.toLowerCase().trim();

  // Strip trailing destination or list references
  const cleanedText = lower
    .replace(/\s+to\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .replace(/\s+from\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .trim();

  // 1. Add item intent
  const addMatch = cleanedText.match(/^(?:add|pack|include|put)\s+(?:an?\s+|some\s+)?(.+)$/i);
  if (addMatch && addMatch[1] && !lower.includes('should i') && !lower.includes('what should') && !lower.includes('why')) {
    const rawName = addMatch[1].replace(/^(an?|the|some|my)\s+/i, '').trim();
    if (rawName.length > 1) {
      const titleName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      let cat = 'Other Essentials';
      let weight = 0.25;

      if (/shirt|pant|sock|dress|jacket|sweater|coat|jeans|hoodie|trouser|t-shirt/i.test(rawName)) {
        cat = '👕 Clothes';
        weight = 0.3;
      } else if (/soap|shampoo|brush|paste|lotion|sunscreen|cream|perfume|deodorant|toiletry/i.test(rawName)) {
        cat = '🧴 Toiletries';
        weight = 0.15;
      } else if (/charger|cable|battery|phone|camera|laptop|adapter|headphone|power bank/i.test(rawName)) {
        cat = '🔌 Electronics';
        weight = 0.2;
      } else if (/passport|ticket|visa|id|license|card|document/i.test(rawName)) {
        cat = '📄 Documents';
        weight = 0.05;
      } else if (/shoe|sandal|boot|slipper|sneaker|footwear/i.test(rawName)) {
        cat = '👟 Footwear';
        weight = 0.7;
      } else if (/umbrella|raincoat|poncho/i.test(rawName)) {
        cat = 'Other Essentials';
        weight = 0.35;
      }

      return {
        reply: `✓ Added ${titleName} to your packing list. Estimated weight: ${weight} kg.`,
        action: {
          type: 'add_item',
          payload: {
            item_name: titleName,
            category: cat,
            quantity: 1,
            weight,
          },
        },
      };
    }
  }

  // 2. Remove item intent
  const removeMatch = cleanedText.match(/^(?:remove|delete|take out|leave behind)\s+(?:the\s+|an?\s+)?(.+)$/i);
  if (removeMatch && removeMatch[1]) {
    const rawName = removeMatch[1].replace(/^(an?|the|some|my)\s+/i, '').trim();
    const titleName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    return {
      reply: `✓ Removed ${titleName} from your packing list and recalculated your luggage weight.`,
      action: {
        type: 'remove_item',
        payload: {
          item_name: rawName,
        },
      },
    };
  }

  // 3. Mark packed / unpacked
  if (lower.includes('mark') && (lower.includes('packed') || lower.includes('unpacked'))) {
    const isPacked = !lower.includes('unpacked');
    const itemMatch = lower.match(/mark\s+(?:my\s+|the\s+)?([a-zA-Z0-9\s-]+?)\s+as\s+(?:packed|unpacked)/i);
    const itemName = itemMatch ? itemMatch[1].trim() : 'item';
    return {
      reply: `✓ Marked ${itemName} as ${isPacked ? 'packed' : 'unpacked'}.`,
      action: {
        type: 'toggle_packed',
        payload: {
          item_name: itemName,
          packed: isPacked,
        },
      },
    };
  }

  // 4. Weight query
  if (lower.includes('weight') || lower.includes('heavy') || lower.includes('overload') || lower.includes('limit')) {
    if (!packingList) {
      return {
        reply: "You don't have an active trip selected yet. Once you plan or choose a trip, I'll track your estimated bag weight against your airline or travel limit!",
      };
    }
    const currentWeight = packingList.total_weight;
    const limit = packingList.weight_limit;
    if (limit == null) {
      return {
        reply: chatHasPlaneLeg(trip)
          ? `Your bag currently weighs ${currentWeight} kg. Your trip includes a flight, but its baggage allowance hasn't been entered, so there's no limit to check against — I never guess an airline's allowance. Add it to the flight leg and I can check your bag against it.`
          : `Your bag currently weighs ${currentWeight} kg. This trip has no flights, so no airline baggage limit applies — the weight is just for your information.`,
      };
    }
    if (packingList.overloaded) {
      const overBy = (currentWeight - limit).toFixed(2);
      return {
        reply: `Your bag currently weighs ${currentWeight} kg, which is ${overBy} kg over your ${limit} kg limit! Consider removing heavy footwear or bulky toiletries to avoid baggage fees.`,
      };
    } else {
      const remaining = packingList.remaining_weight;
      return {
        reply: `Great news! Your estimated bag weight is ${currentWeight} kg out of your ${limit} kg allowance. You have ${remaining} kg of spare capacity.`,
      };
    }
  }

  // 5. Missing / forgotten items
  if (lower.includes('missing') || lower.includes('forget') || lower.includes('forgotten') || lower.includes('what am i missing')) {
    if (!trip) {
      return {
        reply: "To check what's missing, select an upcoming trip first or click 'Plan trip' to build your customized checklist!",
      };
    }
    const dest = trip.destination || 'your destination';
    return {
      reply: `For your trip to ${dest}, make sure you haven't forgotten: 1) Universal travel power adapter, 2) First-aid basics / prescription meds, 3) Portable charger, and 4) Weather-appropriate outerwear. Would you like me to add any of these to your list?`,
    };
  }

  // 6. Weather advice — only from real Open-Meteo data passed in the context.
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('jacket')) {
    const dest = trip?.destination || 'your destination';
    if (weather?.days?.length) {
      const lines = weather.days
        .slice(0, 5)
        .map((day: any) => `${day.date}: ${day.condition}, ${day.temperature_min}–${day.temperature_max}°C${day.precipitation_probability_max != null ? `, rain chance ${Math.round(day.precipitation_probability_max)}%` : ''}`)
        .join('; ');
      const partialNote = weather.status === 'partial'
        ? ' That covers only part of your trip — a forecast is not available yet for the remaining dates.'
        : '';
      return {
        reply: `Here's the Open-Meteo forecast for ${weather.location?.name || dest}: ${lines}.${partialNote} Want me to add anything weather-related, like an umbrella or a warmer layer?`,
      };
    }
    if (weather?.status === 'too_far_future') {
      return {
        reply: `A reliable daily forecast isn't available yet for your trip to ${dest} (${trip?.start_date} to ${trip?.end_date}). Open-Meteo currently forecasts up to ${weather.horizon_end}, so check again closer to departure — I won't guess temperatures in the meantime.`,
      };
    }
    if (weather?.status === 'past') {
      return {
        reply: `That trip to ${dest} has already taken place, so there's no forecast to check for it.`,
      };
    }
    return {
      reply: `I don't have forecast data for ${dest} for those dates, so I can't give you accurate temperatures or rain chances. The weather card on your dashboard shows the forecast as soon as it's available.`,
    };
  }

  // 7. General packing suggestions
  if (lower.includes('what should i pack') || lower.includes('recommend') || lower.includes('help me pack')) {
    if (!trip) {
      return {
        reply: "I'd love to help! Tell me where you are traveling, your dates, and how you're getting there (flight, train, bus, car, or hostel), and I'll create the ideal packing list for you.",
      };
    }
    const dest = trip.destination;
    const mode = chatTransportSummary(trip) || trip.travel_mode;
    const activities = trip.activities?.join(', ') || 'sightseeing';
    return {
      reply: `For ${dest} traveling by ${mode} with ${activities}, prioritize lightweight breathable clothes, comfortable footwear, travel documents, and your device chargers. You can tell me 'Add an item' anytime and I'll put it right on your list!`,
    };
  }

  // Default friendly response
  return {
    reply: `I'm here to help with your trip to ${trip?.destination || 'any destination'}! You can ask me to add or remove items, check whether your bag is overweight, or get packing recommendations based on your travel mode and activities.`,
  };
}

// Chat API endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const userId = await requireAuthenticatedUser(req, res);
    if (!userId) return;
    const { message, tripContext, history } = req.body;

    const requestedTripId = tripContext?.trip?.id;
    if (requestedTripId) {
      const accessToken = req.header('authorization')!.slice('Bearer '.length);
      if (typeof requestedTripId !== 'string' || !(await ownsTrip(accessToken, requestedTripId, userId))) {
        res.status(403).json({ error: 'You cannot use a trip that you do not own.' });
        return;
      }
    }

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const trip = tripContext?.trip || null;
    const packingList = tripContext?.packingList || null;
    const weather = tripContext?.weather || null;

    // If Gemini client is initialized, call Gemini 3.8 Flash with tools
    if (ai) {
      try {
        const systemPrompt = `You are "BagBuddy AI Travel Assistant", a friendly, knowledgeable, and practical travel and packing assistant built into the BagBuddy app.
You use the existing orange-themed BagBuddy context.

CURRENT ACTIVE TRIP CONTEXT:
${trip ? JSON.stringify({
  destination: trip.destination,
  latitude: trip.latitude ?? null,
  longitude: trip.longitude ?? null,
  timezone: trip.timezone ?? null,
  start_date: trip.start_date,
  end_date: trip.end_date,
  travel_mode: trip.travel_mode,
  transport_legs: trip.transport_legs ?? [],
  transport_summary: chatTransportSummary(trip),
  baggage_limit_kg: packingList?.weight_limit ?? null,
  trip_type: trip.trip_type,
  profile: trip.profile,
  adults: trip.adults,
  children: trip.children,
  child_age: trip.child_age,
  bag_type: trip.bag_type,
  weight_limit_kg: trip.weight_limit,
  activities: trip.activities,
  personalization: trip.personalization,
  total_weight_kg: packingList?.total_weight,
  remaining_weight_kg: packingList?.remaining_weight,
  overloaded: packingList?.overloaded,
  items_count: packingList?.items?.length,
  items_summary: packingList?.items?.map((i: any) => `${i.name} (${i.weight}kg, ${i.packed ? 'packed' : 'unpacked'})`).slice(0, 40).join(', ')
}, null, 2) : 'No trip currently active. Ask the user if they want general travel advice or want to plan a trip.'}

WEATHER DATA (from Open-Meteo, fetched for the trip's coordinates and dates):
${weather ? JSON.stringify({
  status: weather.status,
  location: weather.location ?? null,
  timezone: weather.timezone ?? null,
  horizon_end: weather.horizon_end,
  forecast_days: Array.isArray(weather.days) ? weather.days : [],
  notes: weather.notes ?? [],
}, null, 2) : 'No weather data was provided for this trip.'}

RULES:
1. Be friendly, practical, concise by default, and accurate with numbers.
2. If the user asks to add an item (e.g., "Add an umbrella", "Pack a rain jacket"), CALL the 'add_packing_item' tool. Confirm the action warmly with the estimated weight.
3. If the user asks to remove an item (e.g., "Remove jeans", "Delete hairdryer"), CALL the 'remove_packing_item' tool.
4. If the user asks to mark an item packed or unpacked, CALL the 'toggle_packed_status' tool.
5. If the user asks about bag weight or overload, use the actual numbers from the trip context (total ${packingList?.total_weight ?? 0} kg; baggage limit ${packingList?.weight_limit == null ? 'none — no limit applies to this trip' : `${packingList.weight_limit} kg, applying to the flight legs only`}).
6. For weather inquiries, use ONLY the WEATHER DATA above. If it contains forecast_days, quote those dates, conditions, temperatures and rain chances. If forecast_days is empty (for example status "too_far_future", "past" or "location_not_found"), clearly say that a reliable forecast is not available for the trip dates yet and DO NOT invent temperatures, rain chances or conditions, and do not present current or "typical" weather as the trip-date forecast.
7. Support multi-travel modes (Flight, Train, Bus, Car, Hostel).
8. Never invent booking confirmations or airline tickets. Keep answers travel & packing focused.
9. Baggage limits apply ONLY to Plane (flight) legs, never to car, bus, train, or other legs. If baggage_limit_kg is null and the trip has flight legs, the airline allowance is unknown: say so, and suggest adding it to the flight leg. If the trip has no flight legs, say no airline baggage limit applies. Never invent an airline's baggage allowance.`;

        // Format history
        const conversationParts: any[] = [];
        if (Array.isArray(history)) {
          for (const h of history.slice(-6)) {
            conversationParts.push({
              role: h.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: h.content }],
            });
          }
        }
        conversationParts.push({
          role: 'user',
          parts: [{ text: message }],
        });

        const geminiCall = ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: conversationParts,
          config: {
            systemInstruction: systemPrompt,
            tools: [
              {
                functionDeclarations: [
                  addPackingItemTool,
                  removePackingItemTool,
                  togglePackedStatusTool,
                ],
              },
            ],
          },
        });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Gemini timeout')), 4500)
        );

        const geminiRes = await Promise.race([geminiCall, timeoutPromise]) as any;

        // Check if a tool was called
        const funcCalls = geminiRes.functionCalls;
        if (funcCalls && funcCalls.length > 0) {
          const call = funcCalls[0];
          const args: any = call.args || {};

          if (call.name === 'add_packing_item') {
            const itemName = args.item_name;
            const category = args.category || 'Other Essentials';
            const quantity = args.quantity || 1;
            const weight = args.weight || 0.25;

            res.json({
              reply: geminiRes.text || `✓ Added ${itemName} to your packing list. Estimated weight: ${weight} kg.`,
              action: {
                type: 'add_item',
                payload: {
                  item_name: itemName,
                  category,
                  quantity,
                  weight,
                },
              },
            });
            return;
          }

          if (call.name === 'remove_packing_item') {
            const itemName = args.item_name;
            res.json({
              reply: geminiRes.text || `✓ Removed ${itemName} from your packing list.`,
              action: {
                type: 'remove_item',
                payload: {
                  item_name: itemName,
                },
              },
            });
            return;
          }

          if (call.name === 'toggle_packed_status') {
            const itemName = args.item_name;
            const packed = args.packed !== false;
            res.json({
              reply: geminiRes.text || `✓ Marked ${itemName} as ${packed ? 'packed' : 'unpacked'}.`,
              action: {
                type: 'toggle_packed',
                payload: {
                  item_name: itemName,
                  packed,
                },
              },
            });
            return;
          }
        }

        const replyText = geminiRes.text || 'I am ready to help you pack and plan your journey!';
        res.json({ reply: replyText });
        return;
      } catch (geminiError: any) {
        console.warn('Gemini API call failed, using smart fallback:', geminiError?.message);
        // Fall back gracefully to smart rule-based handler
      }
    }

    // Fallback response handler
    const fallback = fallbackSmartResponse(message, trip, packingList, weather);
    res.json(fallback);
  } catch (error: any) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({
      error: 'Failed to process chat message',
      reply: "I'm having trouble connecting to the travel assistant right now. Your existing packing list is safe. Please try again shortly.",
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
