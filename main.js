// main.js — hardened + email scan widget + hooks
import { KEYS, loadJSON, saveJSON } from './assets/modules/storage.js';
import { installSafetyNet, guard } from './assets/modules/safeguard.js';
import { startWatchdog } from './assets/modules/guard.js';
import { parseEmail } from './assets/modules/parser.js';
import { ensureGoogleLoaded, getRoute } from './assets/modules/map.js';
import { suggestQuotes } from './assets/modules/pricing.js';

// Optional: your existing modules (ui, stations, etc.) will still work if present
// If missing, we guard calls below.

const { SAFE } = installSafetyNet({ appName:'Smart Freight', keyPrefix:'SFT', safeKeys:['GMAPS_API_KEY'], freezeMs:4000, enablePanic:true });
startWatchdog('SmartFreight');

const $ = (s)=>document.querySelector(s);

// Minimal bindings (works with your existing HTML if IDs match)
const els = {
  pasteBox: $('#pasteBox'), btnParse: $('#btnParse'), btnRoute: $('#btnRoute'),
  pickup: $('#pickup'), delivery: $('#delivery'), when: $('#when'), equip: $('#equip'), rate: $('#rate'),
  routeBox: $('#routeBox'), rt: $('#rt'), btnCalc: $('#btnCalc'), suggestions: $('#suggestions'),
};

// Parse button
if (els.btnParse) els.btnParse.addEventListener('click', guard('ui.parse', async ()=>{
  const t=(els.pasteBox?.value||'').trim(); if(!t) return;
  const parsed = parseEmail(t);
  if (parsed.pickup)  els.pickup && (els.pickup.value = parsed.pickup);
  if (parsed.delivery)els.delivery && (els.delivery.value = parsed.delivery);
  if (parsed.when)    els.when && (els.when.value = parsed.when);
  if (parsed.equip)   els.equip && (els.equip.value = parsed.equip);
  if (parsed.rate!=null) els.rate && (els.rate.value = parsed.rate);
}));

// Route button
if (els.btnRoute) els.btnRoute.addEventListener('click', guard('ui.route', async ()=>{
  if (SAFE) return;
  const from=els.pickup?.value?.trim(); const to=els.delivery?.value?.trim();
  if(!from||!to) return;
  await ensureGoogleLoaded();
  const r = await getRoute(from, to);
  // renderRoute would be your own UI; here we just stash miles to dataset if routeBox exists
  if (els.routeBox) els.routeBox.dataset.miles = String(Math.round((r.distanceMeters||0)/1609.34));
}));

// Calc button
if (els.btnCalc) els.btnCalc.addEventListener('click', ()=>{
  const miles = Number(els.routeBox?.dataset?.miles||0);
  const roundTrip = (els.rt?.value||'yes')==='yes';
  const brokerAllIn = Number(els.rate?.value||0);
  const cards = suggestQuotes({ milesOneWay: miles, roundTrip, brokerAllIn, fuelPerMile:0, driverPerMile:0, fixedCosts:0, deduction:{lex:10,narta:80,contractor:20}, longhaul:{threshold:250,premium:0.10} });
  // No UI renderer included here; your existing renderCards will display them.
  console.log('Quotes:', cards);
});

