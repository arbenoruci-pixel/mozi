export default function Home() {
  return (
    <main>
      <h1 style={{fontSize:44, lineHeight:1.05, margin:'0 0 8px'}}>MOZI — Deployed Correctly ✅</h1>
      <p style={{opacity:0.8, marginTop:0}}>Clean Next.js base with crypto endpoints.</p>
      <ul>
        <li><a href="/crypto">/crypto</a></li>
        <li><a href="/api/health">/api/health</a></li>
      </ul>
      <div style={{marginTop:24, padding:16, background:'#121212', borderRadius:10}}>
        <p style={{margin:0, opacity:0.8}}>Try <code>/api/price?symbol=btc</code> or <code>/api/paper?symbol=btc&days=14&fast=5&slow=12</code></p>
      </div>
    </main>
  );
}
