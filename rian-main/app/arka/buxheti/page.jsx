'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { dbGetOpenDay, dbOpenDay, dbCloseDay, dbListMoves, dbAddMove } from "@/lib/arkaDb";

const fmtEur = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2 });

export default function ArkaCashPage() {
  const [user, setUser] = useState(null);
  const [day, setDay] = useState(null);
  const [moves, setMoves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Load user session
  useEffect(() => {
    const raw = localStorage.getItem('arka_user') || localStorage.getItem('CURRENT_USER_DATA');
    if (raw) setUser(JSON.parse(raw));
  }, []);

  // Refresh data when user is available
  useEffect(() => {
    if (user) refresh();
  }, [user]);

  async function refresh() {
    setLoading(true);
    try {
      // Fetches only if handoff_status is 'OPEN'
      const d = await dbGetOpenDay();
      setDay(d);
      if (d) {
        // Logjika e Sync: Prevents duplicate ORDER entries
        await syncOrderPayments(d.id);
        const m = await dbListMoves(d.id);
        setMoves(m);
      }
    } finally {
      setLoading(false);
    }
  }

  // FIXED: Logic for stable external_id
  async function syncOrderPayments(dayId) {
    // This is where you map your order payments to the cash desk.
    // Example logic:
    // const payments = await fetchPayments();
    // for (const p of payments) {
    //   await dbAddMove({
    //     day_id: dayId,
    //     type: 'IN',
    //     amount: p.amount,
    //     note: `Order #${p.order_id}`,
    //     source: 'ORDER',
    //     created_by: 'SYSTEM',
    //     external_id: `ORDPAY_${p.id}` // Stable ID stops reappearing payments
    //   });
    // }
  }

  const totals = useMemo(() => {
    const init = Number(day?.initial_cash || 0);
    const inS = moves.filter(m => m.type === 'IN').reduce((a, b) => a + Number(b.amount), 0);
    const outS = moves.filter(m => m.type === 'OUT').reduce((a, b) => a + Number(b.amount), 0);
    return { init, inS, outS, total: init + inS - outS };
  }, [day, moves]);

  // FIXED: Atomic Close
  async function onClose() {
    if (!day) return;
    
    const counted = prompt("CASH REAL NË ARKË (Shuma fizike):");
    if (counted === null) return;
    
    const countedNum = Number(counted.replace(',', '.'));
    if (isNaN(countedNum)) return alert("Shuma nuk është valide.");

    const disc = countedNum - totals.total;
    let closingNote = "";
    if (Math.abs(disc) > 0.01) {
      closingNote = prompt("SHËNIM PËR DISKREPANCA:", "Mungesë/Tepricë...");
      if (closingNote === null) return;
    }
    
    setBusy(true);
    try {
      // Transitions status from OPEN to HANDED
      await dbCloseDay({
        day_id: day.id,
        closed_by: user?.name || "ARKETARI",
        expected_cash: totals.total,
        cash_counted: countedNum,
        discrepancy: disc,
        close_note: closingNote
      });
      
      setDay(null);
      setMoves([]);
      alert("DITA U MBYLL DHE U DOREZUA TE DISPATCH.");
    } catch (e) { 
      alert(e.message); 
    } finally { 
      setBusy(false); 
    }
  }

  if (loading) return <div className="p-10 text-white uppercase tracking-widest">Duke ngarkuar...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6 font-mono uppercase">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-between items-center border-b border-white/10 pb-4">
          <h1 className="text-2xl font-black tracking-tighter italic">ARKA / CASH</h1>
          {day && (
            <button 
              onClick={onClose} 
              disabled={busy} 
              className="bg-red-600 hover:bg-red-700 transition-colors px-6 py-2 rounded text-xs font-black shadow-lg shadow-red-900/20"
            >
              MBYLL DITËN
            </button>
          )}
        </div>

        {!day ? (
          <div className="bg-white/5 p-20 rounded-3xl text-center border border-white/10 shadow-2xl">
            <p className="text-[10px] opacity-40 mb-6 tracking-[0.3em]">Statusi: E mbyllur</p>
            <button 
              onClick={() => dbOpenDay({ initial_cash: 0, opened_by: user?.name }).then(refresh)} 
              disabled={busy}
              className="bg-white text-black px-12 py-5 rounded-2xl font-black text-lg hover:scale-105 transition-transform"
            >
              HAP DITËN E RE (START €0.00)
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
             <div className="bg-white/5 p-5 rounded-2xl border border-white/10">
                <p className="text-[10px] opacity-50 mb-1">FILLIMI</p>
                <p className="text-xl font-black">€{fmtEur(totals.init)}</p>
             </div>
             <div className="bg-white/5 p-5 rounded-2xl border border-white/10 text-green-400">
                <p className="text-[10px] opacity-50 mb-1">HYRJE</p>
                <p className="text-xl font-black">€{fmtEur(totals.inS)}</p>
             </div>
             <div className="bg-white/5 p-5 rounded-2xl border border-white/10 text-red-400">
                <p className="text-[10px] opacity-50 mb-1">DALJE</p>
                <p className="text-xl font-black">€{fmtEur(totals.outS)}</p>
             </div>
             <div className="bg-white/5 p-5 rounded-2xl border border-white/10 text-blue-400 ring-1 ring-blue-500/30">
                <p className="text-[10px] opacity-50 mb-1">TOTALI PRITET</p>
                <p className="text-xl font-black">€{fmtEur(totals.total)}</p>
             </div>
          </div>
        )}

        {day && (
          <div className="mt-8">
            <h2 className="text-[10px] opacity-50 mb-4 tracking-widest">LËVIZJET E DITËS</h2>
            <div className="space-y-2">
              {moves.length === 0 ? (
                <div className="p-10 border border-dashed border-white/10 text-center opacity-30 text-xs">Nuk ka lëvizje</div>
              ) : (
                moves.map(m => (
                  <div key={m.id} className="bg-white/5 p-4 rounded-xl border border-white/5 flex justify-between items-center group">
                    <div>
                      <p className="text-xs font-bold">{m.note || m.source}</p>
                      <p className="text-[9px] opacity-40 mt-1">{m.created_at.slice(11, 16)} • {m.created_by}</p>
                    </div>
                    <span className={`text-sm font-black ${m.type === 'IN' ? 'text-green-500' : 'text-red-500'}`}>
                      {m.type === 'IN' ? '+' : '-'}€{fmtEur(m.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
