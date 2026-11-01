import type { IncomingMessage, ServerResponse } from 'node:http';

type Request = IncomingMessage & { query?: Record<string, string | string[] | undefined> };

export default function handler(req: Request, res: ServerResponse): void {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }
  const url = new URL(req.url ?? '/', 'https://bagbuddy.local');
  const destination = typeof req.query?.destination === 'string' ? req.query.destination : url.searchParams.get('destination') ?? '';
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!destination) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'Destination required.' }));
    return;
  }
  res.statusCode = 200;
  res.end(JSON.stringify({
    destination,
    summary: 'Typical seasonal weather for ' + destination + ' features moderate temperatures with occasional light showers. Carry breathable layers and light rain protection.',
    recommendedGear: ['Lightweight umbrella', 'Comfortable walking shoes', 'Breathable jacket'],
  }));
}
