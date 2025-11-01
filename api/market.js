export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({error:'Use POST'});
    const {
      miles = 0, roundTrip = false, customerGross, baseCPM = 3.10,
      wallPct = 0.10, split = { narta: 0.80, lex: 0.20 }
    } = req.body || {};

    const usedMiles = roundTrip ? miles * 2 : miles;
    const gross = (typeof customerGross === 'number' && !Number.isNaN(customerGross))
      ? customerGross : Math.round(usedMiles * baseCPM);

    const cpm = req.body.cpmOverride || { fast:3.40, target:3.25, stretch:3.05 };
    const win = { fast: 78, target: 55, stretch: 32 };

    const tiers = [ 'fast','target','stretch' ].map(key => {
      const carrier = Math.round(usedMiles * cpm[key]);
      const wall = Math.round(gross * wallPct);
      const profit = Math.max(0, gross - wall - carrier);
      const narta = Math.round(profit * split.narta);
      const lex   = Math.round(profit * split.lex);
      const tierName = key==='fast'?'Fast Sell': key==='target'?'Target':'Stretch';
      return { tier: tierName, win: win[key], carrier, wall, profit, narta, lex };
    });

    res.status(200).json({ usedMiles, gross, wallPct, split, cpm, tiers });
  } catch (e) { res.status(500).json({ error: String(e) }); }
}