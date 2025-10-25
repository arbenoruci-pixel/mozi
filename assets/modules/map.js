// assets/modules/map.js — safe loader + JS/REST directions with fallback
const KEY_INLINE = (typeof process !== 'undefined' && process.env && process.env.GOOGLE_MAPS_KEY) || "";
import { KEYS } from './storage.js';

function autoKey(){
  try {
    if (typeof location!=='undefined'){
      const m = location.search.match(/[?&]key=([^&]+)/); if (m) return decodeURIComponent(m[1]);
    }
  } catch(_) {}
  try { const meta=document.querySelector('meta[name="google-maps-key"]')?.getAttribute('content'); if(meta) return meta; } catch(_){}
  try { const ls=localStorage.getItem(KEYS?.GMAPS || 'GMAPS_API_KEY'); if(ls) return ls; } catch(_){}
  const g=['NEXT_PUBLIC_GOOGLE_MAPS_KEY','GOOGLE_MAPS_KEY','NEXT_PUBLIC_MAPS_API_KEY','MAPS_API_KEY','NEXT_PUBLIC_GMAPS_KEY','GMAPS_KEY','NEXT_PUBLIC_GOOGLE_API_KEY','GOOGLE_API_KEY','GMAPS'];
  for(const k of g){ try{ if (window[k]) return window[k]; }catch(_){} }
  return KEY_INLINE;
}
function requireKey(){
  let key=autoKey();
  if(!key){ key=prompt('Enter your Google Maps API key (stored locally).'); if(!key) throw new Error('GOOGLE_MAPS_KEY missing'); try{ localStorage.setItem(KEYS?.GMAPS||'GMAPS_API_KEY', key);}catch(_){}} 
  return key;
}
export async function ensureGoogleLoaded(){
  if (window.google && window.google.maps) return;
  if (window.__gmapsLoading){ await waitForMaps(15000); return; }
  window.__gmapsLoading=true;
  const key=requireKey();
  let s=document.querySelector('#gmaps-loader');
  if(!s){ s=document.createElement('script'); s.id='gmaps-loader'; s.async=true; document.head.appendChild(s); }
  const src=`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`;
  if (s.src && s.src.includes('maps.googleapis.com')){ await waitForMaps(15000); return; }
  await new Promise((res,rej)=>{ s.onload=res; s.onerror=()=>rej(new Error('Google Maps failed to load')); s.src=src; });
  await waitForMaps(15000);
}
function waitForMaps(t){ return new Promise((res,rej)=>{ const t0=Date.now(); (function tick(){ if (window.google&&window.google.maps) return res(); if(Date.now()-t0>t) return rej(new Error('Google Maps load timeout')); setTimeout(tick,100); })(); }); }
function decodePolyline(str){ let index=0,lat=0,lng=0,pts=[]; while(index<str.length){ let b,shift=0,result=0; do{ b=str.charCodeAt(index++)-63; result|=(b&0x1f)<<shift; shift+=5;}while(b>=0x20); const dlat=((result&1)?~(result>>1):(result>>1)); lat+=dlat; shift=0; result=0; do{ b=str.charCodeAt(index++)-63; result|=(b&0x1f)<<shift; shift+=5;}while(b>=0x20); const dlng=((result&1)?~(result>>1):(result>>1)); lng+=dlng; pts.push({lat:lat/1e5,lng:lng/1e5}); } return pts; }
async function directionsREST(from,to){
  const key=requireKey();
  const url=new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin',from); url.searchParams.set('destination',to); url.searchParams.set('mode','driving'); url.searchParams.set('key',key);
  let resp; try{ resp=await fetch(url.toString(),{method:'GET'});}catch{ throw new Error('Network error calling Directions REST (possible CORS).'); }
  if(!resp.ok) throw new Error(`Directions HTTP ${resp.status}`);
  const json=await resp.json(); if(json.status!=='OK'){ const err=json.error_message? `${json.status} — ${json.error_message}`:json.status; throw new Error(`Directions: ${err}`); }
  const route=json.routes?.[0]; if(!route) throw new Error('No route returned (REST)');
  const meters=(route.legs||[]).reduce((a,l)=>a+(l.distance?.value||0),0); const seconds=(route.legs||[]).reduce((a,l)=>a+(l.duration?.value||0),0);
  const warnings=route.warnings||[]; const overview_path=route.overview_polyline?.points? decodePolyline(route.overview_polyline.points):[];
  return { distanceMeters: meters, durationSec: seconds, warnings, overview_path };
}
async function directionsJS(from,to,timeoutMs=12000){
  await ensureGoogleLoaded();
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('DirectionsService timeout')), timeoutMs);
    try{
      const ds=new google.maps.DirectionsService();
      const req={ origin:from, destination:to, travelMode:google.maps.TravelMode.DRIVING, provideRouteAlternatives:false };
      ds.route(req,(res,status)=>{
        clearTimeout(timer);
        if(status!=='OK'||!res?.routes?.length) return reject(new Error(`DirectionsService: ${status}`));
        const route=res.routes[0]; const leg=route.legs[0]; const warnings=route.warnings||[];
        const overview_path=(route.overview_path||[]).map(p=>({lat:p.lat(), lng:p.lng()}));
        resolve({ distanceMeters: leg.distance.value, durationSec: leg.duration.value, warnings, overview_path });
      });
    }catch(err){ clearTimeout(timer); reject(err); }
  });
}
export async function getRoute(from,to,{roundTrip=false}={}){
  if(!from||!to) throw new Error('Origin and destination are required');
  let data; try{ data=await directionsJS(from,to);}catch(e){ console.warn('[map] JS directions failed, using REST:', e?.message||e); data=await directionsREST(from,to); }
  if(roundTrip){ data.distanceMeters*=2; data.durationSec*=2; } return data;
}
export async function geocode(text){
  const key=requireKey(); const url=new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address',text); url.searchParams.set('key',key);
  const r=await fetch(url.toString()); if(!r.ok) throw new Error(`Geocode HTTP ${r.status}`);
  const json=await r.json(); if(json.status!=='OK') throw new Error(`Geocode: ${json.status}`);
  const r0=json.results?.[0]; return { formatted:r0.formatted_address, place_id:r0.place_id, location:r0.geometry?.location||null };
}
