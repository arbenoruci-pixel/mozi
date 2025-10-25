# Smart Freight — Next Version (Broker + Intermodal)

This bundle adds:
- Email scanning (IMAP) via `/api/mail/scan`
- Intermodal-aware parsing & ranking (20/40/45ft, chassis, rail/port signals)
- Hardened, non-freezing parser & maps
- Safety watchdog + panic/safe mode
- Hidden IFTA runner page (not exposed in UI): `/hidden/ifta.html`

## Deploy (Vercel)
1) In Vercel → **Settings → Environment Variables** → Import this block:

```
GOOGLE_MAPS_KEY=YOUR_GOOGLE_KEY
NEXT_PUBLIC_GOOGLE_MAPS_KEY=YOUR_GOOGLE_KEY
IMAP_HOST=imap.yourmail.com
IMAP_USER=offers@yourdomain.com
IMAP_PASS=yourpassword
IMAP_TLS=true
IMAP_BOX=INBOX
IMAP_FROM_FILTER=@tql.com,@coyote.com,@xpo.com,@convoy.com,@uber.com
```

2) `package.json` includes `imapflow`. Vercel will auto-install on deploy.

3) After deploy, open your app normally. New controls appear as a small floating widget (bottom-right):
   - **Scan Emails** button (manual)
   - **Auto** toggle (polls `/api/mail/scan` every 5 minutes)
   You can hide the widget by clicking the "×". Bring it back with `?emails=1` in the URL or press **Shift+E**.

4) Hidden IFTA runner: open `/hidden/ifta.html` directly. This page is not linked anywhere.
   - Put your address list in `/hidden/ifta-addresses.json` (see file in this bundle for structure).

## Files changed/added
- `main.js` — hardened + email scan UI + hooks
- `assets/modules/parser.js` — non-freezing intermodal parser
- `assets/modules/map.js` — safe loader + JS/REST fallback
- `assets/modules/pricing.js` — sanitized math
- `assets/modules/safeguard.js` — safety net & guards
- `assets/modules/guard.js` — watchdog auto-reloader
- `api/mail/scan.js` — IMAP fetch → parse → rank → buckets
- `hidden/ifta.html` — hidden runner page
- `hidden/ifta.js` — placeholder script
- `hidden/ifta-addresses.json` — example data

## Notes
- The IMAP scan **does not mark mail as read**; it fetches last ~200 messages read-only.
- Ranking is heuristic (broker view). Tweak weights inside `/api/mail/scan.js` in `rankIntermodal()`.
- If Maps ever hiccups, Safe Mode prevents freezing: add `?safe=1` or use the **SAFE** pill.



## IFTA per‑state miles API

POST `/api/ifta` with JSON body:

**Single trip (round trip):**
```json
{ "orig": "Chicago, IL", "dest": "Lincoln, NE", "roundTrip": true, "maxSamples": 60 }
```

**Multiple trips:**
```json
{
  "trips": [
    {"orig":"Chicago, IL", "dest":"Lincoln, NE", "roundTrip": true},
    {"orig":"Green Bay, WI", "dest":"Chicago, IL"}
  ],
  "maxSamples": 60
}
```

**Response:**
```json
{
  "ok": true,
  "totalMiles": 1234,
  "byState": { "IL": 456, "IA": 200, "NE": 578 },
  "legs": [
    { "orig":"Chicago, IL", "dest":"Lincoln, NE", "roundTrip": true, "miles": 542, "byState": {"IL":200,"IA":120,"NE":222} }
  ]
}
```

Notes: Uses Directions overview polyline + Reverse Geocoding to attribute each sampled segment to a state (admin_area_level_1). Set `GOOGLE_MAPS_KEY` in Vercel env or in `assets/config.js`.
