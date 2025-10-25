
export default async function handler(req, res){
  try{
    const key = process.env.SERPAPI_KEY || '48b987684e5011c8b16d462570f0346f3288b2fa45f218616690bf14e8b791e7';
    const qraw = req.query.q || '{}';
    const args = JSON.parse(qraw);
    const focusCity  = (args.city||'').trim();
    const focusState = (args.state||'').trim();
    const sizes      = Array.isArray(args.sizes) ? args.sizes.map(String) : ['20','40','45'];
    const minScore   = Number(args.minScore||0);
    const scrape     = !!args.scrape;

    var sizeExpr = '(' + sizes.map(function(s){ return '"' + s + "'"; }).join(' OR ') + ')';
    var baseQuery = [
      '(freight forwarder OR NVOCC OR "non-vessel" OR "ocean freight")',
      '(FCL OR "full container load")',
      sizeExpr,
      '"container"'
    ].join(' ');

    const cities = focusCity ? [(focusCity + ' ' + (focusState||'')).trim()] : [
      'Los Angeles CA','Long Beach CA','Oakland CA','Seattle WA','Tacoma WA','Portland OR',
      'New York NY','Newark NJ','Elizabeth NJ','Savannah GA','Charleston SC','Norfolk VA',
      'Miami FL','Jacksonville FL','Houston TX','New Orleans LA','Chicago IL','Dallas TX'
    ];

    const all = [];
    for (let i=0; i<cities.length; i++){
      const city = cities[i];
      const url = new URL('https://serpapi.com/search.json');
      url.searchParams.set('engine','google');
      url.searchParams.set('api_key', key);
      url.searchParams.set('num','8');
      url.searchParams.set('q', baseQuery + ' "' + city + '"');
      const r = await fetch(url); const data = await r.json();
      const results = (data.organic_results||[]).map(function(x){
        return { title: x.title, link: x.link, displayed_link: x.displayed_link, snippet: x.snippet, city: city, state: (city.split(' ').pop()||'') };
      });
      Array.prototype.push.apply(all, results);
    }

    const seen = new Set(); const dedup=[];
    for (let i=0;i<all.length;i++){
      const it = all[i];
      const host = (function(u){ try{ return new URL(u).hostname; }catch(e){ return ''; } })(it.link||'').replace(/^www\./,'');
      if(!host) continue;
      if((/facebook|linkedin|indeed|glassdoor|yelp|mapquest|map\.google|bloomberg|crunchbase|yellowpages|bbb\.org|zoominfo/i).test(host)) continue;
      if(seen.has(host)) continue;
      seen.add(host); dedup.push(Object.assign({host:host}, it));
    }

    if(scrape){
      await Promise.all(dedup.map(async function(it){
        try{
          const r = await fetch(it.link, {redirect:'follow'});
          const html = await r.text();
          const spaceSafe = html.slice(0, 400000);
          const emails = Array.from(new Set((spaceSafe.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]))).slice(0,3);
          const phones = Array.from(new Set((spaceSafe.match(/\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g)||[]))).slice(0,3);
          const tags = (function(h){
            const t=[];
            if(/\bFMC\b/i.test(h)) t.push('FMC');
            if(/\bNVOCC\b/i.test(h)) t.push('NVOCC');
            if(/\bFCL\b/i.test(h)) t.push('FCL');
            if(/\b(LCL|less than container)/i.test(h)) t.push('LCL');
            if(/\b20[\'’]\b/i.test(h)) t.push("20'");
            if(/\b40[\'’]\b/i.test(h)) t.push("40'");
            if(/\b45[\'’]\b/i.test(h)) t.push("45'");
            if(/\bocean\b/i.test(h)) t.push('ocean');
            if(/\bcontainer\b/i.test(h)) t.push('container');
            return t;
          })(spaceSafe);
          it.emails = emails; it.phones = phones; it.tags = tags;
        }catch(e){}
      }));
    }

    function scoreItem(it){
      var s=0; var text = (it.title||'')+' '+(it.snippet||'')+' '+((it.tags||[]).join(' '));
      if(/\bNVOCC\b/i.test(text)) s+=35;
      if(/\bFMC\b/i.test(text))   s+=30;
      if(/\bFCL\b/i.test(text))   s+=20;
      if(/\bocean\b/i.test(text)) s+=15;
      if(/20[\'’]|40[\'’]|45[\'’]/i.test(text)) s+=10;
      if((it.emails||[]).length) s+=10;
      if((it.phones||[]).length) s+=10;
      return Math.min(100, s);
    }

    const scored = dedup.map(function(it){ it.score = scoreItem(it); return it; });
    const filtered = scored.filter(function(x){ return (x.score||0) >= minScore; }).sort(function(a,b){ return (b.score||0)-(a.score||0); });

    return res.status(200).json({ok:true, count: filtered.length, items: filtered});
  }catch(e){
    return res.status(500).json({ok:false, error: String(e)});
  }
}
