import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Redis } from '@upstash/redis';

const SYNTHESIS_PROMPT = (translations, writer, raag) =>
  `Today's Hukamnama is from Sri Guru Granth Sahib Ji${writer ? `, authored by ${writer}` : ''}${raag ? ` in ${raag}` : ''}.

Here are the English translations of the verses:
${translations}

Write exactly 2 sentences — no more, no less. No headings, no markdown, no bullet points — plain text only. Synthesize the core message of this Hukamnama for someone with no or only cursory knowledge of Sikhism or Gurbani. Follow these rules strictly:
- Synthesize across the whole shabad, not any single line
- If the shabad has an arc — a movement from one state to another — capture that journey, not just the conclusion
- Be true to the spirit of the meaning — not a literal translation, not an inference, but the essence of what the shabad is pointing to
- Pull specific details from the text where they land the meaning — don't stay at a high level if a precise detail makes it clearer
- Always name the author, but how depends on the nature of the shabad: if the shabad is written in first person and the voice is personal (e.g. Bhagat Ravidas, Bhagat Kabir), name them prominently as the subject — "Bhagat Ravidas cries out..."; if the shabad is a teaching pointing outward (e.g. the Gurus), weave the name in naturally — "Guru Amardas says..."
- Easy to understand for someone with little context — explain any Sikh terms in plain everyday language
- Do not take creative license or add meaning that isn't there
- Each sentence carries one idea and is easy to read without re-reading
- Speak in present tense, directly to the reader`;

const REVIEW_PROMPT = (translations, synthesis) =>
  `A synthesis was written for today's Hukamnama. Your job is to review it strictly.

The verse translations:
${translations}

The synthesis:
"${synthesis}"

Check it against these criteria:
1. Does it synthesize the whole shabad, not just one line?
2. Is it true to the spirit of the meaning — not a literal translation, not an inference, but the essence of what the shabad is pointing to?
3. Is it easy to understand for someone with little or no knowledge of Sikhism — are Sikh terms explained in plain language?
4. Does it avoid creative license or adding meaning that isn't in the text?
5. Is each sentence simple — one idea, readable without re-reading?

Reply with PASS if it meets all criteria, or FAIL: <specific reason> if it does not. Nothing else.`;

const GPT_REVIEW_PROMPT = (translations, writer, raag, synthesis) =>
  `You are an independent reviewer checking a short AI-generated summary ("synthesis") of today's Hukamnama — a passage randomly opened from the Sikh scripture Sri Guru Granth Sahib Ji — before it is published to a public website and WhatsApp channel. Because this touches religious scripture, doctrinal accuracy and respectfulness matter as much as clarity.

Source: Sri Guru Granth Sahib Ji${writer ? `, authored by ${writer}` : ''}${raag ? ` in ${raag}` : ''}

English translation of the verses:
${translations}

Generated synthesis:
"${synthesis}"

Evaluate the synthesis strictly against these criteria:
1. Faithfulness — synthesizes the whole shabad, not just one line
2. Spirit over literalism — captures the essence without being a flat literal translation, and without inventing meaning that isn't in the text
3. Doctrinal accuracy — does not misstate or misattribute any teaching in a way a knowledgeable Sikh reader would consider wrong
4. Respectful, neutral tone — does not editorialize, take a denominational stance, or trivialize the content
5. Clarity — understandable to someone with no background in Sikhism, with Sikh terms explained in plain language

Respond with ONLY a JSON object, no other text, in this exact shape:
{"verdict": "PASS" or "FAIL", "doctrinal_concerns": [array of specific strings, empty if none], "stylistic_concerns": [array of specific strings, empty if none], "summary": "one sentence overall judgment"}

FAIL only for real, specific concerns tied to the criteria above — do not fail on vague unease.`;

async function reviewWithGPT({ translations, writer, raag, synthesis }) {
  const openai = new OpenAI();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1',
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: GPT_REVIEW_PROMPT(translations, writer, raag, synthesis) }],
  });
  return JSON.parse(completion.choices[0].message.content);
}

