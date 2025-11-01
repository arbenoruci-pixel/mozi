// Smart, defensive email parser (minimal for intermodal lanes)
window.moziParseEmail = function (txt="") {
  txt = String(txt).replace(/[\u2013\u2014]/g,'-');
  const whole = txt;

  function pick(re, idx=1){ const m = whole.match(re); return m? (m[idx]||'').trim() : ''; }

  // Try explicit "from .. to .." line first
  let m = whole.match(/(?:lane:?)?\s*from\s+([^\n]+?)\s+to\s+([^\n]+?)(?:$|\n)/i);
  let pickup = (m && m[1] || '').trim();
  let delivery = (m && m[2] || '').trim();

  // Fallback to labeled lines
  if(!pickup)  pickup  = pick(/(?:from|pickup|origin)\s*:\s*([^\n]+)/i);
  if(!delivery)delivery= pick(/(?:to|delivery|dest(?:ination)?)\s*:\s*([^\n]+)/i);

  // Date/time
  const date = pick(/date(?:\/time)?\s*:\s*([^\n]+)/i);
  const time = pick(/(?:time)\s*:\s*([^\n]+)/i);

  // Equipment & Size
  const equipLine = pick(/equipment\s*:\s*([^\n]+)/i);
  let equipment = equipLine || '';
  let size = '';
  const sz = equipLine.match(/\b(20|40|45)\b/);
  if (sz) size = sz[1];
  if (!size && /\b40\b/.test(equipLine)) size='40';

  // All-in (gross) — optional
  let gross = pick(/all-?in\s*:?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i) || '';
  if (gross) gross = Number(gross.replace(/[^0-9.]/g,''));

  return { pickup, delivery, date: date || time || '', equipment, size, gross };
};
