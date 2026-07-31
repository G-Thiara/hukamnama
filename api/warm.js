import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  try {
    // Clear today's cache so synthesis is regenerated fresh
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    const year  = ist.getUTCFullYear();
    const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day   = String(ist.getUTCDate()).padStart(2, '0');
    const key   = `hukamnama:${year}-${month}-${day}`;

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
    await redis.del(key);

    const host = req.headers.host || 'www.gurudahukam.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    await fetch(`${protocol}://${host}/api/synthesis`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
