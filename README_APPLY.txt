
NARTA — Pipeline Patch (Option A: LocalStorage only)
===================================================

WHAT THIS PATCH CONTAINS
- analyzer.html     (adds Save→Pipeline button + link to Pipeline)
- assets/analyzer.js  (adds Select Offer + Save to Pipeline logic)
- pipeline.html     (new page to view/export saved lanes)
- assets/pipeline.js  (logic for pipeline page)

HOW TO APPLY
1) Drop ALL files into your project, keeping the same paths:
   - /analyzer.html
   - /assets/analyzer.js
   - /pipeline.html
   - /assets/pipeline.js

2) Make sure your Home (index) links to /analyzer.html and /pipeline.html, or keep your existing nav.
3) Deploy. No environment variables needed for this patch (localStorage only).

HOW IT WORKS
- After you generate offers, click "Select" on one of the rows.
- Click "Save Selected → Pipeline". Choose status from the dropdown.
- Open Pipeline to see all saved lanes. You can export JSON from there.

STORAGE
- Uses localStorage key: pipeline_v2
- Safe to clear with browser storage tools if needed.