/* ---------- Email Scan Floating Widget ---------- */
function addEmailWidget(){
  const need = /(^|\?|&)emails=1/.test(location.search) || !localStorage.getItem('SFT:EMAILS_WIDGET_HIDDEN');
  const box = document.createElement('div');
  box.id='emailWidget';
  box.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483647;background:#0b0d10;color:#fff;border:1px solid #3a3f44;border-radius:10px;padding:10px 12px;font:13px system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35)';
  box.innerHTML=`<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <strong>Emails</strong>
    <button id="emailClose" style="margin-left:auto;background:#222;color:#bbb;border:1px solid #444;border-radius:6px;padding:2px 6px">×</button>
  </div>
  <div style="display:flex;gap:8px">
    <button id="emailScan" style="background:#2d6cdf;border:0;color:#fff;padding:6px 10px;border-radius:6px">Scan Emails</button>
    <label style="display:flex;align-items:center;gap:6px">
      <input id="emailAuto" type="checkbox"> Auto
    </label>
  </div>
  <div id="emailStatus" style="margin-top:8px;color:#8bd3ff">Idle</div>`;
  if (!need) { box.style.display='none'; }
  document.body.appendChild(box);

  const close = box.querySelector('#emailClose');
  close.onclick = ()=>{ box.style.display='none'; localStorage.setItem('SFT:EMAILS_WIDGET_HIDDEN','1'); };

  const status = box.querySelector('#emailStatus');
  const scanBtn = box.querySelector('#emailScan');
  const autoCb = box.querySelector('#emailAuto');

  async function scanOnce(){
    status.textContent='Scanning…';
    try{
      const r = await fetch('/api/mail/scan');
      const data = await r.json();
      if (!data?.ok) throw new Error(data?.error || 'scan failed');
      status.textContent = `Found: doable ${data.counts.doable}, maybe ${data.counts.maybe}, skip ${data.counts.skip}`;
      console.log('[scan]', data);
    }catch(err){
      status.textContent='Error: '+(err.message||err);
    }
  }
  scanBtn.onclick = ()=> scanOnce();

  let timer=null;
  autoCb.onchange = ()=>{
    if (autoCb.checked){
      scanOnce();
      timer = setInterval(scanOnce, 5*60*1000);
      status.textContent='Auto mode enabled';
    } else {
      if (timer) clearInterval(timer);
      status.textContent='Auto mode disabled';
    }
  };

  // hotkey Shift+E toggles widget
  window.addEventListener('keydown', (e)=>{
    if (e.shiftKey && (e.key==='E' || e.key==='e')){
      box.style.display = (box.style.display==='none'?'block':'none');
    }
  });
}
addEmailWidget();


/* === Miles wiring (global + per-card) ============================== */
(async function MilesHook(){
  const googleMiles = async (pu, del) => {
    const r = await fetch('/api/maps/distance?origin='+encodeURIComponent(pu)+'&destination='+encodeURIComponent(del));
    const j = await r.json();
    if (!j || j.status !== 'OK' || !j.miles) throw new Error(j.status || 'NO_RESULT');
    return Number(j.miles);
  };
  const topBtn = document.getElementById('btnRoute') || document.querySelector('#getMiles,#btnMiles,.get-miles-top');
  if (topBtn) {
    topBtn.addEventListener('click', async () => {
      try{
        const pu  = (document.getElementById('pickup')||{}).value?.trim();
        const del = (document.getElementById('delivery')||{}).value?.trim();
        if(!pu || !del) return alert('Enter Pickup & Delivery first');
        const mi = await googleMiles(pu, del);
        const milesInput = document.querySelector('#miles,#milesInput,.miles-input');
        if (milesInput) milesInput.value = mi;
        const box = document.getElementById('routeBox') || document.getElementById('milesBox') || document.body;
        const msg = document.createElement('div');
        msg.className = 'note-miles';
        msg.textContent = `Miles: ${mi} • Status: OK`;
        msg.style.cssText = 'margin:8px 0;padding:8px;border:1px solid #333;border-radius:8px;opacity:.9';
        box.prepend(msg);
      }catch(e){ alert('Miles error: '+e.message); }
    });
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.get-miles, .js-get-miles');
    if(!btn) return;
    e.preventDefault();
    try{
      const card = btn.closest('[data-pu][data-del]') || btn.closest('.card, .offer, .row') || document;
      const pu  = card?.getAttribute?.('data-pu')  || (document.getElementById('pickup')||{}).value?.trim();
      const del = card?.getAttribute?.('data-del') || (document.getElementById('delivery')||{}).value?.trim();
      if(!pu || !del) return alert('Missing PU/DEL');
      const mi = await googleMiles(pu, del);
      const input = card.querySelector('.miles-input, input[name="miles"], #miles');
      if (input) input.value = mi;
      const slot  = card.querySelector('.miles-slot, .miles-box') || card;
      const tag   = document.createElement('div');
      tag.textContent = `Miles: ${mi} • Status: OK`; 
      tag.style.cssText = 'margin:6px 0;padding:6px 8px;border:1px solid #333;border-radius:8px;opacity:.95';
      slot.prepend(tag);
    }catch(err){ alert('Miles error: '+err.message); }
  });
})();

