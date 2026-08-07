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
      html: `<p>Confirm your subscription to receive the daily Hukamnama essence from gurudahukam.com:</p>
             <p><a href="${confirmUrl}">${confirmUrl}</a></p>
             <p>If you didn't request this, ignore this email.</p>`,
    });
  } catch (err) {
    console.error('[subscribe]', err.message);
    return res.status(500).json({ error: 'We couldn\'t send the confirmation email. Try again in a few minutes.' });
  }

  res.json({ ok: true, message: `Almost there. Check ${email} for a confirmation link.` });
}
