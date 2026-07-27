import Anthropic from '@anthropic-ai/sdk';
import express from 'express';

const app = express();
const client = new Anthropic();

const HUKAMNAMA_API = 'https://api.gurbaninow.com/v2/hukamnama/today';
const MAX_ATTEMPTS = 3;

let cache = { date: null, synthesis: null };

const SYNTHESIS_PROMPT = (translations, writer, raag) =>
  `Today's Hukamnama is from Sri Guru Granth Sahib Ji${writer ? `, authored by ${writer}` : ''}${raag ? ` in ${raag}` : ''}.

Here are the English translations of the verses:
${translations}

Write a concise 2-sentence synthesis of the core message of this Hukamnama for someone with no or only cursory knowledge of Sikhism or Gurbani. Follow these rules strictly:
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

async function fetchTranslations() {
  const res = await fetch(HUKAMNAMA_API);
  const data = await res.json();

  const lines = (data.hukamnama || []).map(item => item.line || item);
  const translations = lines
    .map(l => l?.translation?.english?.default || '')
    .filter(t => t && t.length > 20 && !/^(Salok|Pause|Pauree|Third Mehl|First Mehl|Fifth Mehl)/i.test(t))
    .join('\n');

  const writer = data.hukamnamainfo?.writer?.english || '';
  const raag   = data.hukamnamainfo?.raag?.english   || '';

  return { translations, writer, raag };
}

async function generate(translations, writer, raag) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 180,
    messages: [{ role: 'user', content: SYNTHESIS_PROMPT(translations, writer, raag) }],
  });
  return msg.content[0].text.trim();
}

async function review(translations, synthesis) {
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 100,
    messages: [{ role: 'user', content: REVIEW_PROMPT(translations, synthesis) }],
  });
  return msg.content[0].text.trim();
}

async function fetchAndSynthesize() {
  const today = new Date().toDateString();
  if (cache.date === today && cache.synthesis) return cache.synthesis;

  const { translations, writer, raag } = await fetchTranslations();

  let synthesis = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const candidate = await generate(translations, writer, raag);
    const verdict = await review(translations, candidate);
    console.log(`Attempt ${attempt}: ${verdict}`);

    if (verdict.startsWith('PASS')) {
      synthesis = candidate;
      break;
    }
    // On last attempt, use the candidate anyway
    if (attempt === MAX_ATTEMPTS) synthesis = candidate;
  }

  cache = { date: today, synthesis };
  return synthesis;
}

app.get('/api/synthesis', async (req, res) => {
  try {
    const synthesis = await fetchAndSynthesize();
    res.json({ synthesis });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.use(express.static('.'));

app.listen(3000, () => console.log('Hukamnama running at http://localhost:3000'));
