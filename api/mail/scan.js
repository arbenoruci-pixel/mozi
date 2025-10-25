// /api/mail/scan.js — IMAP scan with credentials (NO STORAGE).
// Security notes:
// - This endpoint accepts IMAP credentials in the POST body and does NOT store them.
// - For Gmail, use an *App Password* (recommended) or OAuth2 (not implemented here).
// - Do NOT log credentials. Make sure Vercel logs are disabled for body printing.
import { ImapFlow } from 'imapflow';

const HOST_PRESETS = {
  gmail:   { host: 'imap.gmail.com', port: 993, secure: true },
  outlook: { host: 'outlook.office365.com', port: 993, secure: true },
  yahoo:   { host: 'imap.mail.yahoo.com', port: 993, secure: true }
};

function stripHtml(html=''){ return html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim(); }
function firstNonEmpty(...xs){ for(const x of xs){ if(x && String(x).trim()) return String(x).trim(); } return ''; }

// Basic parser (pickup/delivery/when/equip/price) — same as before, trimmed for brevity
function extractPrice(t){
  let best=0, m; const re=/\$?\s*([0-9]{2,6}(?:[.,][0-9]{2})?)\s*k?/ig;
  while((m=re.exec(t))){ let raw=m[0].toLowerCase().replace(/[^\dk.]/g,''); 
    let val=raw.endsWith('k')? Number(raw.slice(0,-1))*1000 : Number(raw.replace(/,/g,'')); 
    if(Number.isFinite(val)) best=Math.max(best,val);
  } return best||null;
}
function extractWhen(t){
  const re=/(today|tomorrow|asap|now|tonight|\b\d{1,2}\/\d{1,2}\b|\bmon|tue|wed|thu|fri|sat|sun\b)/i;
  const m=re.exec(t); return m? m[0] : null;
}
function extractEquip(t){
  const re=/(53['’]?\s*(?:van|dry)|container|intermodal|20['’]|40['’]|45['’])/i;
  const m=re.exec(t); return m? m[0] : null;
}

// --- Intermodal-specialized helpers ---
const RAMP_WORDS = [
  // BNSF / NS / CSX / UP / CP common Chicago ramps & abbreviations
  'BNSF CORWITH','BNSF LPC','LOGISTICS PARK CHICAGO','ELWOOD','JOLIET','UP GLOBAL 2','UP GLOBAL 3','UP GLOBAL 4',
  'NS 47TH','NS 63RD','LANDERS','CSX BEDFORD PARK','CSX59','CSX 59TH','CP BENSENVILLE','CP63','IITF','HARVEY',
  // Generic ramp words
  'RAMP','RAIL','TERMINAL','PORT','PIER'
];

const CITY_HINTS = [
  // prioritize user’s common area + Midwest intermodal
  'CHICAGO','BEDFORD PARK','ELWOOD','JOLIET','AURORA','BENSENVILLE','HARVEY',
  'GREEN BAY','MILWAUKEE','MADISON','MINNEAPOLIS','ST PAUL','LINCOLN','OMAHA',
  'GARY','FORT WAYNE','INDIANAPOLIS','DETROIT','TOLEDO','CLEVELAND'
];

