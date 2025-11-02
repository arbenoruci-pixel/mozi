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
    if(miles<120) base += 0.25;
    if(miles>500) base -= 0.10;
    if(/power only/i.test(equipment)) base -= 0.10;
    if(String(size)==='20') base -= 0.05;
    if(String(size)==='45') base += 0.05;
    return Math.max(base, 1.4);
  }
  function splitOn(gross, carrier){
    const wall10 = 0.10 * (Number(gross)||0);
    const profit = Math.max((Number(gross)||0) - wall10 - (Number(carrier)||0), 0);
    return { carrier: round2(carrier), wall10: round2(wall10), profit: round2(profit), narta80: round2(profit * 0.80), lex20: round2(profit * 0.20) };
  }
  function mkTiers(marketCarrier, gross){
    const fast = Math.max(marketCarrier * 0.94, 250);
    const targ = Math.max(marketCarrier * 1.00, 300);
    const stre = Math.max(marketCarrier * 1.06, 350);
    return [
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
      });
    });
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
})();