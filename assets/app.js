// shared helpers
window.$ = (s)=>document.querySelector(s);
window.$$ = (s)=>Array.from(document.querySelectorAll(s));
window.round2 = (n)=>Math.round((Number(n)||0)*100)/100;
