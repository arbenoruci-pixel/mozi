// /api/ai_contra_offer.js — heuristic + placeholder AI hook
module.exports = async (req, res) => {
  try{
    if(req.method !== 'POST') { res.status(405).json({error:'Use POST'}); return; }
    const body = typeof req.body === 'string' ? JSON.parse(req.body||'{}') : (req.body||{});
    const { miles=0, gross=0, equipment='', containerSize='', laneType='' } = body;
    function heuristicPerMile(m,e,s,l){
      let base = /ramp|port|rail/i.test(l)? 2.6 : 2.2;
      if(m<120) base += 0.25;
      if(m>500) base -= 0.10;
      if(/power only/i.test(e)) base -= 0.10;
      if(String(s)==='20') base -= 0.05;
      if(String(s)==='45') base += 0.05;
      return Math.max(base, 1.4);
    }
    function splitOn(grossVal, carrier){
      const wall10 = 0.10 * (Number(grossVal)||0);
      const profit = Math.max((Number(grossVal)||0) - wall10 - (Number(carrier)||0), 0);
      return { carrier: Math.round(carrier), wall10: Math.round(wall10), profit: Math.round(profit), narta80: Math.round(profit*0.80), lex20: Math.round(profit*0.20) };
    }
    const perMi = heuristicPerMile(Number(miles)||0, equipment, containerSize, laneType);
    const marketCarrier = perMi * (Number(miles)||0);
    const tiers = [
      { tier:'Fast Sell', win:0.85, ...splitOn(gross, Math.max(marketCarrier*0.94, 250)) },
      { tier:'Target',    win:0.65, ...splitOn(gross, Math.max(marketCarrier*1.00, 300)) },
      { tier:'Stretch',   win:0.40, ...splitOn(gross, Math.max(marketCarrier*1.06, 350)) },
    ];
    res.status(200).json({ tiers, debug:{ perMi, marketCarrier, from:'heuristic' } });
  }catch(e){
    res.status(500).json({error: String(e&&e.message || e)});
  }
};