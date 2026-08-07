import { Redis } from '@upstash/redis';
import { TwitterApi } from 'twitter-api-v2';

function formatTweet(synthesis, hukamnama) {
  const g = hukamnama?.date?.gregorian;
  const dateStr = (g?.month && g?.date) ? `${g.month} ${g.date}` : '';
  const header = dateStr ? `Hukamnama Essence — ${dateStr}` : 'Hukamnama Essence';
  return `${header}\n\n${synthesis}\n\nRead today's full Hukamnama → https://www.gurudahukam.com`;
}

// Posts to X once per IST day, gated on its own Redis flag (independent of the
// synthesis cache) so this cron's second daily run can retry a failed first attempt.
async function postToXIfNeeded({ redis, year, month, day, synthesis, hukamnama, log }) {
  const postedKey = `x:posted:${year}-${month}-${day}`;
  const alreadyPosted = await redis.get(postedKey);
  if (alreadyPosted) {
    log.push('X: already posted today — skipping');
    return;
  }
  try {
    const client = new TwitterApi({
      appKey: process.env.X_API_KEY,
      appSecret: process.env.X_API_SECRET,
      accessToken: process.env.X_ACCESS_TOKEN,
      accessSecret: process.env.X_ACCESS_TOKEN_SECRET,
    });
    const text = formatTweet(synthesis, hukamnama);
    const { data } = await client.v2.tweet(text);
    await redis.set(postedKey, { tweetId: data.id, postedAt: new Date().toISOString() });
    log.push(`X: posted (tweet ${data.id})`);
  } catch (err) {
    log.push(`X: post failed — ${err.message}`);
    console.error('[warm][x]', err.message);
  }
}

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

    // If cache already exists for today, skip the expensive regeneration — but this
    // cron runs twice a day, so still check whether today's X post still needs to
    // happen (covers a failed first attempt getting a second try at the next run).
    const existing = await redis.get(key);
    if (existing && !req.query.force) {
      log.push('Cache already fresh — skipping regeneration');
      await postToXIfNeeded({ redis, year, month, day, synthesis: existing.synthesis, hukamnama: existing.hukamnama, log });
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

    if (synthData.stale) {
      log.push('Synthesis is stale (GPT review failed or generation error) — not posting to X');
    } else {
      await postToXIfNeeded({ redis, year, month, day, synthesis: synthData.synthesis, hukamnama: synthData.hukamnama, log });
    }

    console.log('[warm]', log.join(' | '));
    res.json({ ok: true, log });

  } catch (err) {
    log.push(`Exception: ${err.message}`);
    console.error('[warm]', log.join(' | '));
    res.status(500).json({ ok: false, log, error: err.message });
  }
}
