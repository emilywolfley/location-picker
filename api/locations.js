// Vercel serverless function: fetches locations + photos from Airtable
// and returns clean JSON for the location picker site.

export default async function handler(req, res) {
  const TOKEN = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;

  if (!TOKEN || !BASE_ID) {
    return res.status(500).json({
      error: "Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID env vars on Vercel."
    });
  }

  try {
    // Fetch all records from a table, handling pagination
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
          throw new Error(
            `Airtable ${table} error ${r.status}: ${await r.text()}`
          );
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

    // Convert month names to numbers (1-12)
    const MONTH_MAP = {
      January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
      July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
    };
    const toMonths = (arr) =>
      (arr || []).map((m) => MONTH_MAP[m]).filter(Boolean);

    // Map Airtable Locations → clean shape
    const locations = locRecs
      .filter(
        (r) =>
          r.fields.Name &&
          typeof r.fields.Latitude === "number" &&
          typeof r.fields.Longitude === "number"
      )
      .filter((r) => r.fields.Active !== false) // include if Active is true OR undefined
      .map((r) => ({
        id: r.id,
        name: r.fields.Name,
        lat: r.fields.Latitude,
        lng: r.fields.Longitude,
        type: r.fields.Type || "outdoor",
        accessibility: r.fields.Accessibility || "",
        notes: r.fields.Description || "",
        defaultMonths: toMonths(r.fields["Default Active Months"]),
        photos: []
      }));

    const locById = Object.fromEntries(locations.map((l) => [l.id, l]));

    // Attach photos to their linked locations
    photoRecs
      .filter((r) => r.fields.Active !== false)
      .forEach((r) => {
        const files = r.fields.Photo;
        if (!files || files.length === 0) return;

        const file = files[0];
        const photo = {
          id: r.id,
          url: file.thumbnails?.large?.url || file.url,
          thumbUrl: file.thumbnails?.small?.url || file.url,
          months: toMonths(r.fields["Active Months"]),
          caption: r.fields.Caption || ""
        };
        const linkedIds = r.fields.Location || [];
        linkedIds.forEach((id) => {
          if (locById[id]) locById[id].photos.push(photo);
        });
      });

    // Cache for 60s on Vercel's edge — updates show within ~1 min of editing
    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );
    res.status(200).json({ locations });
  } catch (e) {
    console.error("API error:", e);
    res.status(500).json({ error: String(e.message || e) });
  }
}
