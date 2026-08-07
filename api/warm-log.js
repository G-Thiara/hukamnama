import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const entries = await redis.lrange('warm:runs', 0, 49);
    const runs = entries.map(e => (typeof e === 'string' ? JSON.parse(e) : e));

    res.json({ count: runs.length, runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
