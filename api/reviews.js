import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const { date } = req.query;

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Provide a date in YYYY-MM-DD format, e.g. /api/reviews?date=2026-08-06' });
      }
      const review = await redis.get(`hukamnama:review:${date}`);
      if (!review) return res.status(404).json({ error: `No review found for ${date}` });
      return res.json({ date, ...review });
    }

    const keys = await redis.keys('hukamnama:review:*');
    const dates = keys.map(k => k.replace('hukamnama:review:', '')).sort().reverse();
    const reviews = await Promise.all(
      dates.map(async d => ({ date: d, ...(await redis.get(`hukamnama:review:${d}`)) }))
    );

    res.json({
      count: reviews.length,
      failCount: reviews.filter(r => r.verdict === 'FAIL').length,
      errorCount: reviews.filter(r => r.verdict === 'ERROR').length,
      reviews,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
