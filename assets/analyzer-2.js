<<<<<<< main
/* NARTA • ANALYZER A10 (clean math + pipeline + AI stub hook)
   - Miles GET with RT confirm (stores baseline one-way)
   - Market estimate tiers
   - Correct finance: Wall 10% on GROSS first → Profit split 80/20 (Narta/Lex)
   - Local Pipeline save
   - Optional AI Counter-Offers via /api/ai_contra_offer
*/
(function(){
  const $ = (s)=>document.querySelector(s);
  const emailEl = $('#email_text');
  const btnParse = $('#btn_parse');
  const btnClear = $('#btn_clear');
  const pickupEl   = $('#pickup');
  const deliveryEl = $('#delivery');
  const dateEl     = $('#date');
  const equipEl    = $('#equipment');
  const sizeEl     = $('#cntr_size');
  const laneEl     = $('#lane_type');
  const milesEl    = $('#miles');
  const grossEl    = $('#gross');
  const roundChk   = $('#roundtrip');
  const usedBadge  = $('#badge_round');
  const btnGetMiles = $('#btn_get_miles');
  const btnEst      = $('#btn_estimate_market');
  const btnAI       = $('#btn_ai_contra');
  const offersCard  = $('#offers_card');
  const offersBody  = $('#offers_body');
  const btnSave     = $('#btn_save_pipeline');
  const selStatus   = $('#pipe_status');
  const selOfferPill= $('#sel_offer_pill');
  let selectedOffer = null;
  function round2(n){ return Math.round((Number(n)||0)*100)/100; }
  function setMilesUsed(n){ if(usedBadge) usedBadge.textContent = `Miles used: ${round2(n||0)}`; }
  btnClear?.addEventListener('click', ()=>{
    if(emailEl) emailEl.value='';
    ['pickup','delivery','date','equipment','cntr_size','lane_type','gross','miles','pickup_time'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      if(el.tagName==='SELECT') el.selectedIndex=0; else el.value='';
    });
    if (milesEl?.dataset) milesEl.dataset.oneway='';
    setMilesUsed(0);
    if(offersCard){ offersCard.style.display='none'; }
    if(offersBody){ offersBody.innerHTML=''; }
    const preview=$('#preview'); if(preview) preview.textContent='{}';
    selectedOffer = null; if(selOfferPill) selOfferPill.textContent = 'Selected: —';
  });
  btnParse?.addEventListener('click', ()=>{
    const txt = emailEl?.value || '';
    const out = (window.NARTA_PARSER||{}).extract?.(txt) || {};
    if(out.pickup) pickupEl.value = out.pickup;
    if(out.delivery) deliveryEl.value = out.delivery;
    if(out.date) dateEl.value = out.date;
    if(out.equipment) equipEl.value = out.equipment;
    if(out.size) sizeEl.value = out.size;
    if(out.lane) laneEl.value = out.lane;
    if(out.gross && !grossEl.value) grossEl.value = out.gross;
    const preview=$('#preview'); if(preview) preview.textContent = JSON.stringify(out,null,2);
  });
  btnGetMiles?.addEventListener('click', async ()=>{
    const pickup = pickupEl?.value?.trim();
    const delivery = deliveryEl?.value?.trim();
    if(!pickup || !delivery){ alert('Enter Pickup and Delivery first.'); return; }
    const isRT = window.confirm('Round trip miles?\nOK = Round trip (2×)\nCancel = One-way');
    try{
      const r = await fetch('/api/miles', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pickup, delivery })
      });
      let j; try { j = await r.json(); } catch { j={}; }
      if(!r.ok || typeof j.miles!=='number'){ alert('Miles failed. Check GOOGLE_MAPS_KEY.'); return; }
      milesEl.dataset = milesEl.dataset||{};
      milesEl.dataset.oneway = String(j.miles);
      const used = isRT ? j.miles*2 : j.miles;
      milesEl.value = round2(used);
      if(roundChk) roundChk.checked = !!isRT;
      setMilesUsed(used);
    }catch(e){ console.error(e); alert('Network error while fetching miles.'); }
  });
  function heuristicPerMile(miles, equipment, size, lane){
    let base = /ramp|port|rail/i.test(lane)? 2.6 : 2.2;
=======
/* NARTA — Analyzer Engine vA3 (robust wiring + fallback parser + RT miles + tiers + pipeline)
   - Hooks buttons by ID or visible text ("Parse", "Clear", "GET MILES", "Estimate Market", "AI Contra", "Save Selected → Pipeline")
   - Fallback parser handles typical intermodal emails (City, ST [ZIP], All-in $, 20/40/45, rail/port/door)
   - Miles: prompts Round Trip vs One-Way, stores one-way baseline to toggle RT without extra API calls
   - Offers: 10% of gross to Lexington first; remaining − carrierPay = profit; split profit 80/20 (Narta/Lex)
   - Pipeline: saves to localStorage "pipeline_v2"
*/
(function(){
  const $  = (s)=>document.querySelector(s);
  const $$ = (s)=>Array.from(document.querySelectorAll(s));
  const onReady = (fn)=> (document.readyState==='loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());
  const log = (...a)=> console.log('[NARTA A3]', ...a);

  // ------- find buttons by text if IDs missing -------
  function findBtnByText(txt){
    const t = (txt||'').toLowerCase();
    return $$('button, [role="button"], input[type="button"], input[type="submit"]').find(
      b => (b.innerText||b.value||'').toLowerCase().includes(t)
    ) || null;
  }

  // ------- fallback parser (if window.NARTA_PARSER missing) -------
  function fallbackExtract(txt){
    const clean = (s)=> String(s||'').replace(/\(([^)]+)\)/g,' $1 ').replace(/\s+/g,' ').trim();
    const CITY  = "([A-Za-z .'-]{2,})";
    const STATE = "(AL|AK|AZ|AR|CA|CO|CT|DC|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)";
    const ZIP   = "(\\d{5})(?:-\\d{4})?";
    const CITY_ST = new RegExp(`${CITY}\\s*,\\s*${STATE}(?:\\s+${ZIP})?`, 'i');

    function pick(labelRe){
      for(const ln of String(txt||'').split(/\r?\n/)){
        if(labelRe.test(ln)){
          const rest = clean(ln.replace(labelRe,''));
          const mm = rest.match(CITY_ST);
          if(mm) return mm[0];
          // also handle bare "IN 46507" or "Bristol, IN"
          const bare = rest.match(new RegExp(`${CITY}\\s*,\\s*${STATE}`,'i'));
          if(bare) return bare[0];
          return rest;
        }
      }
      return '';
    }

    const pickup   = pick(/^(pickup|pu|from|origin|shipper)\s*:?\s*/i);
    const delivery = pick(/^(delivery|to|dest|drop|consignee)\s*:?\s*/i);

    // Date/time (light)
    const date = (txt.match(/\b(?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|[A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?)\b/)||[])[0]||'';

    // Equipment + container size
    let equipment='', size='';
    const eqm = txt.match(/\b(20|40|45)\s*(?:ft|’|')?\s*(?:hc|high\s*cube)?\s*(?:container|cntr|box)?\b|power\s*only|53\s*(?:van|trailer)/i);
    if(eqm){
      const hit = eqm[0].toLowerCase();
      equipment = /power/.test(hit) ? 'Power Only' :
                  /container|cntr|box|van|trailer/.test(hit) ? hit.replace(/\s+/g,' ').trim() : 'Container';
      const sm = hit.match(/\b(20|40|45)\b/); if(sm) size=sm[1];
    }

    // Lane type guess
    let lane = '';
    const t = String(txt||'').toLowerCase();
    if(/port/.test(t) && /ramp|rail/.test(t)) lane='port → ramp';
    else if(/ramp|rail/.test(t) && /door|delivery|consignee|pkwy|st\b/.test(t)) lane='ramp → door';
    else if(/door/.test(t) && /door/.test(t)) lane='door → door';

    // Gross (prefer “all-in”)
    let gross = null;
    const allIn = txt.match(/all[-\s]?in(?:\s*rate)?[^\d$]{0,16}\$?\s*([0-9]{2,6}(?:\.[0-9]{2})?)/i);
    if(allIn){ gross = Number(allIn[1]); }
    else{
      const nums = (txt.match(/\$?\s*([0-9]{2,6}(?:\.[0-9]{2})?)/g)||[])
        .map(s=>Number((s.match(/[0-9.]+/)||[])[0]))
        .filter(n=>!isNaN(n));
      if(nums.length) gross = Math.max(...nums);
    }

    return { pickup, delivery, date, equipment, size, lane, gross };
  }

  // ------- pricing helpers -------
  const round2 = (n)=> Math.round((Number(n)||0)*100)/100;
  function perMileHeuristic(miles, equipment, size, lane){
    let base = /ramp|port/i.test(lane) ? 2.6 : 2.2;
>>>>>>> origin/main
    if(miles<120) base += 0.25;
    if(miles>500) base -= 0.10;
    if(/power only/i.test(equipment)) base -= 0.10;
    if(String(size)==='20') base -= 0.05;
    if(String(size)==='45') base += 0.05;
    return Math.max(base, 1.4);
  }
<<<<<<< main
  function splitOn(gross, carrier){
    const wall10 = 0.10 * (Number(gross)||0);
    const profit = Math.max((Number(gross)||0) - wall10 - (Number(carrier)||0), 0);
    return { carrier: round2(carrier), wall10: round2(wall10), profit: round2(profit), narta80: round2(profit * 0.80), lex20: round2(profit * 0.20) };
  }
  function mkTiers(marketCarrier, gross){
=======
  function buildTiers(marketCarrier, gross){
    const split = (C)=>{
      const wall10 = round2(gross*0.10);                 // Lexington 10% of GROSS first
      const profit = round2(Math.max(gross - wall10 - C, 0));
      return {
        carrier: round2(C),
        wall10,
        profit,
        narta80: round2(profit*0.80),
        lex20:   round2(profit*0.20)
      };
    };
>>>>>>> origin/main
    const fast = Math.max(marketCarrier * 0.94, 250);
    const targ = Math.max(marketCarrier * 1.00, 300);
    const stre = Math.max(marketCarrier * 1.06, 350);
    return [
<<<<<<< main
      {tier:'Fast Sell', ...splitOn(gross, fast),  win:0.85},
      {tier:'Target',    ...splitOn(gross, targ),  win:0.65},
      {tier:'Stretch',   ...splitOn(gross, stre),  win:0.40},
    ];
  }
  btnEst?.addEventListener('click', ()=>{
    const miles = Number(milesEl?.value||0);
    const gross = Number(grossEl?.value||0);
    if(!miles) return alert('Enter miles first.');
    if(!gross) return alert('Enter Gross first (customer all-in).');
    const perMi = heuristicPerMile(miles, equipEl?.value, sizeEl?.value, laneEl?.value);
    const base  = miles * perMi;
    const tiers = mkTiers(base, gross);
    renderOffers(tiers, gross);
  });
  btnAI?.addEventListener('click', async ()=>{
    const pickup = pickupEl?.value?.trim();
    const delivery = deliveryEl?.value?.trim();
    const miles = Number(milesEl?.value||0);
    const gross = Number(grossEl?.value||0);
    const equipment = equipEl?.value||'';
    const containerSize = sizeEl?.value||'';
    const laneType = laneEl?.value||'';
    const isIntermodal = /ramp|rail|port/i.test(laneType);
    if(!pickup || !delivery || !miles || !gross) return alert('Fill Pickup, Delivery, Miles, and Gross first.');
    if(!btnAI) return;
    btnAI.disabled = true; const old = btnAI.textContent; btnAI.textContent='Thinking…';
    try{
      const r = await fetch('/api/ai_contra_offer', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pickup, delivery, miles, gross, equipment, containerSize, laneType, isIntermodal })
      });
      let j; try { j = await r.json(); } catch { j={}; }
      if(!r.ok || !j?.tiers) throw new Error(j?.error||'AI error');
      renderOffers(j.tiers, gross);
    }catch(e){ console.error(e); alert('Could not get AI offers.'); }
    finally{ btnAI.disabled=false; btnAI.textContent=old; }
  });
  function renderOffers(tiers, gross){
    if(offersCard) offersCard.style.display='block';
    if(offersBody) offersBody.innerHTML='';
    selectedOffer = null; if(selOfferPill) selOfferPill.textContent = 'Selected: —';
    (tiers||[]).forEach((t, idx)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.tier||''}</td>
        <td class="right">$${Number(t.carrier||0).toFixed(0)}</td>
        <td class="right">${Math.round((t.win||0)*100)}%</td>
        <td class="right">$${Number(t.wall10||0).toFixed(0)}</td>
        <td class="right">$${Number(t.profit||0).toFixed(0)}</td>
        <td class="right">$${Number(t.narta80||0).toFixed(0)}</td>
        <td class="right">$${Number(t.lex20||0).toFixed(0)}</td>
        <td><button class="pick" data-idx="${idx}">Select</button></td>
      `;
      offersBody?.appendChild(tr);
    });
    offersBody?.querySelectorAll('.pick').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = Number(btn.dataset.idx);
        selectedOffer = tiers[idx];
        if(selOfferPill) selOfferPill.textContent = `Selected: ${selectedOffer.tier} ($${Number(selectedOffer.carrier||0).toFixed(0)})`;
=======
      { tier:'Fast Sell', ...split(fast), win:0.85 },
      { tier:'Target',    ...split(targ), win:0.65 },
      { tier:'Stretch',   ...split(stre), win:0.40 },
    ];
  }

  // ------- main wire -------
  onReady(()=>{
    log('Booting analyzer vA3');

    // inputs
    const emailEl = $('#email_text');
    const pickupEl   = $('#pickup');
    const deliveryEl = $('#delivery');
    const dateEl     = $('#date');
    const equipEl    = $('#equipment');
    const sizeEl     = $('#cntr_size');
    const laneEl     = $('#lane_type');
    const milesEl    = $('#miles');
    const grossEl    = $('#gross');
    const roundChk   = $('#roundtrip');
    const usedBadge  = $('#badge_round');

    const offersCard = $('#offers_card');
    const offersBody = $('#offers_body');
    const selOfferPill = $('#sel_offer_pill');
    const statusSel = $('#pipe_status');

    // buttons (by ID or text)
    const btnParse  = $('#btn_parse')          || findBtnByText('parse');
    const btnClear  = $('#btn_clear')          || findBtnByText('clear');
    const btnGet    = $('#btn_get_miles')      || findBtnByText('get miles');
    const btnEst    = $('#btn_estimate_market')|| findBtnByText('estimate market');
    const btnAI     = $('#btn_ai_contra')      || findBtnByText('ai contra') || findBtnByText('ai');
    const btnSave   = $('#btn_save_pipeline')  || findBtnByText('save selected');

    let selectedOffer = null;
    function setMilesUsed(n){ if(usedBadge) usedBadge.textContent = `Miles used: ${round2(n||0)}`; }

    // CLEAR
    btnClear && btnClear.addEventListener('click', ()=>{
      if(emailEl) emailEl.value='';
      ['pickup','delivery','date','equipment','cntr_size','lane_type','gross','miles','pickup_time'].forEach(id=>{
        const el = $('#'+id);
        if(!el) return;
        if(el.tagName==='SELECT') el.selectedIndex=0; else el.value='';
      });
      setMilesUsed(0);
      if(offersCard){ offersCard.style.display='none'; }
      if(offersBody){ offersBody.innerHTML=''; }
      if(selOfferPill) selOfferPill.textContent='Selected: —';
      const prev = $('#preview'); if(prev) prev.textContent='{}';
      selectedOffer = null;
      log('Cleared.');
    });

    // PARSE
    btnParse && btnParse.addEventListener('click', (e)=>{
      try{
        e.preventDefault();
      }catch{}
      const txt = emailEl?.value || '';
      if(!txt){ alert('Paste the email first.'); return; }
      const extract = (window.NARTA_PARSER && typeof window.NARTA_PARSER.extract==='function')
        ? window.NARTA_PARSER.extract
        : fallbackExtract;
      const out = extract(txt) || {};
      log('Parse result:', out);
      if(out.pickup && pickupEl) pickupEl.value = out.pickup;
      if(out.delivery && deliveryEl) deliveryEl.value = out.delivery;
      if(out.date && dateEl) dateEl.value = out.date;
      if(out.equipment && equipEl) equipEl.value = out.equipment;
      if(out.size && sizeEl) sizeEl.value = out.size;
      if(out.lane && laneEl) laneEl.value = out.lane;
      if(out.gross && grossEl && !grossEl.value) grossEl.value = out.gross;
      const prev = $('#preview'); if(prev) prev.textContent = JSON.stringify(out,null,2);
    });

    // ROUND-TRIP TOGGLE (recompute from baseline)
    if(milesEl && roundChk){
      if(!milesEl.dataset) milesEl.dataset = {};
      milesEl.addEventListener('input', ()=>{
        const v = Number(milesEl.value||0);
        milesEl.dataset.oneway = String(v||0);
        const used = roundChk.checked ? v*2 : v;
        setMilesUsed(used);
      });
      roundChk.addEventListener('change', ()=>{
        const base = Number(milesEl.dataset.oneway||0);
        const used = roundChk.checked ? base*2 : base;
        milesEl.value = base ? round2(used) : '';
        setMilesUsed(used);
>>>>>>> origin/main
      });
    }

    // GET MILES
    btnGet && btnGet.addEventListener('click', async (e)=>{
      try{ e.preventDefault(); }catch{}
      const pickup = pickupEl?.value?.trim();
      const delivery = deliveryEl?.value?.trim();
      if(!pickup || !delivery){ alert('Enter Pickup and Delivery first.'); return; }
      const isRT = window.confirm('Round trip miles?\nOK = Round trip (2×)\nCancel = One-way');
      try{
        const r = await fetch('/api/miles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup,delivery})});
        const j = await r.json();
        if(!r.ok || typeof j.miles!=='number'){ console.error('Miles error:', j); alert('Miles failed. Check GOOGLE_MAPS_KEY.'); return; }
        if(!milesEl) return;
        milesEl.dataset = milesEl.dataset||{};
        milesEl.dataset.oneway = String(j.miles);
        const used = isRT ? j.miles*2 : j.miles;
        if(roundChk) roundChk.checked = !!isRT;
        milesEl.value = round2(used);
        setMilesUsed(used);
      }catch(err){ console.error(err); alert('Network error while fetching miles.'); }
    });
<<<<<<< main
  }
  const PIPE_KEY = 'pipeline_v2';
  function loadPipe(){ try { return JSON.parse(localStorage.getItem(PIPE_KEY)||'[]'); } catch { return []; } }
  function savePipe(items){ localStorage.setItem(PIPE_KEY, JSON.stringify(items)); }
  btnSave?.addEventListener('click', ()=>{
    if(!selectedOffer){ alert('Select an offer first.'); return; }
    const item = {
      ts: new Date().toISOString(),
      status: selStatus?.value || 'New',
      from: pickupEl?.value||'',
      to: deliveryEl?.value||'',
      size: sizeEl?.value||'',
      equipment: equipEl?.value||'',
      miles: Number(milesEl?.value||0),
      gross: Number(grossEl?.value||0),
      offer: selectedOffer?.tier,
      carrier: Number(selectedOffer?.carrier||0),
      profit: Number(selectedOffer?.profit||0),
      narta: Number(selectedOffer?.narta80||0),
      lex: Number(selectedOffer?.lex20||0),
      wall: Number(selectedOffer?.wall10||0),
      win: Number(selectedOffer?.win||0)
    };
    const items = loadPipe();
    items.unshift(item);
    savePipe(items);
    alert('Saved to pipeline.');
  });
  try {
    const b = document.createElement('div');
    b.textContent = 'ANALYZER A10 ACTIVE';
    b.style.cssText = 'position:fixed;right:10px;bottom:10px;background:#0a0;color:#fff;padding:6px 10px;border-radius:8px;font-weight:700;z-index:99999;font-size:12px;';
    document.body.appendChild(b);
    setTimeout(()=>b.remove(), 4000);
  } catch {}
=======

    // ESTIMATE MARKET (heuristic tiers)
    btnEst && btnEst.addEventListener('click', ()=>{
      const miles = Number(milesEl?.value||0);
      const gross = Number(grossEl?.value||0);
      if(!miles) return alert('Enter miles first or click GET MILES.');
      if(!gross) return alert('Enter Gross first (customer all-in).');
      const perMi = perMileHeuristic(miles, equipEl?.value||'', sizeEl?.value||'', laneEl?.value||'');
      const baseCarrier = miles * perMi;
      const tiers = buildTiers(baseCarrier, gross);
      renderOffers(tiers);
    });

    // AI CONTRA (optional, if your /api/ai_contra_offer is wired)
    btnAI && btnAI.addEventListener('click', async ()=>{
      const pickup = pickupEl?.value?.trim();
      const delivery = deliveryEl?.value?.trim();
      const miles = Number(milesEl?.value||0);
      const gross = Number(grossEl?.value||0);
      const equipment = equipEl?.value||'';
      const size = sizeEl?.value||'';
      const lane = laneEl?.value||'';
      if(!pickup || !delivery || !miles || !gross) return alert('Fill Pickup, Delivery, Miles, and Gross first.');

      btnAI.disabled = true; const old = btnAI.innerText||btnAI.value; if(btnAI.innerText) btnAI.innerText='Thinking…';
      try{
        const r = await fetch('/api/ai_contra_offer', {method:'POST',headers:{'Content-Type':'application/json'},
          body: JSON.stringify({pickup,delivery,miles,gross,equipment,containerSize:size,laneType:lane,isIntermodal:/ramp|rail|port/i.test(lane)})});
        const j = await r.json();
        if(!r.ok || !j?.tiers) throw new Error(j?.error||'AI error');
        renderOffers(j.tiers);
      }catch(e){ console.error(e); alert('Could not get AI offers.'); }
      finally{ btnAI.disabled=false; if(btnAI.innerText!==undefined) btnAI.innerText=old; }
    });

    // RENDER OFFERS + SELECT
    function renderOffers(tiers){
      if(!offersCard || !offersBody) return;
      offersCard.style.display='block';
      offersBody.innerHTML='';
      selectedOffer = null; if(selOfferPill) selOfferPill.textContent='Selected: —';
      tiers.forEach((t, idx)=>{
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${t.tier||''}</td>
          <td class="right">$${round2(t.carrier||0).toFixed(0)}</td>
          <td class="right">${Math.round((t.win||0)*100)}%</td>
          <td class="right">$${round2(t.wall10||0).toFixed(0)}</td>
          <td class="right">$${round2(t.profit||0).toFixed(0)}</td>
          <td class="right">$${round2(t.narta80||0).toFixed(0)}</td>
          <td class="right">$${round2(t.lex20||0).toFixed(0)}</td>
          <td><button class="pick" data-idx="${idx}">Select</button></td>
        `;
        offersBody.appendChild(tr);
      });
      $$('#offers_body .pick').forEach(btn=>{
        btn.addEventListener('click', ()=>{
          const idx = Number(btn.dataset.idx||0);
          selectedOffer = tiers[idx];
          if(selOfferPill) selOfferPill.textContent = `Selected: ${selectedOffer.tier} ($${round2(selectedOffer.carrier||0).toFixed(0)})`;
        });
      });
    }

    // PIPELINE SAVE (localStorage only)
    const PIPE_KEY = 'pipeline_v2';
    function loadPipe(){ try{ return JSON.parse(localStorage.getItem(PIPE_KEY)||'[]'); }catch{ return []; } }
    function savePipe(items){ localStorage.setItem(PIPE_KEY, JSON.stringify(items)); }

    btnSave && btnSave.addEventListener('click', ()=>{
      if(!selectedOffer){ alert('Select an offer first.'); return; }
      const item = {
        ts: new Date().toISOString(),
        status: statusSel?.value || 'New',
        from: pickupEl?.value||'',
        to: deliveryEl?.value||'',
        size: sizeEl?.value||'',
        equipment: equipEl?.value||'',
        miles: Number(milesEl?.value||0),
        gross: Number(grossEl?.value||0),
        offer: selectedOffer.tier,
        carrier: Number(selectedOffer.carrier||0),
        profit: Number(selectedOffer.profit||0),
        narta: Number(selectedOffer.narta80||0),
        lex: Number(selectedOffer.lex20||0),
        wall: Number(selectedOffer.wall10||0),
        win: Number(selectedOffer.win||0)
      };
      const items = loadPipe(); items.unshift(item); savePipe(items);
      alert('Saved to pipeline.');
    });

    log('Analyzer ready.');
  });
>>>>>>> origin/main
})();