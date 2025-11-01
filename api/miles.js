export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({error:'Use POST'});
    const { pickup, delivery } = req.body || {};
    if (!pickup || !delivery) return res.status(400).json({error:'pickup & delivery required'});

    const key = process.env.GOOGLE_MAPS_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) return res.status(500).json({error:'GOOGLE_MAPS_KEY missing'});

    const params = new URLSearchParams({
      origins: pickup, destinations: delivery, units: 'imperial', key
    });
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`;

    const r = await fetch(url);
    const j = await r.json();
    const elem = j?.rows?.[0]?.elements?.[0];
    const meters = elem?.distance?.value;
    if (!meters) return res.status(400).json({error:'no distance', raw:j});
    const miles = Math.round((meters / 1609.344) * 10) / 10;
    return res.status(200).json({ miles });
  } catch (e) { return res.status(500).json({ error: String(e) }); }
}