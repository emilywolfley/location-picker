
// Vercel serverless function: fetches locations + photos from Airtable
// and returns clean JSON for the location picker site.

export default async function handler(req, res) {
  const TOKEN   = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!TOKEN || !BASE_ID) {
    return res.status(500).json({
      error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID env vars on Vercel."
    });
  }

  try {
    // Fetch all records from a table, handling Airtable pagination
    async function fetchAll(table) {
      const records = [];
      let offset;
      do {
        const url = new URL(
          `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}`
        );
        url.searchParams.set("pageSize", "100");
        if (offset) url.searchParams.set("offset", offset);

        const r = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${TOKEN}` }
        });
        if (!r.ok) {
          throw new Error(`Airtable "${table}" error ${r.status}: ${await r.text()}`);
        }
        const data = await r.json();
        records.push(...data.records);
        offset = data.offset;
      } while (offset);
      return records;
    }

    const [locRecs, photoRecs] = await Promise.all([
      fetchAll("Locations"),
      fetchAll("Photos")
    ]);

    // ── Helpers ──────────────────────────────────────────────────────
    const MONTH_MAP = {
      January:1, February:2, March:3, April:4, May:5, June:6,
      July:7, August:8, September:9, October:10, November:11, December:12
    };
    const toMonths = arr => (arr || []).map(m => MONTH_MAP[m]).filter(Boolean);

    // Accept both Airtable multi-select arrays and comma-separated strings
    const toArray = val => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(s => String(s).trim()).filter(Boolean);
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    };

    // ── Map Locations ─────────────────────────────────────────────────
    const locations = locRecs
      .filter(r =>
        r.fields.Name &&
        typeof r.fields.Latitude  === "number" &&
        typeof r.fields.Longitude === "number"
      )
      .filter(r => r.fields.Active !== false)   // show if Active is true OR not set
      .map(r => ({
        id:   r.id,
        name: r.fields.Name,
        lat:  r.fields.Latitude,
        lng:  r.fields.Longitude,

        // Type
        type: (r.fields.Type || "outdoor").toLowerCase(),

        // Accessibility
        accessibility:      r.fields.Accessibility        || "",
        accessibilityLevel: r.fields["Accessibility Level"] || "",  // Easy / Moderate / Hard

        // Description / notes
        description: r.fields.Description || "",
        notes:       r.fields.Description || "",   // kept for backwards-compat

        // Best time of day
        bestTimeOfDay: r.fields["Best Time of Day"] || r.fields["Shooting Start Time"] || "",

        // Season & month data
        seasons:       toArray(r.fields["Seasons Available"]),          // ["Winter","Spring",…]
        defaultMonths: toMonths(r.fields["Default Active Months"]),     // legacy month numbers

        // Tags
        tags:       toArray(r.fields.Tags),          // scene tags: outdoor, trees, water…
        amenityTags: toArray(r.fields["Amenity Tags"]), // amenities: restrooms, wheelchair…

        // Fees / zones
        travelZone:        r.fields["Travel Zone"]         || "",
        photoPassAmount:   r.fields["Photo Pass Amount"]   || "",
        studioFeeAmount:   r.fields["Studio Fee Amount"]   || "",
        vehiclePassAmount: r.fields["Vehicle Pass Amount"] || "",

        // Google Maps link (not exposed publicly on the card, used post-booking)
        googleMapsPin: r.fields["Google Maps Pin (Private)"] || "",

        photos: []
      }));

    // ── Attach Photos ─────────────────────────────────────────────────
    const locById = Object.fromEntries(locations.map(l => [l.id, l]));

    photoRecs
      .filter(r => r.fields.Active !== false)
      .forEach(r => {
        const files = r.fields.Photo;
        if (!files || files.length === 0) return;

        const file = files[0];
        const photo = {
          id:       r.id,
          url:      file.thumbnails?.large?.url || file.url,
          thumbUrl: file.thumbnails?.small?.url  || file.url,
          months:   toMonths(r.fields["Active Months"]),
          caption:  r.fields.Caption || ""
        };

        (r.fields.Location || []).forEach(id => {
          if (locById[id]) locById[id].photos.push(photo);
        });
      });

    // Cache for 60s on Vercel's edge — edits in Airtable appear within ~1 min
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ locations });

  } catch (e) {
    console.error("locations API error:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
}
