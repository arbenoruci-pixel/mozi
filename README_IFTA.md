# IFTA Endpoint (API)

**Route:** `/api/ifta`  
**Method:** `POST`  
**Body:**  
```json
{
  "trips": [
    {"orig":"Chicago, IL","dest":"Lincoln, NE","date":"2025-10-01","roundTrip":true},
    {"orig":"Lincoln, NE","dest":"Chicago, IL","date":"2025-10-02"}
  ],
  "sampleMeters": 10000
}
```
**Returns:** per‑state miles (`byState`), `totalMiles`, and leg‑by‑leg breakdown.

## Requirements
- Set `GOOGLE_MAPS_KEY` in Vercel env (recommended). Fallback: `assets/config.js`.
- Add a US states GeoJSON file at: `mozi-main/assets/us-states-simplified.geo.json` (EPSG:4326).  
  - Must contain features with `properties.abbr` (like `IL`, `IA`, ...).  
  - Any simplified US states GeoJSON works. (Include DC if you need.)

## Notes
- The endpoint samples the route every ~10 km (configurable via `sampleMeters`), assigns points to states, and scales totals to the precise route length so the sum matches Google Directions distance.
- Set `roundTrip: true` if the load returns empty.
