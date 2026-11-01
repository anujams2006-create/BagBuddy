import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';
import { createClient } from '@supabase/supabase-js';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Request = IncomingMessage & { body?: unknown };
type Json = Record<string, unknown>;

const supabaseUrl = process.env.SUPABASE_URL;
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const authClient = supabaseUrl && supabasePublishableKey
  ? createClient(supabaseUrl, supabasePublishableKey, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
const ai = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, httpOptions: { headers: { 'User-Agent': 'bagbuddy-vercel-function' } } })
  : null;

const addPackingItemTool: FunctionDeclaration = {
  name: 'add_packing_item',
  description: 'Add an item to the current trip packing checklist.',
  parameters: { type: Type.OBJECT, properties: {
    item_name: { type: Type.STRING, description: 'Name of the item.' },
    category: { type: Type.STRING, description: 'Packing category.' },
    quantity: { type: Type.NUMBER, description: 'Quantity, defaulting to 1.' },
    weight: { type: Type.NUMBER, description: 'Estimated unit weight in kilograms.' },
  }, required: ['item_name'] },
};
const removePackingItemTool: FunctionDeclaration = {
  name: 'remove_packing_item',
  description: 'Remove an item from the current trip packing checklist.',
  parameters: { type: Type.OBJECT, properties: { item_name: { type: Type.STRING, description: 'Name of the item.' } }, required: ['item_name'] },
};
const togglePackedStatusTool: FunctionDeclaration = {
  name: 'toggle_packed_status',
  description: 'Mark an item in the current trip packing checklist packed or unpacked.',
  parameters: { type: Type.OBJECT, properties: {
    item_name: { type: Type.STRING, description: 'Name of the item.' },
    packed: { type: Type.BOOLEAN, description: 'Whether the item is packed.' },
  }, required: ['item_name', 'packed'] },
};

function sendJson(res: ServerResponse, status: number, body: Json): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function requestBody(req: Request): Json {
  if (typeof req.body === 'string') return JSON.parse(req.body) as Json;
  return req.body && typeof req.body === 'object' ? req.body as Json : {};
}

function bearerToken(req: Request): string | null {
  const value = req.headers.authorization;
  return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice('Bearer '.length) : null;
}

async function authenticatedUser(token: string): Promise<string | null> {
  if (!authClient) return null;
  const { data, error } = await authClient.auth.getUser(token);
  return error || !data.user ? null : data.user.id;
}

async function ownsTrip(token: string, tripId: string, userId: string): Promise<boolean> {
  if (!supabaseUrl || !supabasePublishableKey) return false;
  const userClient = createClient(supabaseUrl, supabasePublishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: 'Bearer ' + token } },
  });
  const { data, error } = await userClient.from('trips').select('id, user_id').eq('id', tripId).single();
  return !error && data?.user_id === userId;
}

