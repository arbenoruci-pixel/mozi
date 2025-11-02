NARTA CLEAN PATCH for mozi-main 28
-----------------------------------
Files in this ZIP (drop into your project root):
/assets/analyzer.js          ← updated (A10 badge shows briefly on load)
/assets/which_running.js     ← optional helper
/api/ai_contra_offer.js      ← new serverless API for AI counter-offers (heuristic for now)
README_PATCH_28.txt

HOW TO APPLY
1) Replace your existing /assets/analyzer.js with the one from this zip.
2) Add /api/ai_contra_offer.js to your /api folder (same level as miles.js).
3) (Optional) Include <script src="/assets/which_running.js"></script> in analyzer.html just before </body>.
4) Deploy to Vercel. No other changes required.

WHAT'S FIXED
• Math: Wall Street 10% on GROSS first, then profit split 80/20 (Narta/Lex).
• Round-trip miles chooser (stores one-way baseline; no extra API calls when toggled).
• Pipeline saving (localStorage 'pipeline_v2').
• AI Counter-Offers button calls /api/ai_contra_offer and renders tiers.

IDs REQUIRED ON analyzer.html
email_text, btn_parse, btn_clear
pickup, delivery, date, equipment, cntr_size, lane_type
miles, gross, roundtrip, badge_round
btn_get_miles, btn_estimate_market, btn_ai_contra
offers_card, offers_body
btn_save_pipeline, pipe_status, sel_offer_pill
preview (optional)

VERIFY LIVE
• You should see a green pill “ANALYZER A10 ACTIVE” for ~4s on load.
• If you include which_running.js you'll briefly see a floating list of loaded scripts.
