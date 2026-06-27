// Vercel serverless function: geocodes a city + state via Nominatim.
// Running server-side lets us set a proper User-Agent, which Nominatim requires.

export default async function handler(req, res) {
  const { city, state } = req.query;

  if (!city || !state) {
    return res.status(400).json({ error: 'Missing city or state param' });
  }

  const STATE_NAMES = { UT: 'Utah', CA: 'California' };
  const stateName = STATE_NAMES[state] || state;
  const q = `${city}, ${stateName}, USA`;

  try {
    const url = 'https://nominatim.openstreetmap.org/search?' +
      new URLSearchParams({ q, format: 'json', limit: '1' });

    const r = await fetch(url, {
      headers: {
        'User-Agent': 'EmilySharon-LocationPicker/1.0 (locations.emilysharonphoto.com)',
        'Accept-Language': 'en',
      }
    });

    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    const data = await r.json();

    if (!data.length) {
      return res.status(404).json({ error: 'Not found' });
    }

    res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1 hr — cities don't move
    return res.status(200).json({
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    });
  } catch (e) {
    console.error('Geocode error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