function fallbackSmartResponse(message: string, trip: any, packingList: any): Json {
  const lower = message.toLowerCase().trim();
  const cleaned = lower
    .replace(/\s+to\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .replace(/\s+from\s+(?:my\s+|the\s+)?(?:packing\s+)?(?:checklist|list|bag)$/i, '')
    .trim();
  const addMatch = cleaned.match(/^(?:add|pack|include|put)\s+(?:an?\s+|some\s+)?(.+)$/i);
  if (addMatch?.[1] && !lower.includes('should i') && !lower.includes('what should') && !lower.includes('why')) {
    const rawName = addMatch[1].replace(/^(an?|the|some|my)\s+/i, '').trim();
    const itemName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
    let category = 'Other Essentials';
    let weight = 0.25;
    if (/shirt|pant|sock|dress|jacket|sweater|coat|jeans|hoodie|trouser|t-shirt/i.test(rawName)) {
      category = '👕 Clothes'; weight = 0.3;
    } else if (/soap|shampoo|brush|paste|lotion|sunscreen|cream|perfume|deodorant|toiletry/i.test(rawName)) {
      category = '🧴 Toiletries'; weight = 0.15;
    } else if (/charger|cable|battery|phone|camera|laptop|adapter|headphone|power bank/i.test(rawName)) {
      category = '🔌 Electronics'; weight = 0.2;
    } else if (/passport|ticket|visa|id|license|card|document/i.test(rawName)) {
      category = '📄 Documents'; weight = 0.05;
    } else if (/shoe|sandal|boot|slipper|sneaker|footwear/i.test(rawName)) {
      category = '👟 Footwear'; weight = 0.7;
    } else if (/umbrella|raincoat|poncho/i.test(rawName)) {
      weight = 0.35;
    }
    return { reply: '✓ Added ' + itemName + ' to your packing list. Estimated weight: ' + weight + ' kg.', action: { type: 'add_item', payload: { item_name: itemName, category, quantity: 1, weight } } };
  }
  const removeMatch = cleaned.match(/^(?:remove|delete|take out|leave behind)\s+(?:the\s+|an?\s+)?(.+)$/i);
  if (removeMatch?.[1]) {
    const itemName = removeMatch[1].replace(/^(an?|the|some|my)\s+/i, '').trim();
    return { reply: '✓ Removed ' + itemName + ' from your packing list.', action: { type: 'remove_item', payload: { item_name: itemName } } };
  }
  if (lower.includes('mark') && (lower.includes('packed') || lower.includes('unpacked'))) {
    const packed = !lower.includes('unpacked');
    const itemName = lower.match(/mark\s+(?:my\s+|the\s+)?([a-zA-Z0-9\s-]+?)\s+as\s+(?:packed|unpacked)/i)?.[1]?.trim() ?? 'item';
    return { reply: '✓ Marked ' + itemName + ' as ' + (packed ? 'packed.' : 'unpacked.'), action: { type: 'toggle_packed', payload: { item_name: itemName, packed } } };
  }
  if (lower.includes('weight') || lower.includes('heavy') || lower.includes('overload') || lower.includes('limit')) {
    if (!packingList) return { reply: 'You do not have an active trip selected yet. Plan or choose a trip and I will track your bag weight.' };
    if (packingList.overloaded) return { reply: 'Your bag weighs ' + packingList.total_weight + ' kg, which is ' + (packingList.total_weight - packingList.weight_limit).toFixed(2) + ' kg over your ' + packingList.weight_limit + ' kg limit.' };
    return { reply: 'Your bag weighs ' + packingList.total_weight + ' kg out of ' + packingList.weight_limit + ' kg. You have ' + packingList.remaining_weight + ' kg remaining.' };
  }
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('jacket')) {
    return { reply: 'For ' + (trip?.destination ?? 'your destination') + ', pack breathable layers and light rain protection. Check the live forecast shortly before departure.' };
  }
  if (lower.includes('missing') || lower.includes('forget') || lower.includes('forgotten') || lower.includes('what am i missing')) {
    if (!trip) return { reply: 'Select or plan a trip first and I can help check what you may be missing.' };
    return { reply: 'For your trip to ' + trip.destination + ', do not forget a power adapter, first-aid basics or prescription medicines, a portable charger, and weather-appropriate outerwear.' };
  }
  if (lower.includes('what should i pack') || lower.includes('recommend') || lower.includes('help me pack')) {
    if (!trip) return { reply: 'Tell me where you are travelling, your dates, and how you are getting there, and I will help build the right list.' };
    return { reply: 'For ' + trip.destination + ' by ' + trip.travel_mode + ', prioritize lightweight clothes, comfortable footwear, travel documents, and device chargers.' };
  }
  return { reply: 'I am here to help with your trip to ' + (trip?.destination ?? 'any destination') + '. Ask me to add or remove items, check bag weight, or get packing recommendations.' };
}

