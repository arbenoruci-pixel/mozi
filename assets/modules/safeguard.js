// assets/modules/safeguard.js — safety net & panic
export function installSafetyNet(opts = {}) {
  const { appName='Smart Freight', keyPrefix='SFT', safeKeys=['GMAPS_API_KEY'], freezeMs=4000, enablePanic=true } = opts;
  const tag = (msg, color, border) => { const d=document.createElement('div'); d.style.cssText=`position:fixed;left:8px;bottom:8px;z-index:2147483647;background:${color};color:#fff;border:1px solid ${border};padding:8px 10px;border-radius:9px;font:12px system-ui;max-width:92vw;white-space:pre-wrap`; d.textContent=msg; document.body.appendChild(d); return d; };
  window.addEventListener('error', e=> tag(`❌ ${appName} JS error: ${e.error?.message || e.message}`, '#7a1b1b', '#f66'));
  window.addEventListener('unhandledrejection', e=> tag(`⚠️ ${appName} promise rejection: ${e.reason?.message || String(e.reason)}`, '#6a5a00', '#ff6'));
  const params=new URLSearchParams(location.search); const SAFE=params.get('safe')==='1' || localStorage.getItem(`${keyPrefix}:SAFE`)==='1';
  if(SAFE){ tag(`🛟 ${appName} SAFE MODE: heavy features disabled`, '#1c3a1c', '#6f6'); document.documentElement.dataset.safeMode='1'; }
  let last=performance.now(); function raf(){ const now=performance.now(); const dt=now-last; if(dt>freezeMs){ tag(`🧊 Main-thread stall (${Math.round(dt)}ms).`, '#263244','#8bd3ff'); } last=now; requestAnimationFrame(raf);} requestAnimationFrame(raf);
  if(enablePanic){ const pill=document.createElement('button'); pill.textContent='SAFE'; Object.assign(pill.style,{position:'fixed', left:'10px', bottom:'10px', zIndex:2147483647, background:'rgba(0,0,0,.85)', color:'#9f9', border:'1px solid #3c3', borderRadius:'14px', padding:'6px 10px', font:'600 12px system-ui', cursor:'pointer'}); pill.title='Panic: stop loops/observers, clear keys, enable SAFE, reload'; pill.onclick=()=>{ try{ for(let i=1;i<16384;i++) clearInterval(i);}catch{} try{ for(let i=1;i<16384;i++) clearTimeout(i);}catch{} try{ (window.__observers||[]).forEach(o=>o.disconnect&&o.disconnect()); window.__observers=[];}catch{} try{ safeKeys.forEach(k=>localStorage.removeItem(k)); }catch{} try{ localStorage.setItem(`${keyPrefix}:SAFE`,'1'); }catch{} location.reload(); }; document.body.appendChild(pill); }
  return { SAFE };
}
export function guard(name, fn, { timeoutMs=8000 } = {}){
  return async (...args)=>{
    const id=setTimeout(()=>{ const d=document.createElement('div'); d.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#402;color:#f88;border:1px solid #f88;padding:8px 10px;border-radius:9px;font:12px system-ui'; d.textContent=`⏱ ${name} timed out.`; document.body.appendChild(d); }, timeoutMs);
    try{ const res=await fn(...args); clearTimeout(id); return res; }catch(err){ clearTimeout(id); const d=document.createElement('div'); d.style.cssText='position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#401;color:#f88;border:1px solid #f88;padding:8px 10px;border-radius:9px;font:12px system-ui;max-width:92vw'; d.textContent=`💥 ${name} failed: ${err.message||err}`; document.body.appendChild(d); throw err; }
  };
}