/* === Editable sell probability for Auto options ==================== */
(function SellProbabilityHook(){
  const anchor = Array.from(document.querySelectorAll('*')).find(n => /Auto options/i.test(n.textContent||''));
  if(!anchor) return;
  const holder = document.createElement('div');
  holder.style.cssText = 'margin:8px 0; display:flex; align-items:center; gap:8px;';
  holder.innerHTML = `
    <label style="opacity:.8">Sell probability&nbsp;(%)</label>
    <input id="sellProb" type="number" min="0" max="100" value="68" style="width:90px;text-align:center;">
    <span id="sellProbLabel" style="opacity:.7">Possible (68%)</span>
  `;
  anchor.parentElement.insertBefore(holder, anchor.nextSibling);
  const $prob = holder.querySelector('#sellProb');
  const $lab  = holder.querySelector('#sellProbLabel');
  function bucket(p){ if(p>=90)return 'Very likely'; if(p>=75)return 'Likely'; if(p>=60)return 'Possible'; if(p>=40)return 'Uncertain'; return 'Low'; }
  function applyToRows(pct){
    document.querySelectorAll('.auto-row, .option-row, .use-row, .calc-row').forEach(row=>{
      row.innerHTML = row.innerHTML.replace(/(Possible|Likely|Very likely|Uncertain|Low)\s*\(\d+%?\)/ig, `${bucket(pct)} (${pct}%)`);
    });
  }
  $prob.addEventListener('input', ()=>{
    let v = Math.max(0, Math.min(100, Number($prob.value||0)));
    $prob.value = v; $lab.textContent = `${bucket(v)} (${v}%)`; applyToRows(v);
  });
  applyToRows(Number($prob.value));
})();

/* === Counter Offer: editable broker offer + counter workflow ======= */
(function CounterOfferHook(){
  const offerInput =
    document.getElementById('rate') ||
    document.getElementById('offer') ||
    document.querySelector('input[name="offer"], #Offer, .offer-input');
  const offerLabel = offerInput && (offerInput.closest('label') || offerInput.parentElement);
  const calcBtn =
    document.getElementById('btnCalc') ||
    document.querySelector('#calc, .btn-calc, button.calculate');
  if (!offerInput || !offerLabel || !calcBtn) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;';
  wrap.innerHTML = `
    <input id="brokerOffer" type="number" step="0.01" placeholder="Broker Offer $" style="width:130px; text-align:center;">
    <input id="counterOffer" type="number" step="0.01" placeholder="Counter Offer $" style="width:140px; text-align:center;">
    <button id="btnCounter" type="button" style="padding:8px 12px;">Counter-offer</button>
    <span id="counterNote" style="opacity:.7; margin-left:6px;"></span>
  `;
  offerLabel.insertAdjacentElement('afterend', wrap);
  const brokerOffer = wrap.querySelector('#brokerOffer');
  const counterOffer = wrap.querySelector('#counterOffer');
  const btnCounter = wrap.querySelector('#btnCounter');
  const note = wrap.querySelector('#counterNote');
  const syncFromMain = () => {
    const v = Number(offerInput.value || 0);
    if (v && !brokerOffer.value) brokerOffer.value = v;
  };
  syncFromMain();
  brokerOffer.addEventListener('input', () => {
    const v = Number(brokerOffer.value || 0);
    offerInput.value = (isFinite(v) && v > 0) ? v : '';
    note.textContent = v ? `Using Broker Offer: $${v.toFixed(2)}` : '';
  });
  btnCounter.addEventListener('click', () => {
    const v = Number(counterOffer.value || 0);
    if (!isFinite(v) || v <= 0) { alert('Enter a valid Counter Offer $'); return; }
    offerInput.value = v; offerInput.dataset.mode = 'counter'; note.textContent = `Counter mode: $${v.toFixed(2)}`;
    if (typeof calcBtn.click === 'function') calcBtn.click();
  });
  offerInput.addEventListener('input', syncFromMain);
})();