export default async function handler(req: Request, res: ServerResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    sendJson(res, 405, { error: 'Method not allowed.' });
    return;
  }
  if (!authClient) {
    sendJson(res, 503, { error: 'Supabase server authentication is not configured.' });
    return;
  }
  try {
    const token = bearerToken(req);
    if (!token) {
      sendJson(res, 401, { error: 'Authentication is required.' });
      return;
    }
    const userId = await authenticatedUser(token);
    if (!userId) {
      sendJson(res, 401, { error: 'Your session is invalid or has expired.' });
      return;
    }
    const body = requestBody(req);
    const message = body.message;
    if (typeof message !== 'string' || !message.trim()) {
      sendJson(res, 400, { error: 'Message is required.' });
      return;
    }
    const tripContext = body.tripContext as { trip?: any; packingList?: any } | undefined;
    const requestedTripId = tripContext?.trip?.id;
    if (requestedTripId && (typeof requestedTripId !== 'string' || !(await ownsTrip(token, requestedTripId, userId)))) {
      sendJson(res, 403, { error: 'You cannot use a trip that you do not own.' });
      return;
    }
    const trip = tripContext?.trip ?? null;
    const packingList = tripContext?.packingList ?? null;
    if (ai) {
      try {
        const history = Array.isArray(body.history) ? body.history.slice(-6) : [];
        const contents = history.map((entry: any) => ({
          role: entry.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: String(entry.content ?? '') }],
        }));
        contents.push({ role: 'user', parts: [{ text: message.trim() }] });
        const tripSummary = trip ? JSON.stringify({
          destination: trip.destination, start_date: trip.start_date, end_date: trip.end_date,
          travel_mode: trip.travel_mode, activities: trip.activities, weight_limit_kg: trip.weight_limit,
          total_weight_kg: packingList?.total_weight, remaining_weight_kg: packingList?.remaining_weight,
          overloaded: packingList?.overloaded,
          items_summary: packingList?.items?.slice(0, 40).map((item: any) => item.name + ' (' + item.weight + 'kg, ' + (item.packed ? 'packed' : 'unpacked') + ')'),
        }) : 'No active trip';
        const result = await Promise.race([
          ai.models.generateContent({
            model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
            contents,
            config: { systemInstruction: 'You are BagBuddy AI Travel Assistant. Be friendly, practical, concise, and travel-and-packing focused. Current trip: ' + tripSummary + '. Use tools for add, remove, and packed-status requests. Never invent bookings or tickets.', tools: [{ functionDeclarations: [addPackingItemTool, removePackingItemTool, togglePackedStatusTool] }] },
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Gemini timeout')), 4500)),
        ]) as any;
        const call = result.functionCalls?.[0];
        const args = call?.args ?? {};
        if (call?.name === 'add_packing_item') {
          sendJson(res, 200, { reply: result.text || '✓ Added ' + args.item_name + ' to your packing list.', action: { type: 'add_item', payload: { item_name: args.item_name, category: args.category || 'Other Essentials', quantity: args.quantity || 1, weight: args.weight || 0.25 } } });
          return;
        }
        if (call?.name === 'remove_packing_item') {
          sendJson(res, 200, { reply: result.text || '✓ Removed ' + args.item_name + ' from your packing list.', action: { type: 'remove_item', payload: { item_name: args.item_name } } });
          return;
        }
        if (call?.name === 'toggle_packed_status') {
          sendJson(res, 200, { reply: result.text || '✓ Updated ' + args.item_name + '.', action: { type: 'toggle_packed', payload: { item_name: args.item_name, packed: args.packed !== false } } });
          return;
        }
        sendJson(res, 200, { reply: result.text || 'I am ready to help you pack and plan your journey!' });
        return;
      } catch (error) {
        console.warn('Gemini request failed; using fallback:', error instanceof Error ? error.message : error);
      }
    }
    sendJson(res, 200, fallbackSmartResponse(message, trip, packingList));
  } catch (error) {
    console.error('Chat endpoint error:', error);
    sendJson(res, 500, { error: 'Failed to process chat message.', reply: 'I am having trouble connecting to the travel assistant right now. Please try again shortly.' });
  }
}
