// assets/modules/pricing.js — hardened pricing & long-haul logic (kept for compatibility)
function num(x,d=0){ const n=Number(x); return Number.isFinite(n)?n:d; }
function ceil0(v){ return Math.max(0, Math.ceil(v)); }
export function suggestQuotes({ milesOneWay, roundTrip, brokerAllIn, fuelPerMile, driverPerMile, fixedCosts, deduction, longhaul }){
  const miles1=Math.max(0, num(milesOneWay,0)); const isRT=!!roundTrip; const totalMiles=isRT? miles1*2 : miles1;
  const fuelPM=Math.max(0,num(fuelPerMile,0)); const driverPM=Math.max(0,num(driverPerMile,0)); const fixed=Math.max(0,num(fixedCosts,0));
  const ded={ lex:Math.min(100,Math.max(0,num(deduction?.lex,10))), narta:Math.min(100,Math.max(0,num(deduction?.narta,80))), contractor:Math.min(100,Math.max(0,num(deduction?.contractor,20))) };
  const lh={ threshold:Math.max(0,num(longhaul?.threshold,250)), premium:Math.max(0,num(longhaul?.premium,0.10)) };
  const fuel=fuelPM*totalMiles; const driver=driverPM*totalMiles; const baseCost=fuel+driver+fixed;
  const lexF=(100-ded.lex)/100, nartaF=ded.narta/100, contrF=ded.contractor/100;
  const overOneWay=Math.max(0, miles1 - lh.threshold); const legs=isRT?2:1; const longHaulAdd=overOneWay*lh.premium*legs;
  const targets=[80,150,300];
  const rows=targets.map(p=>{
    const denom=Math.max(1e-6,(lexF*nartaF)); const Rraw=(Math.max(0,p)+baseCost-longHaulAdd)/denom; const R=ceil0(Rraw);
    const afterLex=R*lexF; const nartaShare=afterLex*nartaF; const contractor=afterLex*contrF; const profit=Math.round(nartaShare-baseCost+longHaulAdd); const lexTaken=Math.round(R-afterLex);
    const effDpm=(totalMiles>0)?(R/totalMiles):0;
    return { label:`Target +$${p}`, quote:R, miles:totalMiles, eff: effDpm.toFixed(2), profit, baseCost:Math.round(baseCost), lexTaken, nartaShare:Math.round(nartaShare), contractorShare:Math.round(contractor), longHaulAdd:Math.round(longHaulAdd) };
  });
  const broker=num(brokerAllIn,0);
  if(broker>0){
    const afterLex=broker*lexF; const nartaShare=afterLex*nartaF; const contractor=afterLex*contrF; const profit=Math.round(nartaShare-baseCost+longHaulAdd); const effDpm=(totalMiles>0)?(broker/totalMiles):0;
    rows.unshift({ label:'Broker all-in', quote:ceil0(broker), miles:totalMiles, eff:effDpm.toFixed(2), profit, baseCost:Math.round(baseCost), lexTaken:Math.round(broker-afterLex), nartaShare:Math.round(nartaShare), contractorShare:Math.round(contractor), longHaulAdd:Math.round(longHaulAdd) });
  }
  return rows;
}
