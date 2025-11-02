// Tiny loader list helper
(function(){
  try{
    const list = Array.from(document.querySelectorAll('script[src]')).map(s=>s.getAttribute('src'));
    const wrap = document.createElement('div');
    wrap.style.cssText='position:fixed;left:10px;bottom:12px;background:#081;border:2px solid #0f4;padding:8px 10px;color:#fff;font:12px/1.3 monospace;z-index:99999;border-radius:9px;max-width:88vw;';
    wrap.innerHTML = '<b>Loaded scripts</b><br>'+list.map(s=>s.replace(location.origin,'')).join('<br>');
    document.body.appendChild(wrap);
    setTimeout(()=>wrap.remove(), 5000);
  }catch{}
})();