import { Redis } from '@upstash/redis';
import { TwitterApi } from 'twitter-api-v2';
import { Resend } from 'resend';

function formatTweet(synthesis, hukamnama) {
  const g = hukamnama?.date?.gregorian;
  const dateStr = (g?.month && g?.date) ? `${g.month} ${g.date}` : '';
  const header = dateStr ? `Hukamnama Essence — ${dateStr}` : 'Hukamnama Essence';
  return `${header}\n\n${synthesis}\n\nAI-generated. Not a scholarly interpretation.\n\nRead the Hukamnama at www.gurudahukam.com`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatEmailHtml(synthesis, hukamnama, email, unsubToken, protocol, host) {
  const g = hukamnama?.date?.gregorian;
  const dateStr = (g?.month && g?.date) ? `${g.month} ${g.date}, ${g.year}` : '';
  const unsubUrl = `${protocol}://${host}/api/unsubscribe?email=${encodeURIComponent(email)}&token=${unsubToken}`;
  return `
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Sans+Gurmukhi:wght@300&display=swap" rel="stylesheet"/>
    <div style="font-family:'EB Garamond',Georgia,serif;max-width:520px;margin:0 auto;color:#1C1410;background:#F8F6F1;padding:2.5rem 2.5rem 2rem;border-radius:2px">
      <div style="text-align:center;margin-bottom:1.6rem">
        <div style="font-family:'Noto Sans Gurmukhi',sans-serif;font-size:2.2rem;color:#A84E06;line-height:1;margin-bottom:0.6rem">ੴ</div>
        <p style="font-family:'EB Garamond',Georgia,serif;font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(28,20,16,0.5);margin:0">Hukamnama Essence</p>
        <p style="font-family:'EB Garamond',Georgia,serif;font-size:0.78rem;color:rgba(28,20,16,0.4);margin:0.25rem 0 0">${dateStr}</p>
      </div>
      <div style="border-top:1px solid rgba(28,20,16,0.08);border-bottom:1px solid rgba(28,20,16,0.08);padding:1.5rem 0;text-align:center">
        <p style="font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:400;font-size:1.25rem;line-height:1.7;color:#1C1410;margin:0">${escHtml(synthesis)}</p>
      </div>
      <p style="text-align:center;margin-top:1.6rem;font-size:0.7rem;letter-spacing:0.02em;color:rgba(28,20,16,0.4)">AI-generated. Not a scholarly interpretation.</p>
      <p style="text-align:center;margin-top:0.9rem;font-size:0.78rem;color:rgba(28,20,16,0.55)">Read the Hukamnama at <a href="${protocol}://${host}" style="color:#A84E06">www.gurudahukam.com</a></p>
      <p style="text-align:center;margin-top:1.3rem;font-size:0.7rem;letter-spacing:0.02em;color:rgba(28,20,16,0.4)"><a href="${unsubUrl}" style="color:rgba(28,20,16,0.4)">Unsubscribe</a></p>
    </div>`;
}

// Sends the daily digest once per IST day, gated on its own Redis flag — mirrors
// postToXIfNeeded so a failed first attempt gets retried on this cron's second run.
async function sendEmailDigestIfNeeded({ redis, year, month, day, synthesis, hukamnama, protocol, host, log }) {
  const sentKey = `email:sent:${year}-${month}-${day}`;
  const alreadySent = await redis.get(sentKey);
  if (alreadySent) {
    log.push('Email: already sent today — skipping');
    return;
  }
  const subscribers = await redis.hgetall('email:subscribers');
  const emails = Object.keys(subscribers || {});
  if (!emails.length) {
    log.push('Email: no subscribers');
    return;
  }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const from = process.env.RESEND_FROM_EMAIL || 'Hukamnama Essence <essence@gurudahukam.com>';
    const replyTo = process.env.RESEND_REPLY_TO || 'gurpratap.thiara@gmail.com';
    const g = hukamnama?.date?.gregorian;
    const subject = (g?.month && g?.date) ? `Hukamnama Essence — ${g.month} ${g.date}` : 'Hukamnama Essence';
    const batch = emails.map(email => ({
      from,
      replyTo,
      to: email,
      subject,
      html: formatEmailHtml(synthesis, hukamnama, email, subscribers[email], protocol, host),
    }));
    // Resend batch endpoint caps at 100 emails per call
    for (let i = 0; i < batch.length; i += 100) {
      await resend.batch.send(batch.slice(i, i + 100));
    }
    await redis.set(sentKey, { count: emails.length, sentAt: new Date().toISOString() });
    log.push(`Email: sent to ${emails.length} subscriber(s)`);
  } catch (err) {
    log.push(`Email: send failed — ${err.message}`);
    console.error('[warm][email]', err.message);
  }
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

// Persists every run (success or failure) to a capped Redis list so it survives
// past Vercel's own function-log retention window — needed to debug cron runs
// after the fact, since Vercel only keeps raw logs for a short time.
async function persistRun({ redis, ok, log }) {
  try {
    await redis.lpush('warm:runs', JSON.stringify({ at: new Date().toISOString(), ok, log }));
    await redis.ltrim('warm:runs', 0, 49);
  } catch (err) {
    console.error('[warm][persistRun]', err.message);
  }
}

export default async function handler(req, res) {
  const log = [];
  let redis;
  try {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    const year  = ist.getUTCFullYear();
    const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day   = String(ist.getUTCDate()).padStart(2, '0');
    const key   = `hukamnama:${year}-${month}-${day}`;
    log.push(`IST date: ${year}-${month}-${day}`);

    redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    const host = req.headers.host || 'www.gurudahukam.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';

    // If cache already exists for today, skip the expensive regeneration — but this
    // cron runs twice a day, so still check whether today's X post/email still needs
    // to happen (covers a failed first attempt getting a second try at the next run).
    const existing = await redis.get(key);
    if (existing && !req.query.force) {
      log.push('Cache already fresh — skipping regeneration');
      await postToXIfNeeded({ redis, year, month, day, synthesis: existing.synthesis, hukamnama: existing.hukamnama, log });
      await sendEmailDigestIfNeeded({ redis, year, month, day, synthesis: existing.synthesis, hukamnama: existing.hukamnama, protocol, host, log });
      console.log('[warm]', log.join(' | '));
      await persistRun({ redis, ok: true, log });
      return res.json({ ok: true, skipped: true, log });
    }

    await redis.del(key);
    log.push('Cache cleared');

    const url = `${protocol}://${host}/api/synthesis`;
    log.push(`Calling ${url}`);

    const synthRes = await fetch(url);
    const synthData = await synthRes.json();

    if (synthData.error) {
      log.push(`Synthesis error: ${synthData.error}`);
      console.error('[warm]', log.join(' | '));
      await persistRun({ redis, ok: false, log });
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
      log.push('Synthesis is stale (GPT review failed or generation error) — not posting to X or email');
    } else {
      await postToXIfNeeded({ redis, year, month, day, synthesis: synthData.synthesis, hukamnama: synthData.hukamnama, log });
      await sendEmailDigestIfNeeded({ redis, year, month, day, synthesis: synthData.synthesis, hukamnama: synthData.hukamnama, protocol, host, log });
    }

    console.log('[warm]', log.join(' | '));
    await persistRun({ redis, ok: true, log });
    res.json({ ok: true, log });

  } catch (err) {
    log.push(`Exception: ${err.message}`);
    console.error('[warm]', log.join(' | '));
    if (redis) await persistRun({ redis, ok: false, log });
    res.status(500).json({ ok: false, log, error: err.message });
  }
}
