export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const now = new Date();
    const istMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const ist = new Date(istMs);
    const year  = ist.getUTCFullYear();
    const month = String(ist.getUTCMonth() + 1).padStart(2, '0');
    const day   = String(ist.getUTCDate()).padStart(2, '0');

    const url = `https://api.gurbaninow.com/v2/hukamnama/${year}/${month}/${day}`;
    const hukamRes = await fetch(url);
    const hukamData = await hukamRes.json();
    const lines = (hukamData.hukamnama || []).map(item => item.line || item);

    res.json({ url, linesCount: lines.length, istDate: `${year}-${month}-${day}`, error: hukamData.error });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
