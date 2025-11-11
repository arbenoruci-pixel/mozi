export const dynamic = 'force-dynamic';
const map = { btc:'bitcoin', eth:'ethereum', sol:'solana', ada:'cardano', xrp:'ripple' };
function sma(arr, n, i){
  if(i+1<n) return null;
  let s=0; for(let k=i-n+1;k<=i;k++) s+=arr[k]; return s/n;
}
export async function GET(req){
  const { searchParams } = new URL(req.url);
  const sym = (searchParams.get('symbol')||'btc').toLowerCase();
  const id = map[sym] || sym;
  const days = Number(searchParams.get('days')||'14');
  const fast = Number(searchParams.get('fast')||'5');
  const slow = Number(searchParams.get('slow')||'12');
  try{
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`;
    const r = await fetch(url, { next: { revalidate: 0 } });
    const j = await r.json();
    const prices = (j.prices||[]).map(p=>p[1]);
    if(prices.length===0) return new Response(JSON.stringify({ok:false,error:'no data'}),{status:400});
    let pos=null, entry=0, pnl=0, trades=0;
    for(let i=0;i<prices.length;i++){
      const f=sma(prices, fast, i);
      const s=sma(prices, slow, i);
      if(f==null||s==null) continue;
      if(pos===null && f>s){ pos='long'; entry=prices[i]; trades++; }
      else if(pos==='long' && f<s){ pnl += (prices[i]-entry)/entry; pos=null; }
    }
    if(pos==='long'){ pnl += (prices.at(-1)-entry)/entry; pos=null; }
    return new Response(JSON.stringify({ ok:true, id, days, fast, slow, trades, return_pct:+(pnl*100).toFixed(2) }), { headers:{'content-type':'application/json'} });
  }catch(e){
    return new Response(JSON.stringify({ ok:false, error:String(e) }), { status:500, headers:{'content-type':'application/json'} });
  }
}
