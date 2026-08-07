import { Redis } from '@upstash/redis';
import { Resend } from 'resend';
import crypto from 'crypto';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'That doesn\'t look like a valid email address. Check for typos (e.g. name@example.com).' });
  }

  const redis = new Redis({
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
  });

  const alreadySubscribed = await redis.hget('email:subscribers', email);
  if (alreadySubscribed) {
    return res.json({ ok: true, message: `${email} is already subscribed. No action needed.` });
  }

  const token = crypto.randomUUID();
  await redis.set(`email:pending:${token}`, email, { ex: 60 * 60 * 24 });

  const host = req.headers.host || 'www.gurudahukam.com';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const confirmUrl = `${protocol}://${host}/api/confirm?token=${token}`;

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Hukamnama Essence <essence@gurudahukam.com>',
      replyTo: process.env.RESEND_REPLY_TO || 'gurpratap.thiara@gmail.com',
      to: email,
      subject: 'Confirm your Hukamnama Essence subscription',
      html: `<link href="https://fonts.googleapis.com/css2?family=EB+Garamond:ital,wght@0,400;0,500;1,400&family=Noto+Sans+Gurmukhi:wght@300&display=swap" rel="stylesheet"/>
        <div style="font-family:'EB Garamond',Georgia,serif;max-width:480px;margin:0 auto;color:#1C1410;background:#F8F6F1;padding:2.5rem 2.5rem 2rem;text-align:center;border-radius:2px">
          <div style="font-family:'Noto Sans Gurmukhi',sans-serif;font-size:2.2rem;color:#A84E06;line-height:1;margin-bottom:0.6rem">ੴ</div>
          <p style="font-size:0.72rem;letter-spacing:0.12em;text-transform:uppercase;color:rgba(28,20,16,0.5);margin:0 0 1.5rem">Hukamnama Essence</p>
          <p style="font-size:0.95rem;line-height:1.6;color:rgba(28,20,16,0.75);margin:0 0 1.6rem">Confirm your subscription to receive the daily Hukamnama essence by email.</p>
          <a href="${confirmUrl}" style="display:inline-block;font-size:0.85rem;color:#A84E06;border-bottom:1px solid rgba(168,78,6,0.35);text-decoration:none">Confirm my subscription</a>
          <p style="margin-top:2rem;font-size:0.7rem;color:rgba(28,20,16,0.35)">If you didn't request this, ignore this email.</p>
        </div>`,
    });
  } catch (err) {
    console.error('[subscribe]', err.message);
    return res.status(500).json({ error: 'We couldn\'t send the confirmation email. Try again in a few minutes.' });
  }

  res.json({ ok: true, message: `Almost there. Check ${email} for a confirmation link.` });
}
