export const dynamic = 'force-dynamic';
const map = { btc:'bitcoin', eth:'ethereum', sol:'solana', ada:'cardano', xrp:'ripple' };
export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sym = (searchParams.get('symbol')||'btc').toLowerCase();
  const id = map[sym] || sym;
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`;
  try {
    const r = await fetch(url, { next: { revalidate: 0 } });
    const j = await r.json();
    const usd = j[id]?.usd ?? null;
    return new Response(JSON.stringify({ ok: true, id, usd }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok:false, error: String(e) }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
}
