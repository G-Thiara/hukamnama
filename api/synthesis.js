import Anthropic from '@anthropic-ai/sdk';
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

    // Fetch hukamnama
    const hukamRes = await fetch(`https://api.gurbaninow.com/v2/hukamnama/${year}/${month}/${day}`);
    const hukamData = await hukamRes.json();

    const lines = (hukamData.hukamnama || []).map(item => item.line || item);
    if (!lines.length) throw new Error('No hukamnama lines returned from GurbaniNow');

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
        model: 'claude-haiku-4-5-20251001',
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

    const data = { synthesis, hukamnama: hukamData };

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
      if (latest) return res.json(latest);
    } catch (_) {}
    res.status(500).json({ error: err.message });
  }
}
