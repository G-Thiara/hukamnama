import { Redis } from '@upstash/redis';

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title, headline, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Sans+Gurmukhi:wght@300&display=swap" rel="stylesheet"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'EB Garamond',Georgia,serif;background:#F8F6F1;color:#1C1410;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:2rem}
    .card{max-width:420px}
    .ik-onkar{font-family:'Noto Sans Gurmukhi',sans-serif;font-size:2.4rem;color:#A84E06;line-height:1;margin-bottom:1rem}
    .label{font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(28,20,16,0.5);margin-bottom:1.5rem}
    h1{font-family:'Cormorant Garamond',Georgia,serif;font-weight:400;font-size:1.6rem;margin-bottom:0.8rem}
    p{font-size:0.95rem;line-height:1.6;color:rgba(28,20,16,0.7)}
    a{color:#A84E06;text-decoration:none;border-bottom:1px solid rgba(168,78,6,0.35)}
    .primary{display:inline-block;margin-top:1.6rem;font-size:0.85rem}
    .secondary-row{margin-top:0.9rem}
    .secondary{font-size:0.78rem;color:rgba(28,20,16,0.45);border-bottom:1px solid rgba(28,20,16,0.25)}
  </style></head><body><div class="card">
    <div class="ik-onkar">ੴ</div>
    <p class="label">Hukamnama Essence</p>
    <h1>${headline}</h1>
    ${body}
  </div></body></html>`;
}

export default async function handler(req, res) {
  const { email, token } = req.query;
  if (!email || !token) {
    return res.status(400).send(page('Invalid link', 'Invalid link',
      '<p>This unsubscribe link looks incomplete. Use the link from your most recent email.</p><a class="primary" href="/">Back to gurudahukam.com</a>'));
  }

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const stored = await redis.hget('email:subscribers', email);
  if (stored !== token) {
    return res.status(400).send(page('Invalid link', 'Invalid link',
      `<p>This unsubscribe link isn't valid. ${escHtml(email)} may already be unsubscribed, or the link is out of date.</p><a class="primary" href="/">Back to gurudahukam.com</a>`));
  }

  await redis.hdel('email:subscribers', email);
  const resubscribeUrl = `/?email=${encodeURIComponent(email)}`;
  res.send(page('Unsubscribed', 'Unsubscribed',
    `<p>You won't get the daily Hukamnama essence by email anymore.</p><a class="primary" href="${resubscribeUrl}">Changed your mind? Subscribe again</a><p class="secondary-row"><a class="secondary" href="/">Back to gurudahukam.com</a></p>`));
}
