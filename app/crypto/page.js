'use client'
import { useState } from 'react'
export default function Crypto() {
  const [symbol, setSymbol] = useState('btc')
  const [price, setPrice] = useState(null)
  const [bt, setBt] = useState(null)
  const [loading, setLoading] = useState(false)
  async function fetchPrice() {
    setLoading(true); setPrice(null);
    const r = await fetch(`/api/price?symbol=${symbol}`)
    const j = await r.json(); setPrice(j); setLoading(false);
  }
  async function backtest() {
    setLoading(true); setBt(null);
    const r = await fetch(`/api/paper?symbol=${symbol}&days=14&fast=5&slow=12`)
    const j = await r.json(); setBt(j); setLoading(false);
  }
  return (
    <main>
      <h1>Crypto Console</h1>
      <div style={{display:'flex', gap:8, alignItems:'center'}}>
        <label>Symbol:</label>
        <input value={symbol} onChange={e=>setSymbol(e.target.value)} style={{background:'#111', color:'#fff', border:'1px solid #333', padding:'6px 8px', borderRadius:6}} />
        <button onClick={fetchPrice} disabled={loading} style={{padding:'6px 10px', borderRadius:6}}>Get Price</button>
        <button onClick={backtest} disabled={loading} style={{padding:'6px 10px', borderRadius:6}}>SMA Backtest</button>
      </div>
      {price && <pre style={{marginTop:16, background:'#121212', padding:12, borderRadius:8}}>{JSON.stringify(price,null,2)}</pre>}
      {bt && <pre style={{marginTop:16, background:'#121212', padding:12, borderRadius:8}}>{JSON.stringify(bt,null,2)}</pre>}
    </main>
  )
}
