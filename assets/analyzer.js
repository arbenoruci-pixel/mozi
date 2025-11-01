// Analyzer core (A10): wiring + miles + offers + RT chooser + clear
(function(){
  const $ = window.$, $$ = window.$$;

  const email = $('#email_text');
  const pickup = $('#pickup');
  const delivery = $('#delivery');
  const date = $('#date');
  const equip = $('#equipment');
  const size = $('#cntr_size');
  const laneType = $('#lane_type');
  const badgeRound = $('#badge_round');
  const roundtrip = $('#roundtrip');
  const miles = $('#miles');
  const gross = $('#gross');
  const pickupTime = $('#pickup_time');
  const preview = $('#preview');
  const offersPanel = $('#offers_panel');

  // DEMO fill
  $('#btn_fill_demo')?.addEventListener('click', ()=>{
    email.value = `Please reply with your carrier pay and availability.

Lane: from Chicago, IL 60632 to Bristol, IN 46507
Date/Time: Oct 30, 2025 0830
Equipment: Power Only, 40HC
All-in: $1,450 flat
Thanks`;
  });

  function setUsed(n){ if(badgeRound) badgeRound.textContent = 'Miles used: ' + (Number(n||0)); }
  if (!miles.dataset) miles.dataset = {};
  miles.dataset.oneway = miles.dataset.oneway || '';

  // Parse
  $('#btn_parse')?.addEventListener('click', ()=>{
    const obj = window.moziParseEmail(email.value||'');
    if (obj.pickup) pickup.value = obj.pickup;
    if (obj.delivery) delivery.value = obj.delivery;
    if (obj.date) date.value = obj.date;
    if (obj.equipment) equip.value = obj.equipment;
    if (obj.size) size.value = obj.size;
    if (obj.gross && !gross.value) gross.value = obj.gross;

    classifyLane();
    preview.textContent = JSON.stringify(obj, null, 2);
  });

  // Clear
  $('#btn_clear')?.addEventListener('click', ()=>{
    email.value=''; [pickup,delivery,date,equip,laneType,miles,gross,pickupTime].forEach(x=>{ if(x) x.value=''; });
    if (size) size.selectedIndex = 0;
    offersPanel.textContent = 'Offers will appear here…';
    setUsed(0);
    preview.textContent='{}';
  });

  // Classify (simple)
  function city(addr){ const m = String(addr||'').match(/^([^,]+),/); return m?m[1].trim():''; }
  function st(addr){ const m = String(addr||'').match(/,\s*([A-Z]{2})\b/); return m?m[1]:''; }
  const PORTS = ['Newark,NJ','Savannah,GA','Charleston,SC','Houston,TX','Norfolk,VA','Baltimore,MD','Tacoma,WA','Portland,OR'];
  const RAILS = ['Cicero,IL','Chicago,IL','Bedford Park,IL','Joliet,IL','Columbus,OH','Haslet,TX','Dallas,TX','Edgerton,KS','Memphis,TN','Fairburn,GA','Seattle,WA'];
  function isPort(a){const c=city(a),s=st(a);return PORTS.includes(c+','+s);}
  function isRail(a){const c=city(a),s=st(a);return RAILS.includes(c+','+s);}
  function excludeFLCA(a){return /,(?:FL|CA)\b/.test(String(a||''));}

  function classifyLane(){
    const from=pickup.value,to=delivery.value;
    const fP=isPort(from), tP=isPort(to);
    const fR=isRail(from), tR=isRail(to);
    const flags = {port:!!(fP||tP), rail:!!(fR||tR), excluded:(excludeFLCA(from)||excludeFLCA(to))};
    let lt='door → door';
    if (fP && tR) lt='port → ramp';
    else if (fR && tR) lt='ramp → ramp';
    else if (fR && !tR && !tP) lt='ramp → door';
    else if (fP && !tR) lt='port → door';
    laneType.value = lt;
    $('#tag_port').textContent='Port: '+(fP?'YES':tP?'YES':'—');
    $('#tag_rail').textContent='Rail: '+(fR?'YES':tR?'YES':'—');
    $('#tag_flags').textContent='Flags: '+(flags.excluded?'EXCLUDED FL/CA':'OK');
    return flags;
  }

  // GET MILES with RT chooser
  async function fetchMilesOneWay() {
    const o=pickup.value?.trim(), d=delivery.value?.trim();
    if (!o || !d) { alert('Enter Pickup and Delivery first.'); return null; }
    try{
      const res = await fetch('/api/miles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pickup:o,delivery:d})});
      const data = await res.json();
      if (!res.ok || typeof data.miles !== 'number') throw new Error(data.error||'miles error');
      return data.miles;
    }catch(e){ console.error(e); alert('Miles API failed.'); return null; }
  }
  async function getMilesFlow(){
    const isRT = window.confirm('Round trip miles?\nOK = Round trip (2×)\nCancel = One-way');
    const one = await fetchMilesOneWay(); if(one==null) return;
    miles.dataset.oneway = String(one); roundtrip.checked = !!isRT;
    const used = isRT ? one*2 : one; miles.value = used; setUsed(used);
  }
  $('#btn_get_miles')?.addEventListener('click', (e)=>{ e.preventDefault(); getMilesFlow(); });
  roundtrip?.addEventListener('change', ()=>{
    const base = Number(miles.dataset.oneway||0);
    const used = roundtrip.checked ? base*2 : base;
    miles.value = base? used : ''; setUsed(used);
  });
  miles?.addEventListener('input', ()=>{
    const v=Number(miles.value||0); miles.dataset.oneway=String(v||0); setUsed(roundtrip.checked? v*2 : v);
  });

  // Estimate Market + Offers (server → fallback)
  function renderOffers(rows, usedMiles, g){
    const html = `
      <div style="font-weight:700;margin-bottom:6px">Suggested Carrier Offers</div>
      <div class="small muted" style="margin-bottom:6px">Miles used: <b>${usedMiles}</b> • Gross: <b>$${(g||0).toLocaleString()}</b></div>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th>Tier</th><th class="right">Carrier</th><th class="right">Wall 10%</th>
          <th class="right">Profit</th><th class="right">Narta 80%</th><th class="right">Lex 20%</th>
        </tr></thead>
        <tbody>${rows.map(r=>`
          <tr>
            <td>${r.tier}</td>
            <td class="right">$${r.carrier.toLocaleString()}</td>
            <td class="right">$${r.wall.toLocaleString()}</td>
            <td class="right">$${r.profit.toLocaleString()}</td>
            <td class="right">$${r.narta.toLocaleString()}</td>
            <td class="right">$${r.lex.toLocaleString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>`;
    offersPanel.innerHTML = html;
  }

  function localOffers(milesUsed, g){
    const anchor = Math.max(400, milesUsed*3.0);
    const tiers = [
      {tier:'Fast Sell', mult:1.00},
      {tier:'Target', mult:0.93},
      {tier:'Stretch', mult:0.85},
    ].map(t => {
      const carrier = Math.round(anchor*t.mult);
      const wall = Math.round((g||Math.round(anchor*1.2))*0.10);
      const profit = Math.max(0, (g||Math.round(anchor*1.2)) - wall - carrier);
      const narta = Math.round(profit*0.80);
      const lex = Math.round(profit*0.20);
      return {tier: t.tier, carrier, wall, profit, narta, lex};
    });
    return tiers;
  }

  $('#btn_estimate')?.addEventListener('click', async (e)=>{
    e.preventDefault();
    const base = Number(miles.dataset.oneway||0);
    const used = roundtrip.checked? base*2 : (Number(miles.value||0)||base);
    const g = Number((gross.value||'').replace(/[^0-9.]/g,''))||0;

    let rows=null;
    try{
      const r = await fetch('/api/market',{method:'POST',headers:{'Content-Type':'application/json'},body: JSON.stringify({
        miles: base || used, roundTrip: roundtrip.checked, customerGross: g||undefined
      })});
      const j = await r.json();
      if(r.ok && Array.isArray(j.tiers)) rows=j.tiers, renderOffers(rows, j.usedMiles, j.gross);
    }catch(e){ console.warn('market API error', e); }
    if(!rows){ const tiers = localOffers(used, g); renderOffers(tiers, used, g); }
  });
})();