function getISTDate() {
  const now = new Date();
  const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
  const ist = new Date(istMs);
  const year  = ist.getUTCFullYear();
  const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const day   = String(ist.getUTCDate()).padStart(2, '0');
  return { year, month, day, key: `hukamnama:${year}-${month}-${day}` };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const { year, month, day, key } = getISTDate();

    const redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });

    // Return cached response if available
    const cached = await redis.get(key);
    if (cached) {
      return res.json(cached);
    }

    // Fetch hukamnama using /today — GurbaniNow serves based on their IST clock
    const hukamRes = await fetch('https://api.gurbaninow.com/v2/hukamnama/today');
    const hukamData = await hukamRes.json();
    const stale = false;

    const lines = (hukamData?.hukamnama || []).map(item => item.line || item);
    if (!lines.length) throw new Error('No hukamnama lines returned from GurbaniNow');

    // GurbaniNow's /today endpoint occasionally lags — still serving an older
    // Hukamnama after our IST clock has already rolled to the next day. Caching
    // that would publish stale content under today's date. Rather than requiring
    // an exact match to today (which would permanently reject content that's
    // still behind once our clock moves past it — never recovering, no matter
    // how long the lag), only require that it be newer than whatever we last
    // had. That guarantees any lag only delays a day's reading, never loses it.
    const g = hukamData?.date?.gregorian;
    const fetchedDateNum = g?.year && g?.monthno && g?.date ? Date.UTC(g.year, g.monthno - 1, g.date) : null;
    const latest = await redis.get('hukamnama:latest');
    const lg = latest?.hukamnama?.date?.gregorian;
    const latestDateNum = lg?.year && lg?.monthno && lg?.date ? Date.UTC(lg.year, lg.monthno - 1, lg.date) : -Infinity;
    if (fetchedDateNum === null || fetchedDateNum <= latestDateNum) {
      throw new Error(`Upstream not showing new content yet: got ${g?.year}-${g?.monthno}-${g?.date}, already have ${lg?.year}-${lg?.monthno}-${lg?.date}`);
    }

    const translations = lines
      .map(l => l?.translation?.english?.default || '')
      .filter(t => t && t.length > 20 && !/^(Salok|Pause|Pauree|Third Mehl|First Mehl|Fifth Mehl)/i.test(t))
      .join('\n');

    const writer = hukamData.hukamnamainfo?.writer?.english || '';
    const raag   = hukamData.hukamnamainfo?.raag?.english   || '';

    const client = new Anthropic();
    let synthesis = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 180,
        messages: [{ role: 'user', content: SYNTHESIS_PROMPT(translations, writer, raag) }],
      });
      const candidate = msg.content[0].text
        .replace(/^#+\s+.*/gm, '')
        .replace(/\*\*/g, '')
        .replace(/\n+/g, ' ')
        .trim();

      const review = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: REVIEW_PROMPT(translations, candidate) }],
      });
      const verdict = review.content[0].text.trim();
      console.log(`Attempt ${attempt}: ${verdict}`);

      if (verdict.startsWith('PASS') || attempt === 3) {
        synthesis = candidate;
        break;
      }
    }

    const data = { synthesis, hukamnama: hukamData, stale };

    // Independent second-model check (GPT, not Claude) BEFORE caching/publishing.
    // A genuine FAIL blocks this synthesis from being cached — the outer catch below
    // will serve yesterday's stale content instead. A checker ERROR (OpenAI unreachable,
    // bad JSON, etc.) fails open and publishes anyway — an infra hiccup on the checker
    // isn't a content problem, and Claude's own self-review above is still the baseline.
    // Either way the verdict is stored permanently for later review via /api/reviews.
    const reviewKey = `hukamnama:review:${year}-${month}-${day}`;
    try {
      const review = await reviewWithGPT({ translations, writer, raag, synthesis });
      review.checkedAt = new Date().toISOString();
      review.model = 'gpt-4.1';
      await redis.set(reviewKey, review);

      if (review.verdict === 'FAIL') {
        console.error(`[gpt-review] FAIL for ${year}-${month}-${day} — blocking publish:`, JSON.stringify(review));
        throw new Error(`GPT review failed: ${review.summary || 'see /api/reviews'}`);
      }
    } catch (reviewErr) {
      if (reviewErr.message?.startsWith('GPT review failed')) throw reviewErr;
      console.error('[gpt-review] error (failing open):', reviewErr.message);
      await redis.set(reviewKey, {
        verdict: 'ERROR',
        error: reviewErr.message,
        checkedAt: new Date().toISOString(),
      });
    }

    // Cache for 26 hours (covers the full IST day with buffer)
    await redis.set(key, data, { ex: 26 * 60 * 60 });
    // Always keep a latest key as fallback
    await redis.set('hukamnama:latest', data, { ex: 48 * 60 * 60 });

    res.json(data);

  } catch (err) {
    console.error(err.message);
    // Try returning yesterday's cached data before giving up
    try {
      const redis = new Redis({
        url: process.env.KV_REST_API_URL,
        token: process.env.KV_REST_API_TOKEN,
      });
      const latest = await redis.get('hukamnama:latest');
      if (latest) return res.json({ ...latest, stale: true });
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
}
