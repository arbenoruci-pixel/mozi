// /api/miles.js — Vercel serverless function (Node runtime)
// Usage (GET): /api/miles?orig=Chicago, IL&dest=Louisville, KY&roundTrip=1
// Usage (POST JSON): { "orig": "...", "dest": "...", "roundTrip": 1 }
export default async function handler(req, res) {
  try {
    // Accept both GET query and POST JSON
    let { orig = "", dest = "", roundTrip = "1" } = req.query || {};
    if (req.method === "POST") {
      try {
        const data = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
        orig = data.orig ?? orig;
        dest = data.dest ?? dest;
        roundTrip = data.roundTrip ?? roundTrip;
      } catch (e) {
        // ignore parse errors, fall back to query params
      }
    }

    orig = (orig || "").toString().trim();
    dest = (dest || "").toString().trim();
    const rt = Number(roundTrip) ? 1 : 0;

    if (!orig || !dest) {
      return res.status(400).json({ ok: false, error: "Missing origin or destination." });
    }

    // Load Google key: prefer env, fallback to local config if present
    let key = process.env.GOOGLE_MAPS_KEY;
    if (!key) {
      try {
        const { CONFIG } = await import("../assets/config.js");
        key = CONFIG?.GOOGLE_MAPS_KEY;
      } catch {}
    }
    if (!key) {
      return res.status(500).json({ ok: false, error: "Missing GOOGLE_MAPS_KEY (env) or assets/config.js." });
    }

    // Helper to call Distance Matrix API
    async function callDistanceMatrix(o, d) {
      const u = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      u.searchParams.set("units", "imperial");
      u.searchParams.set("origins", o);
      u.searchParams.set("destinations", d);
      u.searchParams.set("key", key);
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error("Distance Matrix HTTP " + r.status);
      const j = await r.json();
      const el = j?.rows?.[0]?.elements?.[0];
      if (j?.status !== "OK" || !el || el.status !== "OK") {
        throw new Error("Distance Matrix error: " + (el?.status || j?.status || "UNKNOWN"));
      }
      // Google returns meters in 'value' (even if text shows miles)
      const meters = Number(el.distance?.value || 0);
      const miles = meters * 0.000621371;
      return {
        api: "distancematrix",
        origin_address: j?.origin_addresses?.[0] || o,
        destination_address: j?.destination_addresses?.[0] || d,
        oneWay: miles,
        duration_text: el.duration?.text || null
      };
    }

    // Fallback: Directions API
    async function callDirections(o, d) {
      const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
      u.searchParams.set("origin", o);
      u.searchParams.set("destination", d);
      u.searchParams.set("key", key);
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error("Directions HTTP " + r.status);
      const j = await r.json();
      if (j?.status !== "OK" || !Array.isArray(j?.routes) || j.routes.length === 0) {
        throw new Error("Directions error: " + (j?.status || "NO_ROUTES"));
      }
      const route = j.routes[0];
      let meters = 0;
      let duration_text = null;
      for (const leg of (route.legs || [])) {
        meters += Number(leg?.distance?.value || 0);
        if (!duration_text && leg?.duration?.text) duration_text = leg.duration.text;
      }
      const miles = meters * 0.000621371;
      return {
        api: "directions",
        origin_address: j?.geocoded_waypoints?.[0]?.place_id ? o : o,
        destination_address: j?.geocoded_waypoints?.[1]?.place_id ? d : d,
        oneWay: miles,
        duration_text
      };
    }

    let result;
    try {
      result = await callDistanceMatrix(orig, dest);
    } catch (e) {
      // fallback
      result = await callDirections(orig, dest);
    }

    const oneWayMiles = Math.max(0, Number(result.oneWay || 0));
    const totalMiles = rt ? oneWayMiles * 2 : oneWayMiles;

    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
    return res.status(200).json({
      ok: true,
      api: result.api,
      origin: result.origin_address,
      destination: result.destination_address,
      oneWay: Math.round(oneWayMiles),
      miles: Math.round(totalMiles),
      km: Math.round(totalMiles * 1.60934),
      duration: result.duration_text
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err && err.message || err) });
  }
}
