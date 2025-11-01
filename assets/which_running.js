(function(){
  const id='which_running_v10';
  if(document.getElementById(id)) return;
  const el=document.createElement('div'); el.id=id;
  el.style.cssText='position:fixed;left:12px;bottom:12px;background:#052313;color:#bfffd0;border:1px solid #1b3f2a;padding:8px 10px;border-radius:10px;font:12px system-ui;z-index:99999;max-width:60vw;';
  const scripts=[...document.scripts].map(s=>s.src||'(inline)').filter(Boolean);
  el.innerHTML='<b>Loaded scripts</b><br>'+scripts.map(s=>s.split('/').pop()).join('<br>');
  document.addEventListener('DOMContentLoaded',()=>document.body.appendChild(el));
})();