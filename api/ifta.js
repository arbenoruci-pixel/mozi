// /api/ifta.js — per‑state miles (round‑trip capable) using Google Directions + Reverse Geocoding
// POST JSON body options (two modes):
// 1) Single trip:
//    { "orig":"Chicago, IL", "dest":"Lincoln, NE", "roundTrip": true, "maxSamples": 60 }
// 2) Many trips:
//    { "trips":[ {"orig":"...", "dest":"...", "roundTrip": true}, ... ], "maxSamples": 60 }
//
// Returns:
// {
//   ok: true,
//   totalMiles: 1234,
//   byState: { IL: 456, IA: 200, NE: 578 },
//   legs: [
//     { orig, dest, roundTrip, miles: 100, byState: {IL:70, IA:30} },
//     ...
//   ]
// }
//
// Notes:
// - Reads GOOGLE_MAPS_KEY from env; if missing, falls back to ../assets/config.js (CONFIG.GOOGLE_MAPS_KEY).
// - Sampling: we walk the encoded polyline and take up to maxSamples points per one‑way leg
//   (default 60; safe range 20–120). Between consecutive sampled points we accumulate distance and
//   attribute it to the state of the START sample (simple, stable, fast).
// - State detection: Google Reverse Geocoding for each sampled point; we extract
//   administrative_area_level_1 short_name (e.g., IL, IA, NE).
// - Round trip: when roundTrip=true, we add the reverse leg using the same logic.
//
// Caveats:
// - Reverse geocoding adds API calls (up to maxSamples per leg). Keep maxSamples modest for cost.
// - Precision is typically sufficient for IFTA summaries. Increase maxSamples for very long routes.
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok:false, error: "Use POST with JSON body." });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    // Resolve trips list
    let trips = [];
    if (Array.isArray(body.trips) && body.trips.length) {
      trips = body.trips;
    } else if (body.orig && body.dest) {
      trips = [{ orig: body.orig, dest: body.dest, roundTrip: !!body.roundTrip }];
    }
    if (!trips.length) {
      return res.status(400).json({ ok:false, error: "Provide {orig, dest} or trips[] in POST body." });
    }

    const maxSamples = clamp(Math.floor(body.maxSamples ?? 60), 20, 120);

    // Key: env first, then local config fallback
    let KEY = process.env.GOOGLE_MAPS_KEY;
    if (!KEY) {
      try {
        const { CONFIG } = await import("../assets/config.js");
        KEY = CONFIG?.GOOGLE_MAPS_KEY;
      } catch {}
    }
    if (!KEY) return res.status(500).json({ ok:false, error: "Missing GOOGLE_MAPS_KEY (env) or assets/config.js" });

    // Helpers
    function clamp(n, lo, hi){ return Math.max(lo, Math.min(hi, n)); }
    function haversineMeters(a, b) {
      const R = 6371000, toRad = x => x * Math.PI/180;
      const dLat = toRad(b.lat - a.lat);
      const dLng = toRad(b.lng - a.lng);
      const la1 = toRad(a.lat), la2 = toRad(b.lat);
      const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2;
      return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
    }
    function decodePolyline(str) {
      let index=0, lat=0, lng=0, coords=[];
      while (index < str.length) {
        let b, shift=0, result=0;
        do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
        lat += dlat;
        shift=0; result=0;
        do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
        lng += dlng;
        coords.push({ lat: lat*1e-5, lng: lng*1e-5 });
      }
      return coords;
    }
    function reverseArray(arr){ const a = arr.slice().reverse(); return a; }

    async function fetchDirections(orig, dest) {
      const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
      u.searchParams.set("origin", orig);
      u.searchParams.set("destination", dest);
      u.searchParams.set("key", KEY);
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error("Directions HTTP " + r.status);
      const j = await r.json();
      if (j?.status !== "OK" || !j.routes?.length) throw new Error("No route");
      const route = j.routes[0];
      // Use overview_polyline to reduce quota/latency
      const encoded = route.overview_polyline?.points;
      if (!encoded) throw new Error("No overview_polyline");
      return decodePolyline(encoded);
    }

    async function reverseGeocodeState(p) {
      const u = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      u.searchParams.set("latlng", `${p.lat},${p.lng}`);
      u.searchParams.set("key", KEY);
      const r = await fetch(u.toString());
      if (!r.ok) throw new Error("Geocode HTTP " + r.status);
      const j = await r.json();
      let state = null;
      for (const result of (j.results||[])) {
        for (const comp of (result.address_components||[])) {
          if (comp.types?.includes("administrative_area_level_1")) {
            state = comp.short_name; // e.g., IL, IA, NE
            break;
          }
        }
        if (state) break;
      }
      return state || "UNK";
    }

    async function perStateMilesOneWay(orig, dest) {
      const path = await fetchDirections(orig, dest);
      if (path.length < 2) return { miles: 0, byState: {} };

      // Choose evenly-spaced samples along the decoded line
      const step = Math.max(1, Math.floor(path.length / maxSamples));
      const samples = [];
      for (let i = 0; i < path.length; i += step) samples.push(path[i]);
      if (samples[samples.length-1] !== path[path.length-1]) samples.push(path[path.length-1]);

      // Reverse geocode sample points → states
      const states = [];
      for (const p of samples) {
        // Slight throttle to avoid hitting QPS limits in bursty cases
        // (Vercel will parallelize invocations; serial here is more quota-safe.)
        const s = await reverseGeocodeState(p).catch(()=> "UNK");
        states.push(s);
      }

      // Accumulate segment distances (attribute to starting sample's state)
      let meters = 0;
      const byStateMeters = {};
      for (let i=0; i<samples.length-1; i++) {
        const a = samples[i], b = samples[i+1];
        const seg = haversineMeters(a, b);
        meters += seg;
        const st = states[i] || "UNK";
        byStateMeters[st] = (byStateMeters[st] || 0) + seg;
      }
      const toMiles = m => m * 0.000621371;
      const byState = {};
      for (const [st, m] of Object.entries(byStateMeters)) byState[st] = Math.round(toMiles(m));

      return { miles: Math.round(toMiles(meters)), byState };
    }

    const legs = [];
    for (const t of trips) {
      const o = (t.orig||"").toString().trim();
      const d = (t.dest||"").toString().trim();
      const rt = !!t.roundTrip;
      if (!o || !d) continue;

      const leg1 = await perStateMilesOneWay(o, d);
      const legSum = { orig: o, dest: d, roundTrip: rt, miles: leg1.miles, byState: { ...leg1.byState } };

      if (rt) {
        const leg2 = await perStateMilesOneWay(d, o);
        legSum.miles += leg2.miles;
        for (const [st, mi] of Object.entries(leg2.byState)) {
          legSum.byState[st] = (legSum.byState[st] || 0) + mi;
        }
      }
      legs.push(legSum);
    }

    // Roll-up
    const byState = {};
    let totalMiles = 0;
    for (const L of legs) {
      totalMiles += L.miles;
      for (const [st, mi] of Object.entries(L.byState)) {
        byState[st] = (byState[st] || 0) + mi;
      }
    }

    return res.status(200).json({ ok:true, totalMiles: Math.round(totalMiles), byState, legs });
  } catch (err) {
    return res.status(500).json({ ok:false, error: String(err && err.message || err) });
  }
}
