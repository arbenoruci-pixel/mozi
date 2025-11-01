NARTA CLEAN REBUILD (A10) — 2025-11-01T23:09:11.181709Z

HOW TO DEPLOY (Vercel, "Other" framework)
1) Upload this folder as the project root.
2) Set Environment Variable:
   GOOGLE_MAPS_KEY = <your Google Maps Distance Matrix key>
3) Deploy. Vercel will serve /api/* serverless functions from the /api folder.

PAGES
- /index.html        (home tiles)
- /analyzer.html     (parse → miles → offers)
- /email.html        (email scanner placeholder)
- /forwarders.html   (forwarder search demo)
- /private.html      (PIN = 2380 default; overrides with localStorage key 'narta_pin')

ASSETS
- /assets/styles.css
- /assets/app.js
- /assets/parser.js
- /assets/analyzer.js
- /assets/which_running.js  (shows loaded scripts box)

APIs
- /api/miles         POST {pickup, delivery} → {miles}
- /api/market        POST {miles, roundTrip, customerGross?} → tiers[]

TEST EMAIL (copy into analyzer textarea)
Please reply with your carrier pay and availability.

Lane: from Chicago, IL 60632 to Bristol, IN 46507
Date/Time: Oct 30, 2025 0830
Equipment: Power Only, 40HC
All-in: $1,450 flat

NOTES
- The analyzer page shows a green "ANALYZER A9 ACTIVE" badge so you KNOW the JS is loaded.
- Offers table will render even if /api/market is down (local fallback).