/* Hooks installed: Miles, SellProb, CounterOffer (placeholders kept minimal to avoid breaking your UI). */


/* === Miles wiring (global + per-card) ============================== */
(async function MilesHook(){
  const googleMiles = async (pu, del) => {
    const r = await fetch('/api/maps/distance?origin='+encodeURIComponent(pu)+'&destination='+encodeURIComponent(del));
    const j = await r.json();
    if (!j || j.status !== 'OK' || !j.miles) throw new Error(j.status || 'NO_RESULT');
    return Number(j.miles);
  };
  const topBtn = document.getElementById('btnRoute') || document.querySelector('#getMiles,#btnMiles,.get-miles-top');
  if (topBtn) {
    topBtn.addEventListener('click', async () => {
      try{
        const pu  = (document.getElementById('pickup')||{}).value?.trim();
        const del = (document.getElementById('delivery')||{}).value?.trim();
        if(!pu || !del) return alert('Enter Pickup & Delivery first');
        const mi = await googleMiles(pu, del);
        const milesInput = document.querySelector('#miles,#milesInput,.miles-input');
        if (milesInput) milesInput.value = mi;
        const box = document.getElementById('routeBox') || document.getElementById('milesBox') || document.body;
        const msg = document.createElement('div');
        msg.className = 'note-miles';
        msg.textContent = 'Miles: ' + mi + ' • Status: OK';
        msg.style.cssText = 'margin:8px 0;padding:8px;border:1px solid #333;border-radius:8px;opacity:.9';
        box.prepend(msg);
      }catch(e){ alert('Miles error: '+e.message); }
    });
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.get-miles, .js-get-miles');
    if(!btn) return;
    e.preventDefault();
    try{
      const card = btn.closest('[data-pu][data-del]') || btn.closest('.card, .offer, .row') || document;
      const pu  = (card && card.getAttribute && card.getAttribute('data-pu'))  || (document.getElementById('pickup')||{}).value?.trim();
      const del = (card && card.getAttribute && card.getAttribute('data-del')) || (document.getElementById('delivery')||{}).value?.trim();
      if(!pu || !del) return alert('Missing PU/DEL');
      const mi = await googleMiles(pu, del);
      const input = card.querySelector('.miles-input, input[name=\"miles\"], #miles');
      if (input) input.value = mi;
      const slot  = card.querySelector('.miles-slot, .miles-box') || card;
      const tag   = document.createElement('div');
      tag.textContent = 'Miles: ' + mi + ' • Status: OK';
      tag.style.cssText = 'margin:6px 0;padding:6px 8px;border:1px solid #333;border-radius:8px;opacity:.95';
      slot.prepend(tag);
    }catch(err){ alert('Miles error: '+err.message); }
  });
})();

