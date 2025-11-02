
(function(){
  const $ = (s)=>document.querySelector(s);
  const tbody = $('#pipe_tbody');
  const fStatus = $('#f_status');
  const fQ = $('#f_q');
  const PIPE_KEY = 'pipeline_v2';

  function load(){ try { return JSON.parse(localStorage.getItem(PIPE_KEY)||'[]'); } catch { return []; } }

  function render(){
    const q = (fQ.value||'').toLowerCase();
    const s = fStatus.value||'';
    const items = load().filter(it=>{
      const okS = s? (it.status===s) : true;
      const okQ = q? (`${it.from} ${it.to}`.toLowerCase().includes(q)) : true;
      return okS && okQ;
    });
    tbody.innerHTML='';
    items.forEach(it=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="small">${new Date(it.ts).toLocaleString()}</td>
        <td><span class="status">${it.status}</span></td>
        <td>${it.from} → ${it.to}</td>
        <td>${(it.size||'')}'</td>
        <td>${it.miles||0}</td>
        <td class="right">$${(it.gross||0).toFixed(0)}</td>
        <td class="right">$${(it.carrier||0).toFixed(0)}</td>
        <td class="right">$${(it.profit||0).toFixed(0)}</td>
        <td>${Math.round((it.win||0)*100)}%</td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.addEventListener('DOMContentLoaded', render);
  fStatus?.addEventListener('change', render);
  fQ?.addEventListener('input', render);

  // export JSON
  const btnExport = document.getElementById('btn_export');
  btnExport?.addEventListener('click', ()=>{
    const blob = new Blob([ JSON.stringify(load(), null, 2) ], {type:'application/json'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'pipeline.json'; a.click();
  });
})();
