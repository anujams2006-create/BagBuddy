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

// Fallback intelligent intent parser for when API key is missing or offline
function fallbackSmartResponse(message: string, trip: any, packingList: any) {
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

  // 6. Weather advice
  if (lower.includes('weather') || lower.includes('rain') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('jacket')) {
    const dest = trip?.destination || 'your destination';
    const dates = trip?.start_date && trip?.end_date ? `from ${trip.start_date} to ${trip.end_date}` : 'during your travel dates';
    return {
      reply: `For ${dest} ${dates}, temperatures vary depending on the local season. Pack breathable base layers and at least one light warm jacket or rain shell. Would you like me to add an umbrella or light jacket to your checklist?`,
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
    const mode = trip.travel_mode;
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

    // If Gemini client is initialized, call Gemini 3.8 Flash with tools
    if (ai) {
      try {
        const systemPrompt = `You are "BagBuddy AI Travel Assistant", a friendly, knowledgeable, and practical travel and packing assistant built into the BagBuddy app.
You use the existing orange-themed BagBuddy context.

CURRENT ACTIVE TRIP CONTEXT:
${trip ? JSON.stringify({
  destination: trip.destination,
  start_date: trip.start_date,
  end_date: trip.end_date,
  travel_mode: trip.travel_mode,
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

RULES:
1. Be friendly, practical, concise by default, and accurate with numbers.
2. If the user asks to add an item (e.g., "Add an umbrella", "Pack a rain jacket"), CALL the 'add_packing_item' tool. Confirm the action warmly with the estimated weight.
3. If the user asks to remove an item (e.g., "Remove jeans", "Delete hairdryer"), CALL the 'remove_packing_item' tool.
4. If the user asks to mark an item packed or unpacked, CALL the 'toggle_packed_status' tool.
5. If the user asks about bag weight or overload, use the actual numbers from the trip context (${packingList?.total_weight || 0} kg out of ${packingList?.weight_limit || 7} kg limit).
6. For weather inquiries, give practical recommendations based on typical climate for the destination and season, but be honest that real-time minute forecasts require checking right before departure.
7. Support multi-travel modes (Flight, Train, Bus, Car, Hostel).
8. Never invent booking confirmations or airline tickets. Keep answers travel & packing focused.`;

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
    const fallback = fallbackSmartResponse(message, trip, packingList);
    res.json(fallback);
  } catch (error: any) {
    console.error('Chat endpoint error:', error);
    res.status(500).json({
      error: 'Failed to process chat message',
      reply: "I'm having trouble connecting to the travel assistant right now. Your existing packing list is safe. Please try again shortly.",
    });
  }
});

// Weather API endpoint
app.get('/api/weather', (req, res) => {
  const destination = (req.query.destination as string) || '';
  if (!destination) {
    res.status(400).json({ error: 'Destination required' });
    return;
  }

  // Provide realistic seasonal climate data for destinations
  res.json({
    destination,
    summary: `Typical seasonal weather for ${destination} features moderate temperatures with occasional light showers. Carry breathable layers and light rain protection.`,
    recommendedGear: ['Lightweight umbrella', 'Comfortable walking shoes', 'Breathable jacket'],
  });
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

// Vercel imports this Express app from api/*.ts. Local development remains a
// long-running server started by `npm run dev`.
if (!process.env.VERCEL) {
  void startServer();
}

export default app;
