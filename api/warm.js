import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  const log = [];
  try {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    const year  = ist.getUTCFullYear();
    const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day   = String(ist.getUTCDate()).padStart(2, '0');
    const key   = `hukamnama:${year}-${month}-${day}`;
    log.push(`IST date: ${year}-${month}-${day}`);

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    // If cache already exists for today, skip — nothing to do
    const existing = await redis.get(key);
    if (existing && !req.query.force) {
      log.push('Cache already fresh — skipping');
      console.log('[warm]', log.join(' | '));
      return res.json({ ok: true, skipped: true, log });
    }

    await redis.del(key);
    log.push('Cache cleared');

    const host = req.headers.host || 'www.gurudahukam.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const url = `${protocol}://${host}/api/synthesis`;
    log.push(`Calling ${url}`);

    const synthRes = await fetch(url);
    const synthData = await synthRes.json();

    if (synthData.error) {
      log.push(`Synthesis error: ${synthData.error}`);
      console.error('[warm]', log.join(' | '));
      return res.status(500).json({ ok: false, log, error: synthData.error });
    }

    // Store in permanent archive (no expiry)
    const archiveKey = `archive:${year}-${month}-${day}`;
    await redis.set(archiveKey, {
      date: `${year}-${month}-${day}`,
      synthesis: synthData.synthesis,
      hukamnama: synthData.hukamnama,
    });
    log.push(`Archived as ${archiveKey}`);

    log.push(`Synthesis OK — date: ${synthData.hukamnama?.date?.gregorian?.date} ${synthData.hukamnama?.date?.gregorian?.month}`);
    log.push(`Synthesis preview: ${synthData.synthesis?.slice(0, 80)}`);
    console.log('[warm]', log.join(' | '));
    res.json({ ok: true, log });

  } catch (err) {
    log.push(`Exception: ${err.message}`);
    console.error('[warm]', log.join(' | '));
    res.status(500).json({ ok: false, log, error: err.message });
  }
}
