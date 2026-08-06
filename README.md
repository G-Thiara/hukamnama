# gurudahukam.com

Daily Hukamnama from Sri Harmandir Sahib, Amritsar — with an AI-generated 2-sentence synthesis of the spiritual message, accessible to anyone regardless of background in Sikhism.

## Live Site
**https://www.gurudahukam.com**

## Where Everything Lives

| What | Where |
|------|-------|
| Source code | https://github.com/G-Thiara/hukamnama |
| Hosting | Vercel (project: hukamnama-mlpd) |
| Domain registrar | Namecheap → nameservers pointing to Vercel |
| Cache | Upstash Redis (connected via Vercel marketplace) |
| AI | Anthropic Claude API (Sonnet for synthesis, Haiku for review) |
| Data | GurbaniNow API (https://api.gurbaninow.com) |
| Analytics | Vercel Analytics (built-in, enabled on project) |

## Project Structure

```
/
├── index.html          # Main site (served statically)
├── api/
│   ├── synthesis.js    # Serverless function — fetches hukamnama + generates synthesis
│   ├── warm.js         # Cache-busting + regeneration endpoint (also called by cron)
│   └── debug.js        # Debug endpoint — shows what GurbaniNow is returning
├── vercel.json         # Routing + cron job config
├── package.json        # Dependencies: @anthropic-ai/sdk, @upstash/redis
├── server.js           # Local Express server (not used in production, kept for reference)
├── PROJECT_STORY.md    # Full narrative of how and why the project was built
├── CHANGELOG.md        # Version history
└── README.md           # This file
```

## Environment Variables (set in Vercel dashboard)

| Variable | What it's for |
|----------|--------------|
| `ANTHROPIC_API_KEY` | Claude API access |
| `KV_REST_API_URL` | Upstash Redis URL |
| `KV_REST_API_TOKEN` | Upstash Redis auth token |
| `KV_REST_API_READ_ONLY_TOKEN` | Upstash read-only token (auto-injected) |
| `KV_URL` | Upstash connection URL (auto-injected) |

> These are NOT in the GitHub repo. If recreating the project, set them manually in Vercel → Settings → Environment Variables.

## How It Works

1. User visits gurudahukam.com
2. Browser calls `/api/synthesis`
3. Serverless function checks Upstash Redis for today's cached data (key: `hukamnama:YYYY-MM-DD`)
4. If cached → returns instantly (~0.6s)
5. If not cached → fetches GurbaniNow, generates synthesis via Claude Sonnet, reviews via Claude Haiku, caches in Redis, returns
6. Browser renders Gurmukhi verses + transliteration + English + AI essence

## Cron Job

Runs daily at **9am IST (3:30am UTC)**. Clears today's Redis cache and regenerates the synthesis so no user ever hits the slow path.

To manually trigger a fresh synthesis:
```
curl https://www.gurudahukam.com/api/warm
```

## Deploy

Push to `main` on GitHub → Vercel auto-deploys. No manual steps needed.

```bash
git add .
git commit -m "your message"
git push
```

## Local Development

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...
node server.js
# Site at http://localhost:3000
```

Note: local server.js doesn't use Redis — uses in-memory cache only.

## Key Design Decisions

- **One API call**: `/api/synthesis` returns both the hukamnama data AND the synthesis so the browser never makes two separate calls that could get out of sync
- **Sonnet for synthesis, Haiku for review**: quality where it matters, cheap for the binary pass/fail check
- **Redis over in-memory**: serverless functions are stateless — in-memory cache resets on every cold start
- **GurbaniNow `/today` endpoint**: uses their IST clock, avoiding timezone mismatch with Vercel's US servers
- **Fallback chain**: Redis cache → GurbaniNow → yesterday's data (`hukamnama:latest`) → verses without essence
