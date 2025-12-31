'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabaseClient';
import {
  dbGetOpenDay,
  dbCloseDay,
  dbReceiveFromDispatch,
  dbListMoves,
  dbAddMove,
  dbListDays,
  dbGetDayById,
  dbListHandedDays,
} from '@/lib/arkaDb';

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
  try { return JSON.parse(s) ?? fallback; } catch { return fallback; }
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

  // UI modes
  const [mode, setMode] = useState('OPEN'); // OPEN | HISTORY | DISPATCH
  const [days, setDays] = useState([]);
  const [selectedDayId, setSelectedDayId] = useState(null);
  const [handedDays, setHandedDays] = useState([]);

  const [opening, setOpening] = useState('0');

  const [type, setType] = useState('IN');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const totals = useMemo(() => {
    const init = Number(day?.initial_cash || 0);
    const inS = (moves || []).filter(m => m.type === 'IN').reduce((a, b) => a + Number(b.amount || 0), 0);
    const outS = (moves || []).filter(m => m.type === 'OUT').reduce((a, b) => a + Number(b.amount || 0), 0);
    return { init, inS, outS, expected: init + inS - outS };
  }, [day, moves]);

  const canEdit = !!(day?.id && day?.handoff_status === 'OPEN' && !day?.closed_at);
  const canReceive = !!(day?.id && day?.handoff_status === 'HANDED');

  async function refresh() {
    setLoading(true);
    setErr('');
    try {
      // Always load recent days (so closed days don't "disappear")
      const dayList = await dbListDays(30);
      setDays(Array.isArray(dayList) ? dayList : []);

      // Open day (if any)
      const open = await dbGetOpenDay();
      setDay(open || null);

      // sync opening input from DB
      if (open) setOpening(String(open.initial_cash ?? 0));

      // Which day is currently being viewed?
      const viewId =
        (mode === 'HISTORY' || mode === 'DISPATCH')
          ? (selectedDayId || open?.id || null)
          : (open?.id || null);

      if (viewId) {
        const viewDay = await dbGetDayById(viewId);
        // Keep day state pointing to the open day (for OPEN mode),
        // but show history details by selecting a day id.
        if (mode !== 'OPEN') setDay(viewDay || open || null);
        const list = await dbListMoves(viewId);
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
    try { setMe(readCurrentUser()); } catch {}
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // refresh when switching views / selecting a different day
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedDayId]);

  /** OPEN DAY via RPC ONLY */
  async function onOpenDay() {
    setBusy(true);
    setErr('');
    try {
      const initialCash = Number(String(opening || '0').replace(',', '.'));
      const userName = me?.name || 'LOCAL';
      const dayKey = dayKeyLocal(new Date());

      const { error } = await supabase.rpc('arka_open_day', {
        p_day_key: dayKey,
        p_initial_cash: isFinite(initialCash) ? initialCash : 0,
        p_opened_by: userName,
      });

      if (error) {
        setErr(error.message);
        return;
      }

      await refresh();
    } catch (e) {
      setErr(e?.message || 'S’u hap dita.');
    } finally {
      setBusy(false);
    }
  }

  async function onCloseDay() {
    if (!day?.id) return;
    if (!canEdit) return alert('Kjo ditë nuk është OPEN (ose është mbyllur).');

    const counted = prompt('CASH REAL NË ARKË:');
    if (counted === null) return;

    const countedNum = Number(String(counted).replace(',', '.'));
    if (!isFinite(countedNum)) return alert('Shuma nuk është valide.');

    const discrepancy = Number((countedNum - totals.expected).toFixed(2));
    const close_note = discrepancy !== 0 ? (prompt('ARSYETIMI (opsional):') || '') : '';

    setBusy(true);
    setErr('');
    try {
      const closed = await dbCloseDay({
        day_id: day.id,
        closed_by: me?.name || 'LOCAL',
        expected_cash: totals.expected,
        cash_counted: countedNum,
        discrepancy,
        close_note,
      });

      // After closing: show HISTORY (so "parat" nuk duken sikur u zhdukën)
      setMode('HISTORY');
      setSelectedDayId(closed?.id || day.id);
      await refresh();
    } catch (e) {
      setErr(e?.message || 'S’u mbyll dita.');
    } finally {
      setBusy(false);
    }
  }

  async function onReceiveAsDispatch() {
    if (!day?.id) return;
    if (day.handoff_status !== 'HANDED') return alert('Kjo ditë s’është në DORËZIM (HANDED).');

    const received = prompt('SA € U PRANUAN NGA DISPATCH? (CASH):', String(day.cash_counted ?? day.expected_cash ?? ''));
    if (received === null) return;
    const receivedNum = Number(String(received).replace(',', '.'));
    if (!isFinite(receivedNum)) return alert('Shuma nuk është valide.');

    setBusy(true);
    setErr('');
    try {
      await dbReceiveFromDispatch({
        day_id: day.id,
        received_by: me?.name || 'DISPATCH',
        received_amount: receivedNum,
      });
      await refresh();
    } catch (e) {
      setErr(e?.message || 'S’u pranua dorëzimi.');
    } finally {
      setBusy(false);
    }
  }

  async function onAddMove() {
    if (!day?.id) return alert('Zgjedh një ditë ose hape ditën së pari.');
    if (!canEdit) return alert('Nuk mundesh me shtu lëvizje në ditë të mbyllur / në dorëzim.');

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
        external_id: `manual_${day.id}_${Date.now()}`, // idempotent safety
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
    <div style={{ width: '100%', maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Header */}
      <div className="arka-top">
        <div>
          <div className="arka-title">ARKA • CASH</div>
          <div className="arka-sub">
            {(me?.name || 'LOCAL').toUpperCase()} • {(me?.role || 'LOCAL').toUpperCase()}
          </div>
        </div>
        <Link href="/arka" className="arka-back">MBRAPA</Link>
      </div>

      {/* Mode switch */}
      <div className="arka-card" style={{ padding: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          className="arka-btn"
          onClick={() => {
            setMode('OPEN');
            setSelectedDayId(null);
          }}
          style={{ flex: 1, minWidth: 120, outline: mode === 'OPEN' ? '2px solid rgba(255,255,255,.22)' : 'none' }}
        >
          OPEN
        </button>
        <button
          className="arka-btn"
          onClick={() => setMode('HISTORY')}
          style={{ flex: 1, minWidth: 120, outline: mode === 'HISTORY' ? '2px solid rgba(255,255,255,.22)' : 'none' }}
        >
          HISTORI
        </button>
        {(String(me?.role || '').toUpperCase().includes('DISPATCH') || String(me?.role || '').toUpperCase().includes('ADMIN')) ? (
          <button
            className="arka-btn"
            onClick={() => setMode('DISPATCH')}
            style={{ flex: 1, minWidth: 120, outline: mode === 'DISPATCH' ? '2px solid rgba(255,255,255,.22)' : 'none' }}
          >
            DISPATCH
          </button>
        ) : null}
      </div>

      {/* Errors */}
      {err ? (
        <div className="arka-card" style={{ borderColor: 'rgba(239,68,68,.35)' }}>
          <div className="arka-card-title" style={{ color: 'rgba(255,200,200,.85)' }}>GABIM</div>
          <div style={{ fontSize: 12, lineHeight: 1.5, color: '#ffd5d5' }}>{err}</div>
        </div>
      ) : null}

      {loading ? (
        <div className="arka-card">
          <div className="arka-card-title">DUKE NGARKUAR…</div>
        </div>
      ) : null}

      {/* HISTORY / DISPATCH */}
      {!loading && mode !== 'OPEN' ? (
        <div className="arka-card">
          <div className="arka-card-title">{mode === 'DISPATCH' ? 'PËR DISPATCH (HANDED)' : 'HISTORI (30 DITË)'}</div>

          {days.length === 0 ? (
            <div style={{ fontSize: 12, opacity: 0.75 }}>S’ka ditë për t’u shfaqur.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {(mode === 'DISPATCH' ? days.filter((d) => d.handoff_status === 'HANDED') : days).map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="arka-btn secondary"
                  style={{ width: '100%', justifyContent: 'space-between' }}
                  onClick={() => {
                    setSelectedDayId(d.id);
                  }}
                >
                  <span style={{ fontWeight: 900 }}>{(d.day_key || '').toUpperCase() || `ID ${d.id}`}</span>
                  <span style={{ fontSize: 12, opacity: 0.85 }}>
                    {d.handoff_status || '—'} • {Number(d.cash_counted ?? d.expected_cash ?? 0).toFixed(2)}€
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* OPEN DAY */}
      {mode === 'OPEN' && !day?.id ? (
        <div className="arka-card">
          <div className="arka-card-title">HAP DITËN</div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
            <div>
              <div className="arka-card-title" style={{ marginBottom: 6 }}>FILLIMI (€)</div>
              <input
                className="arka-input"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </div>

            <div>
              <div className="arka-card-title" style={{ marginBottom: 6 }}>DATA</div>
              <input className="arka-input" value={dayKeyLocal(new Date())} readOnly />
            </div>

            <button className="arka-btn arka-btn-primary" onClick={onOpenDay} disabled={busy}>
              {busy ? 'DUKE HAPUR…' : 'HAP DITËN'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* SUMMARY */}
          <div className="arka-card">
            <div className="arka-card-title">PËRMBLEDHJE</div>

            <div style={{ marginTop: 6, fontSize: 12, fontWeight: 900, opacity: 0.9 }}>
              STATUS: {day?.handoff_status || '—'}
              {day?.handoff_status === 'OPEN' ? ' (E HAPUR)' : ''}
              {day?.handoff_status === 'HANDED' ? ' (NË DORËZIM TE DISPATCH)' : ''}
              {day?.handoff_status === 'RECEIVED' ? ' (PRANUAR NGA DISPATCH)' : ''}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.65 }}>DITA</div>
                  <div style={{ fontWeight: 900 }}>{day.day_key}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.65 }}>FILLIMI</div>
                  <div style={{ fontWeight: 900 }}>€{fmtEur(day.initial_cash)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.65 }}>HYRJE</div>
                  <div style={{ fontWeight: 900 }}>€{fmtEur(totals.inS)}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.65 }}>DALJE</div>
                  <div style={{ fontWeight: 900 }}>€{fmtEur(totals.outS)}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', opacity: 0.65 }}>PRITET</div>
                  <div style={{ fontWeight: 950, fontSize: 16 }}>€{fmtEur(totals.expected)}</div>
                </div>
                {canReceive && mode === 'DISPATCH' ? (
                  <button className="arka-btn arka-btn-primary" onClick={onReceiveAsDispatch} disabled={busy}>
                    PRANO (DISPATCH)
                  </button>
                ) : (
                  <button className="arka-btn arka-btn-danger" onClick={onCloseDay} disabled={busy || !canEdit}>
                    MBYLLE DITËN
                  </button>
                )}
              </div>

              {!canEdit && day?.id ? (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
                  STATUS: <strong>{String(day.handoff_status || '—')}</strong>
                  {day.closed_at ? ' • E MBYLLUR' : ''}
                </div>
              ) : null}
            </div>
          </div>

          {/* ADD MOVE */}
          <div className="arka-card">
            <div className="arka-card-title">SHTO LËVIZJE</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <div>
                <div className="arka-card-title" style={{ marginBottom: 6 }}>TIPI</div>
                <select className="arka-input" value={type} onChange={(e) => setType(e.target.value)} disabled={!canEdit || busy}>
                  <option value="IN">HYRJE (IN)</option>
                  <option value="OUT">DALJE (OUT)</option>
                </select>
              </div>

              <div>
                <div className="arka-card-title" style={{ marginBottom: 6 }}>SHUMA (€)</div>
                <input
                  className="arka-input"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  disabled={!canEdit || busy}
                />
              </div>

              <div>
                <div className="arka-card-title" style={{ marginBottom: 6 }}>SHËNIM</div>
                <input
                  className="arka-input"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="OPSIONALE"
                  disabled={!canEdit || busy}
                />
              </div>

              <button className="arka-btn arka-btn-primary" onClick={onAddMove} disabled={busy || !canEdit}>
                {busy ? 'DUKE RUJT…' : 'RUJ'}
              </button>
            </div>
          </div>

          {/* MOVES */}
          <div className="arka-card">
            <div className="arka-card-title">LËVIZJET</div>

            {moves?.length ? (
              <div style={{ display: 'grid', gap: 8 }}>
                {moves.map((m) => (
                  <div
                    key={m.id || `${m.type}_${m.created_at}_${m.amount}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      padding: 10,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.08)',
                      background: 'rgba(0,0,0,0.35)',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, letterSpacing: '.02em' }}>
                        {m.type === 'IN' ? 'HYRJE' : 'DALJE'} • €{fmtEur(m.amount)}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7, wordBreak: 'break-word' }}>
                        {m.note || '—'}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, whiteSpace: 'nowrap' }}>
                      {m.created_at ? new Date(m.created_at).toLocaleTimeString() : ''}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ opacity: 0.7, fontSize: 12 }}>S’KA LËVIZJE.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}