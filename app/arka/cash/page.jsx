'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { dbGetOpenDay, dbCloseDay, dbListMoves, dbAddMove } from '@/lib/arkaDb';
import { supabase } from '@/lib/supabaseClient';

/** LOCAL dayKey (NO UTC) */
function dayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const fmtEur = (n) => {
  const x = Number(n || 0);
  return x.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

function jparse(s, fallback) {
  try {
    return JSON.parse(s) ?? fallback;
  } catch {
    return fallback;
  }
}

function readCurrentUser() {
  const raw = localStorage.getItem('arka_user') || localStorage.getItem('CURRENT_USER_DATA');
  const u = jparse(raw, null);
  if (!u) return null;
  return {
    name: u.name || u.full_name || u.username || 'LOCAL',
    role: u.role || u.user_role || u.type || 'LOCAL',
  };
}

export default function ArkaCashPage() {
  const [me, setMe] = useState(null);
  const [day, setDay] = useState(null);
  const [moves, setMoves] = useState([]);
  const [opening, setOpening] = useState('0');
  const [type, setType] = useState('IN');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const totals = useMemo(() => {
    const init = Number(day?.initial_cash || 0);
    const inS = (moves || [])
      .filter((m) => m.type === 'IN')
      .reduce((a, b) => a + Number(b.amount || 0), 0);
    const outS = (moves || [])
      .filter((m) => m.type === 'OUT')
      .reduce((a, b) => a + Number(b.amount || 0), 0);
    return { init, inS, outS, expected: init + inS - outS };
  }, [day, moves]);

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      const d = await dbGetOpenDay();
      setDay(d || null);

      // ✅ IMPORTANT: sync opening input from DB (so it shows saved initial_cash)
      if (d) setOpening(String(d.initial_cash ?? 0));

      if (d?.id) {
        const list = await dbListMoves(d.id);
        setMoves(Array.isArray(list) ? list : []);
      } else {
        setMoves([]);
      }
    } catch (e) {
      setErr(e?.message || 'Gabim gjatë ngarkimit.');
      setDay(null);
      setMoves([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    try {
      setMe(readCurrentUser());
    } catch {}
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** OPEN DAY via RPC ONLY */
  async function onOpenDay() {
    setBusy(true);
    setErr('');
    try {
      const initialCash = Number(String(opening || '0').replace(',', '.'));
      const userName = me?.name || 'LOCAL';

      // ✅ LOCAL day key (no UTC issues)
      const dayKey = dayKeyLocal(new Date());

      const { data, error } = await supabase.rpc('arka_open_day', {
        p_day_key: dayKey,
        p_initial_cash: isFinite(initialCash) ? initialCash : 0,
        p_opened_by: userName,
      });

      if (error) {
        setErr(error.message);
        return;
      }

      // ✅ Use returned data immediately (prevents UI from staying on "HAP DITËN" if filters lag)
      if (data?.id) {
        setDay(data);
        setOpening(String(data.initial_cash ?? 0));
        const list = await dbListMoves(data.id);
        setMoves(Array.isArray(list) ? list : []);
      } else {
        await refresh();
      }
    } catch (e) {
      setErr(e?.message || 'S’u hap dita.');
    } finally {
      setBusy(false);
    }
  }

  async function onCloseDay() {
    if (!day?.id) return;
    const counted = prompt('CASH REAL NË ARKË:');
    if (counted === null) return;
    const countedNum = Number(String(counted).replace(',', '.'));
    if (!isFinite(countedNum)) return alert('Shuma nuk është valide.');
    const discrepancy = countedNum - totals.expected;
    const close_note = discrepancy !== 0 ? prompt('ARSYETIMI (opsional):') || '' : '';

    setBusy(true);
    setErr('');
    try {
      await dbCloseDay({
        day_id: day.id,
        closed_by: me?.name || 'LOCAL',
        expected_cash: totals.expected,
        cash_counted: countedNum,
        discrepancy,
        close_note,
      });
      setDay(null);
      setMoves([]);
      // keep opening as-is (or reset if you want)
      // setOpening('0');
    } catch (e) {
      setErr(e?.message || 'S’u mbyll dita.');
    } finally {
      setBusy(false);
    }
  }

  async function onAddMove() {
    if (!day?.id) return alert('Hape ditën së pari.');
    const amt = Number(String(amount || '').replace(',', '.'));
    if (!isFinite(amt) || amt <= 0) return alert('Shuma nuk është valide.');

    setBusy(true);
    setErr('');
    try {
      await dbAddMove({
        day_id: day.id,
        type,
        amount: amt,
        note: note || '',
        source: 'MANUAL',
        created_by: me?.name || 'LOCAL',
      });
      setAmount('');
      setNote('');
      const list = await dbListMoves(day.id);
      setMoves(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e?.message || 'S’u ruajt lëvizja.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pageWrap">
      <div className="topRow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div>
          <div className="title" style={{ fontWeight: 800, letterSpacing: 1 }}>ARKA</div>
          <div className="sub" style={{ opacity: 0.75, fontSize: 12 }}>
            {(me?.name || 'LOCAL').toUpperCase()} • {(me?.role || 'LOCAL').toUpperCase()}
          </div>
        </div>

        <Link href="/arka" className="btn" style={{ width: 'auto', paddingInline: 12 }}>
          MBRAPA
        </Link>
      </div>

      {err ? (
        <div className="errBox" style={{ marginTop: 12, padding: 10, borderRadius: 10, border: '1px solid rgba(255,0,0,0.35)', color: '#ffb3b3' }}>
          {err}
        </div>
      ) : null}

      {loading ? (
        <div style={{ marginTop: 14, opacity: 0.7 }}>DUKE NGARKUAR…</div>
      ) : null}

      {/* OPEN DAY PANEL */}
      {!day?.id ? (
        <div style={{ marginTop: 14 }}>
          <div className="grid2">
            <div className="field">
              <div className="label">FILLIMI (€)</div>
              <input
                className="input"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </div>

            <div className="field">
              <div className="label">DATA</div>
              <input className="input" value={dayKeyLocal(new Date())} readOnly />
            </div>

            <button className="btn" onClick={onOpenDay} disabled={busy}>
              {busy ? 'DUKE HAPUR…' : 'HAP DITËN'}
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          {/* DAY OPEN SUMMARY */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ opacity: 0.85 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>DITA</div>
              <div style={{ fontWeight: 800 }}>{day.day_key}</div>
            </div>
            <div style={{ opacity: 0.85 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>FILLIMI</div>
              <div style={{ fontWeight: 800 }}>€{fmtEur(day.initial_cash)}</div>
            </div>
            <div style={{ opacity: 0.85 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>PRITET</div>
              <div style={{ fontWeight: 900 }}>€{fmtEur(totals.expected)}</div>
            </div>
          </div>

          {/* ADD MOVE */}
          <div style={{ marginTop: 14 }} className="grid2">
            <div className="field">
              <div className="label">TIPI</div>
              <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="IN">HYRJE (IN)</option>
                <option value="OUT">DALJE (OUT)</option>
              </select>
            </div>

            <div className="field">
              <div className="label">SHUMA (€)</div>
              <input
                className="input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </div>

            <div className="field" style={{ gridColumn: '1 / -1' }}>
              <div className="label">SHËNIM</div>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="OPSIONALE" />
            </div>

            <button className="btn" onClick={onAddMove} disabled={busy}>
              {busy ? 'DUKE RUJT…' : 'RUJ'}
            </button>

            <button className="btn" onClick={onCloseDay} disabled={busy}>
              MBYLLE DITËN
            </button>
          </div>

          {/* MOVES LIST */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>LËVIZJET</div>

            {moves?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {moves.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 10,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800 }}>
                        {m.type === 'IN' ? 'HYRJE' : 'DALJE'} • €{fmtEur(m.amount)}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, wordBreak: 'break-word' }}>{m.note || '—'}</div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'nowrap' }}>
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.7 }}>S’KA LËVIZJE.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}