/* === Editable sell probability for Auto options ==================== */
(function SellProbabilityHook(){
  const anchor = Array.from(document.querySelectorAll('*')).find(n => /Auto options/i.test(n.textContent||''));
  if(!anchor) return;
  const holder = document.createElement('div');
  holder.style.cssText = 'margin:8px 0; display:flex; align-items:center; gap:8px;';
  holder.innerHTML = ''
    + '<label style=\"opacity:.8\">Sell probability&nbsp;(%)</label>'
    + '<input id=\"sellProb\" type=\"number\" min=\"0\" max=\"100\" value=\"68\" style=\"width:90px;text-align:center;\">'
    + '<span id=\"sellProbLabel\" style=\"opacity:.7\">Possible (68%)</span>';
  anchor.parentElement.insertBefore(holder, anchor.nextSibling);
  const $prob = holder.querySelector('#sellProb');
  const $lab  = holder.querySelector('#sellProbLabel');
  function bucket(p){ if(p>=90)return 'Very likely'; if(p>=75)return 'Likely'; if(p>=60)return 'Possible'; if(p>=40)return 'Uncertain'; return 'Low'; }
  function applyToRows(pct){
    document.querySelectorAll('.auto-row, .option-row, .use-row, .calc-row').forEach(function(row){
      row.innerHTML = row.innerHTML.replace(/(Possible|Likely|Very likely|Uncertain|Low)\\s*\\(\\d+%?\\)/ig, bucket(pct) + ' (' + pct + '%)');
    });
  }
  $prob.addEventListener('input', function(){
    var v = Math.max(0, Math.min(100, Number($prob.value||0)));
    $prob.value = v; $lab.textContent = bucket(v) + ' (' + v + '%)'; applyToRows(v);
  });
  applyToRows(Number($prob.value));
})();

/* === Counter Offer: editable broker offer + counter workflow ======= */
(function CounterOfferHook(){
  const offerInput =
    document.getElementById('rate') ||
    document.getElementById('offer') ||
    document.querySelector('input[name=\"offer\"], #Offer, .offer-input');
  const offerLabel = offerInput && (offerInput.closest('label') || offerInput.parentElement);
  const calcBtn =
    document.getElementById('btnCalc') ||
    document.querySelector('#calc, .btn-calc, button.calculate');
  if (!offerInput || !offerLabel || !calcBtn) return;
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; align-items:center;';
  wrap.innerHTML = ''
    + '<input id=\"brokerOffer\" type=\"number\" step=\"0.01\" placeholder=\"Broker Offer $\" style=\"width:130px; text-align:center;\">'
    + '<input id=\"counterOffer\" type=\"number\" step=\"0.01\" placeholder=\"Counter Offer $\" style=\"width:140px; text-align:center;\">'
    + '<button id=\"btnCounter\" type=\"button\" style=\"padding:8px 12px;\">Counter-offer</button>'
    + '<span id=\"counterNote\" style=\"opacity:.7; margin-left:6px;\"></span>';
  offerLabel.insertAdjacentElement('afterend', wrap);
  const brokerOffer = wrap.querySelector('#brokerOffer');
  const counterOffer = wrap.querySelector('#counterOffer');
  const btnCounter = wrap.querySelector('#btnCounter');
  const note = wrap.querySelector('#counterNote');
  const syncFromMain = function(){
    const v = Number(offerInput.value || 0);
    if (v && !brokerOffer.value) brokerOffer.value = v;
  };
  syncFromMain();
  brokerOffer.addEventListener('input', function(){
    const v = Number(brokerOffer.value || 0);
    offerInput.value = (isFinite(v) && v > 0) ? v : '';
    note.textContent = v ? ('Using Broker Offer: $' + v.toFixed(2)) : '';
  });
  btnCounter.addEventListener('click', function(){
    const v = Number(counterOffer.value || 0);
    if (!isFinite(v) || v <= 0) { alert('Enter a valid Counter Offer $'); return; }
    offerInput.value = v; offerInput.dataset.mode = 'counter'; note.textContent = 'Counter mode: $' + v.toFixed(2);
    if (typeof calcBtn.click === 'function') calcBtn.click();
  });
  offerInput.addEventListener('input', syncFromMain);
})();

