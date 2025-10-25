// assets/modules/guard.js — watchdog auto-reloader
export function startWatchdog(label='ParserGuard'){
  let last=performance.now(); let frozenCount=0;
  const check=()=>{ const now=performance.now(); const delta=now-last; if(delta>1500){ frozenCount++; console.warn(`${label}: stall ${Math.round(delta)}ms`); if(frozenCount>=2){ const msg=document.createElement('div'); msg.textContent='⚠️ App paused — auto-recovering…'; msg.style.cssText='position:fixed;bottom:10px;left:10px;padding:8px 12px;background:#ff3b30;color:#fff;border-radius:6px;font-size:13px;z-index:999999;'; document.body.appendChild(msg); setTimeout(()=>msg.remove(),4000); location.reload(); } } else { frozenCount=0; } last=now; requestAnimationFrame(check); };
  requestAnimationFrame(check); console.log(`${label} started`);
}