function detectContainerSize(t){
  const s = t.toUpperCase();
  if (/\b45['’"]?\b/.test(s)) return 45;
  if (/\b40['’"]?\b/.test(s)) return 40;
  if (/\b20['’"]?\b/.test(s)) return 20;
  // fallbacks: "forty", "twenty"
  if (/\bFORTY\b/.test(s)) return 40;
  if (/\bTWENTY\b/.test(s)) return 20;
  return null;
}

function detectIntermodalEquip(t){
  const s = t.toUpperCase();
  if (/\b(CONTAINER|INTERMODAL|PORT|RAIL|DRAY|CHASSIS|ISO)\b/.test(s)) return 'container';
  if (/\bPOWER\s*ONLY\b/.test(s)) return 'power only';
  return null;
}

function detectRamps(t){
  const s = t.toUpperCase();
  const hits = [];
  for (const word of RAMP_WORDS){
    if (s.includes(word)) hits.push(word);
  }
  return hits;
}

function detectFees(t){
  const s = t.toUpperCase();
  return {
    prepull: /\bPRE[-\s]?PULL\b|\bPREPULL\b/.test(s),
    storage: /\bSTORAGE\b/.test(s),
    chassis: /\bCHASSIS\b/.test(s),
    detention: /\bDETENTION\b/.test(s),
    layover: /\bLAYOVER\b/.test(s)
  };
}

function improvedPickupDelivery(t){
  // Try patterns like "City, ST to City, ST" first
  const re = /([A-Z][A-Z.\- '\u00C0-\u017F]+,\s*[A-Z]{2})\s+(?:TO|→|->)\s+([A-Z][A-Z.\- '\u00C0-\u017F]+,\s*[A-Z]{2})/i;
  const m = re.exec(t);
  if (m) return { pickup: m[1].trim(), delivery: m[2].trim() };
  // Fallback to previous simple split
  return guessPickupDelivery(t);
}

function intermodalRank({pickup,delivery,rate,when,equip,sizeFt,ramps,fees}){
  let score = 0;
  let notes = [];

  // Equipment & size
  if (equip === 'container') { score += 4; notes.push('intermodal'); }


// --- Freight forwarder / broker detection & ports ---
const KNOWN_BROKER_DOMAINS = [
  // Big brokers (examples)
  'jbhunt.com','jb-hunt.com','coyote.com','coyote.logistics','xpo.com','rxo.com',
  'tql.com','schneider.com','kuehne-nagel.com','kuehne.com','convoy.com','uber.com',
  'chrobinson.com','robinson.com'
];

const KNOWN_FORWARDER_DOMAINS = [
  // Common freight forwarder / NVOCC patterns — add more over time
  'expeditors.com','dhl.com','dhlglobalforwarding.com','kuehne-nagel.com','dbschenker.com',
  'flexport.com','cma-cgm.com','maersk.com','msc.com','hapag-lloyd.com','one-line.com',
  'coscon.com','yangming.com','evergreen-line.com','zimm.com','zim.com','hmm21.com'
];

const FORWARDER_KEYWORDS = [
  'freight forwarder','forwarding','nvo','nvocc','ocean export','ocean import','international',
  'mawb','hawb','mbl','hbl','isf','ams','hscodes','house bill','master bill','steamship'
];

const PORT_WORDS = [
  // US ports (common)
  'PORT NEWARK','PORT ELIZABETH','NY/NJ','ELIZABETH MARINE TERMINAL','GCT BAYONNE',
  'PORT OF SAVANNAH','GARDEN CITY TERMINAL','PORT OF CHARLESTON','WANDO WELCH','NORTH CHARLESTON',
  'PORT OF NORFOLK','VIRGINIA INTERNATIONAL GATEWAY','NORFOLK INTERNATIONAL TERMINALS',
  'PORT OF LOS ANGELES','PORT OF LONG BEACH','LONG BEACH CONTAINER TERMINAL','PIER T','PIER A','PIER E',
  'PORT OF HOUSTON','BAYPORT','BARBOURS CUT','PORT OF OAKLAND','PORT OF SEATTLE','PORT OF TACOMA',
  'PORT OF MIAMI','PORT EVERGLADES','PORT OF BALTIMORE'
];

function detectPorts(t){
  const s = t.toUpperCase();
  const hits = [];
  for (const word of PORT_WORDS){
    if (s.includes(word)) hits.push(word);
  }
  return hits;
}

function classifySender(from, body){
  const f = (from||'').toLowerCase();
  const bodyL = (body||'').toLowerCase();

  const isBrokerDomain = KNOWN_BROKER_DOMAINS.some(d=> f.includes(d));
  const isFwdDomain    = KNOWN_FORWARDER_DOMAINS.some(d=> f.includes(d));
  const hasFwdWords    = FORWARDER_KEYWORDS.some(k=> bodyL.includes(k));

  if (isFwdDomain || hasFwdWords) return { type: 'freight_forwarder', color: 'green' };
  if (isBrokerDomain) return { type: 'broker', color: 'orange' };

  // Heuristic: if email mentions steamship/ocean docs or HS codes, treat as forwarder
  if (/\b(steamship|ocean\s+export|ocean\s+import|hscodes|house\s+bill|master\s+bill|nvocc)\b/i.test(body||'')) {
    return { type: 'freight_forwarder', color: 'green' };
  }
  return { type: 'unknown', color: 'gray' };
}

  if (sizeFt) { score += (sizeFt===45?4:(sizeFt===40?3:2)); notes.push(sizeFt+'ft'); }

  // Ramps / rail terms
  if (ramps && ramps.length){ score += Math.min(4, ramps.length); notes.push('ramp'); }

  // Timing
  if (when && /TODAY|ASAP|NOW|TONIGHT/i.test(String(when))) { score += 2; notes.push('urgent'); }

  // Fees that matter (not negative, just signals intermodal reality)
  if (fees.chassis) score += 1;
  if (fees.prepull) score += 1;

  // Rate heuristic: favor >= $500 flat when no miles known
  if (Number(rate) >= 500) score += 2;

  // City hints (bonus if around Chicago & Midwest)
  const inMidwest = (pickup && CITY_HINTS.some(c=> (pickup.toUpperCase().includes(c)))) ||
                    (delivery && CITY_HINTS.some(c=> (delivery.toUpperCase().includes(c))));
  if (inMidwest) score += 1;

  let band = 'MAYBE';
  if (score >= 8) band = 'DOABLE';
  else if (score <= 2) band = 'SKIP';
  return { score, band, notes };
}

function guessPickupDelivery(t){
  // VERY simple split hints
  const parts = t.split(/\bto\b|\b→\b|-\>/i);
  const pickup = parts[0]?.trim();
  const delivery = parts[1]?.trim();
  return { pickup, delivery };
}

// Rank stub (can refine later)
function rankIntermodal({pickup,delivery,rate,when,equip}){
  let score=0, band='MAYBE';
  if (rate && rate>=300) score += 5;
  if (/container|intermodal|20|40|45/i.test([pickup,delivery,when,equip].join(' '))) score += 3;
  if (when && /today|asap|now/i.test(when)) score += 2;
  if (score>=7) band='DOABLE'; else if (score<=2) band='SKIP';
  return { score, band };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok:false, error: 'Use POST with JSON body.' });
    }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const {
      preset = 'gmail',                 // or 'outlook' / 'yahoo' or custom
      host, port, secure,
      user, pass,
      mailbox = 'INBOX',
      sinceDays = 3,
      limit = 50,
      fromFilter = ''                   // optional filter by sender substring
    } = body;

    if (!user || !pass) {
      return res.status(400).json({ ok:false, error: 'Missing user or pass.' });
    }
    const conn = HOST_PRESETS[preset] || {
      host: host || 'imap.gmail.com',
      port: Number(port ?? 993),
      secure: typeof secure === 'boolean' ? secure : true
    };

    const client = new ImapFlow({
      host: conn.host,
      port: conn.port,
      secure: conn.secure,
      auth: { user, pass }
    });

    await client.connect();
    const lock = await client.getMailboxLock(mailbox);

    try {
      const sinceDate = new Date(Date.now() - Math.max(1, sinceDays) * 864e5);
      const query = { since: sinceDate };
      const uids = [];
      for await (const msg of client.fetch(query, { uid: true, envelope: true, bodyStructure: true, source: false })) {
        uids.push(msg.uid);
      }
      uids.sort((a,b)=> b-a);
      const slice = uids.slice(0, Math.max(1, Math.min(200, limit)));

      const items = [];
      for (const uid of slice) {
        const { envelope } = await client.fetchOne(uid, { envelope: true });
        const from = (envelope?.from?.map(p=> firstNonEmpty(p.name, p.address)).join(', ') || '').trim();
        if (fromFilter && !from.toLowerCase().includes(String(fromFilter).toLowerCase())) continue;

        const parts = await client.fetchOne(uid, { source: true, bodyStructure: true });
        // Try text/plain → text/html → fallback
        let txt = '';
        if (parts.bodyStructure) {
          const plain = parts.bodyStructure.childNodes?.find(p=>/text\/plain/i.test(p.type));
          const html  = parts.bodyStructure.childNodes?.find(p=>/text\/html/i.test(p.type));
          if (plain) {
            const { content } = await client.download(uid, plain.part);
            txt = await streamToString(content);
          } else if (html) {
            const { content } = await client.download(uid, html.part);
            txt = stripHtml(await streamToString(content));
          }
        }
        if (!txt && parts.source) {
          txt = String(parts.source);
        }
        const subject = envelope?.subject || '';
        const bodyText = (subject + '\n' + txt).slice(0, 100000);

        // Quick parse
        const price = extractPrice(bodyText);
        const when  = extractWhen(bodyText);
        const equip = extractEquip(bodyText);
        const { pickup, delivery } = guessPickupDelivery(bodyText);

        const sizeFt = detectContainerSize(bodyText);
        const ramps = detectRamps(bodyText);
        const fees = detectFees(bodyText);
        const equip2 = detectIntermodalEquip(bodyText) || equip;
        const pd = improvedPickupDelivery(bodyText);
        const ports = detectPorts(bodyText);
        const kind = classifySender(from, bodyText);
        const rank = intermodalRank({ pickup: pd.pickup||pickup, delivery: pd.delivery||delivery, rate: price, when, equip: equip2, sizeFt, ramps, fees });
        items.push({
          uid, from, subject, price, when, equip: equip2, sizeFt, ramps, fees, ports,
          pickup: (pd.pickup||pickup), delivery: (pd.delivery||delivery),
          senderType: kind.type, colorHint: kind.color,
          rank
        });
      }

      await client.logout();

      items.sort((a,b)=> b.rank.score - a.rank.score);
      const doable = items.filter(x=>x.rank.band==='DOABLE').slice(0,50);
      const maybe  = items.filter(x=>x.rank.band==='MAYBE').slice(0,50);
      const skip   = items.filter(x=>x.rank.band==='SKIP').slice(0,50);

      res.setHeader('Cache-Control','no-store');
      return res.status(200).json({ ok:true, counts:{ doable:doable.length, maybe:maybe.length, skip:skip.length }, doable, maybe, skip });
    } finally {
      lock.release();
    }
  } catch (err) {
    return res.status(500).json({ ok:false, error: err?.message || String(err) });
  }
}

// helpers
async function streamToString(stream) {
  const chunks = [];
  for await (const ch of stream) chunks.push(Buffer.from(ch));
  return Buffer.concat(chunks).toString('utf8');
}
