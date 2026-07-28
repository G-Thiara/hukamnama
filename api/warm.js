export default async function handler(req, res) {
  try {
    const host = req.headers.host || 'www.gurudahukam.com';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    await fetch(`${protocol}://${host}/api/synthesis`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
