
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

  // Clear
  btnClear?.addEventListener('click', ()=>{
    if(emailEl) emailEl.value='';
    ['pickup','delivery','date','equipment','cntr_size','lane_type','gross','miles','pickup_time'].forEach(id=>{
      const el = document.getElementById(id);
      if(!el) return;
      if(el.tagName==='SELECT') el.selectedIndex=0; else el.value='';
    });
    setMilesUsed(0);
    offersCard.style.display='none'; offersBody.innerHTML='';
    const preview=$('#preview'); if(preview) preview.textContent='{}';
    selectedOffer = null; selOfferPill.textContent = 'Selected: —';
  });

  // Parse (requires window.NARTA_PARSER.extract)
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

  // GET MILES (confirm for round trip)
  btnGetMiles?.addEventListener('click', async ()=>{
    const pickup = pickupEl.value?.trim();
    const delivery = deliveryEl.value?.trim();
    if(!pickup || !delivery){ alert('Enter Pickup and Delivery first.'); return; }
    const isRT = window.confirm('Round trip miles?\nOK = Round trip (2×)\nCancel = One-way');
    try{
      const r = await fetch('/api/miles', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pickup, delivery })
      });
      const j = await r.json();
      if(!r.ok || typeof j.miles!=='number'){ alert('Miles failed. Check GOOGLE_MAPS_KEY.'); return; }
      milesEl.dataset = milesEl.dataset||{};
      milesEl.dataset.oneway = String(j.miles);
      milesEl.value = isRT ? round2(j.miles*2) : round2(j.miles);
      roundChk.checked = !!isRT;
      setMilesUsed(milesEl.value);
    }catch(e){ console.error(e); alert('Network error while fetching miles.'); }
  });

  // Heuristic per-mile
  function heuristicPerMile(miles, equipment, size, lane){
    let base = /ramp|port/i.test(lane)? 2.6 : 2.2;
    if(miles<120) base += 0.25;
    if(miles>500) base -= 0.10;
    if(/power only/i.test(equipment)) base -= 0.10;
    if(size==='20') base -= 0.05;
    if(size==='45') base += 0.05;
    return Math.max(base, 1.4);
  }

  function mkTiers(marketCarrier, gross){
    function split(C){
      const lex10 = 0.10 * gross; // Lexington 10% of gross first
      const profit = Math.max(gross - lex10 - C, 0);
      return {
        carrier: round2(C),
        wall10: round2(lex10),
        profit: round2(profit),
        narta80: round2(profit*0.80),
        lex20: round2(profit*0.20)
      };
    }
    const fast = Math.max(marketCarrier * 0.94, 250);
    const targ = Math.max(marketCarrier * 1.00, 300);
    const stre = Math.max(marketCarrier * 1.06, 350);
    return [
      {tier:'Fast Sell', ...split(fast),  win:0.85},
      {tier:'Target',    ...split(targ),  win:0.65},
      {tier:'Stretch',   ...split(stre),  win:0.40},
    ];
  }

  // Estimate Market (heuristic only)
  btnEst?.addEventListener('click', ()=>{
    const miles = Number(milesEl.value||0);
    const gross = Number(grossEl.value||0);
    if(!miles) return alert('Enter miles first.');
    if(!gross) return alert('Enter Gross first (customer all-in).');
    const perMi = heuristicPerMile(miles, equipEl.value, sizeEl.value, laneEl.value);
    const base  = miles * perMi;
    const tiers = mkTiers(base, gross);
    renderOffers(tiers, gross);
  });

  // (Optional) AI counter — will replace tiers if /api/ai_contra_offer is wired
  btnAI?.addEventListener('click', async ()=>{
    const pickup = pickupEl.value?.trim();
    const delivery = deliveryEl.value?.trim();
    const miles = Number(milesEl.value||0);
    const gross = Number(grossEl.value||0);
    const equipment = equipEl.value||'';
    const containerSize = sizeEl.value||'';
    const laneType = laneEl.value||'';
    const isIntermodal = /ramp|rail|port/i.test(laneType);

    if(!pickup || !delivery || !miles || !gross) return alert('Fill Pickup, Delivery, Miles, and Gross first.');
    btnAI.disabled = true; const old = btnAI.textContent; btnAI.textContent='Thinking…';
    try{
      const r = await fetch('/api/ai_contra_offer', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ pickup, delivery, miles, gross, equipment, containerSize, laneType, isIntermodal })
      });
      const j = await r.json();
      if(!r.ok || !j?.tiers) throw new Error(j?.error||'AI error');
      renderOffers(j.tiers, gross);
    }catch(e){ console.error(e); alert('Could not get AI offers.'); }
    finally{ btnAI.disabled=false; btnAI.textContent=old; }
  });

  function renderOffers(tiers, gross){
    offersCard.style.display='block';
    offersBody.innerHTML='';
    selectedOffer = null; selOfferPill.textContent = 'Selected: —';
    tiers.forEach((t, idx)=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${t.tier}</td>
        <td class="right">$${(t.carrier||0).toFixed(0)}</td>
        <td class="right">${Math.round((t.win||0)*100)}%</td>
        <td class="right">$${(t.wall10||0).toFixed(0)}</td>
        <td class="right">$${(t.profit||0).toFixed(0)}</td>
        <td class="right">$${(t.narta80||0).toFixed(0)}</td>
        <td class="right">$${(t.lex20||0).toFixed(0)}</td>
        <td><button class="pick" data-idx="${idx}">Select</button></td>
      `;
      offersBody.appendChild(tr);
    });
    offersBody.querySelectorAll('.pick').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const idx = Number(btn.dataset.idx);
        selectedOffer = tiers[idx];
        selOfferPill.textContent = `Selected: ${selectedOffer.tier} ($${(selectedOffer.carrier||0).toFixed(0)})`;
      });
    });
  }

  // ===== Pipeline save (local only) =====
  const PIPE_KEY = 'pipeline_v2';
  function loadPipe(){ try { return JSON.parse(localStorage.getItem(PIPE_KEY)||'[]'); } catch { return []; } }
  function savePipe(items){ localStorage.setItem(PIPE_KEY, JSON.stringify(items)); }

  btnSave?.addEventListener('click', ()=>{
    if(!selectedOffer){ alert('Select an offer first.'); return; }
    const item = {
      ts: new Date().toISOString(),
      status: selStatus?.value || 'New',
      from: pickupEl.value||'',
      to: deliveryEl.value||'',
      size: sizeEl.value||'',
      equipment: equipEl.value||'',
      miles: Number(milesEl.value||0),
      gross: Number(grossEl.value||0),
      offer: selectedOffer.tier,
      carrier: Number(selectedOffer.carrier||0),
      profit: Number(selectedOffer.profit||0),
      narta: Number(selectedOffer.narta80||0),
      lex: Number(selectedOffer.lex20||0),
      wall: Number(selectedOffer.wall10||0),
      win: Number(selectedOffer.win||0)
    };
    const items = loadPipe();
    items.unshift(item);
    savePipe(items);
    alert('Saved to pipeline.');
  });

})();
