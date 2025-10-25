// assets/modules/parser.js — fast, non-freezing intermodal parser
const MAX_LEN = 8000; const WINDOW = 80; const MAX_ADDR_CANDIDATES = 12;
function clean(s){ return (s || "").replace(/\s+/g, " ").slice(0, MAX_LEN).trim(); }
function extractPrice(t){
  let best=0, m; const re=/\$?\s*([0-9]{2,6}(?:[.,][0-9]{2})?)\s*k?/ig;
  while((m=re.exec(t)) && re.lastIndex<=MAX_LEN){
    const raw=m[0].toLowerCase().replace(/[^\dk.]/g,""); let val=0;
    if (raw.endsWith("k")) val = Number(raw.slice(0,-1))*1000; else val = Number(raw.replace(/,/g,""));
    if (Number.isFinite(val)) best=Math.max(best,val);
  } return best||null;
}
function extractWhen(t){ const low=t.toLowerCase();
  if (/\btomorrow\b/.test(low)) return "tomorrow"; if (/\btoday\b/.test(low)) return "today";
  const m1=low.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*\d{1,2}\b/i); if(m1) return m1[0];
  const m2=low.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/); if(m2) return m2[0]; return null; }
function extractEquip(t){
  const m=t.match(/\b((?:20|40|45)\s*(?:ft|foot)?\s*container|iso\s*container|intermodal|power\s*only|chassis)\b/i);
  if(m) return m[0].replace(/['’]/g,"'").trim();
  const m2=t.match(/\b(53['’]?\s*(?:container|dry\s*van|trailer|reefer))\b/i);
  return m2? m2[0].replace(/['’]/g,"'").trim() : null;
}
const CITY_STATE=/[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\s*\d{5})?/g;
function findAddressCandidates(t){
  const out=[]; let m,count=0; while((m=CITY_STATE.exec(t)) && count<MAX_ADDR_CANDIDATES){ out.push({text:m[0], index:m.index, end:m.index+m[0].length}); count++; } return out;
}
function scorePickupDelivery(t,c){
  const before=t.slice(Math.max(0,c.index-WINDOW), c.index).toLowerCase();
  const after =t.slice(c.end, c.end+WINDOW).toLowerCase();
  const pickupScore=(/\bpick(?:ing)?\s*up\b|\borigin\b|\bfrom\b/.test(before+after)?2:0)+(/\bin\b|\bat\b/.test(before)?1:0);
  const deliveryScore=(/\bdeliver(?:ing)?\s*(?:to|at)?\b|\bdrop(?:\s*at)?\b|\bdestination\b/.test(before+after)?2:0)+(/\bto\b/.test(after)?1:0);
  return { pickupScore, deliveryScore };
}
export function parseEmail(textRaw){
  const t=clean(textRaw); if(!t) return {};
  const combo=t.match(/picking up\s+(?:in|at)?\s*([A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\s*\d{5})?).*?(?:delivering|delivery|to)\s+([A-Z][A-Za-z .'-]+,\s*[A-Z]{2}(?:\s*\d{5})?)/i);
  let pickup=null, delivery=null;
  if(combo){ pickup=combo[1].trim(); delivery=combo[2].trim(); }
  else {
    const cands=findAddressCandidates(t);
    if(cands.length){
      const scored=cands.map(c=>({...c,...scorePickupDelivery(t,c)}));
      scored.sort((a,b)=>(b.pickupScore-a.pickupScore)||(a.index-b.index)); pickup=(scored[0]?.pickupScore?scored[0].text:cands[0].text);
      scored.sort((a,b)=>(b.deliveryScore-a.deliveryScore)||(b.index-a.index)); delivery=(scored[0]?.deliveryScore?scored[0].text:cands[cands.length-1].text);
    }
  }
  return { pickup: pickup||null, delivery: delivery||null, when: extractWhen(t), equip: extractEquip(t), rate: extractPrice(t) };
}
