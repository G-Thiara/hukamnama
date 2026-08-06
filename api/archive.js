import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { date } = req.query;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Provide a date in YYYY-MM-DD format, e.g. /api/archive?date=2026-08-06' });
  }

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const data = await redis.get(`archive:${date}`);
    if (!data) return res.status(404).json({ error: `No archive found for ${date}` });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
