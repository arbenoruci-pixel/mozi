import { supabase } from "@/lib/supabaseClient";

function dayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function dbGetOpenDay() {
  const { data, error } = await supabase
    .from("arka_days")
    .select("*")
    .eq("handoff_status", "OPEN")
    .is("closed_at", null)
    .order("opened_at", { ascending: false }) // ✅ always newest OPEN
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * IMPORTANT:
 * dbOpenDay() was REMOVED on purpose.
 * Opening/Reopening the day MUST be done via RPC: `arka_open_day`
 * from the ARKA page button handler (onOpenDay).
 */

export async function dbAddMove({
  day_id,
  type,
  amount,
  note,
  source,
  created_by,
  external_id,
}) {
  if (!day_id) throw new Error("day_id mungon.");
  const t = String(type || "").toUpperCase();
  if (t !== "IN" && t !== "OUT") throw new Error("Tipi duhet IN ose OUT.");

  if (external_id) {
    const { data: existing, error: e1 } = await supabase
      .from("arka_moves")
      .select("*")
      .eq("external_id", external_id)
      .maybeSingle();
    if (e1) throw e1;
    if (existing) return existing;
  }

  const { data, error } = await supabase
    .from("arka_moves")
    .insert([
      {
        day_id,
        type: t,
        amount: Number(amount || 0),
        note: note || "",
        source: source || "AUTO",
        created_by: created_by || "LOCAL",
        external_id: external_id || null,
      },
    ])
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/**
 * ✅ NEW: Log a payment into ARKA from PRANIMI/GATI/etc
 * - Ensures there is an OPEN day (opens via RPC if missing)
 * - Inserts an IN move (cash inflow)
 * - Uses external_id to prevent duplicates
 */
export async function dbLogPaymentToArka({
  amount,
  note,
  source,      // 'PRANIMI' | 'GATI' | 'PASTRIMI' | ...
  created_by,  // username
  external_id, // unique: e.g. `order:<id>:gati:<ts>`
}) {
  const amt = Number(amount || 0);
  if (!isFinite(amt) || amt <= 0) return null;

  // 1) get open day
  let day = await dbGetOpenDay();

  // 2) if no open day -> open via RPC
  if (!day?.id) {
    const dayKey = dayKeyLocal(new Date());
    const { data, error } = await supabase.rpc("arka_open_day", {
      p_day_key: dayKey,
      p_initial_cash: 0,
      p_opened_by: created_by || "LOCAL",
    });
    if (error) throw error;

    // some RPCs return row, some don't -> refresh
    day = data?.id ? data : await dbGetOpenDay();
  }

  if (!day?.id) throw new Error("Nuk u gjet dita OPEN për ARKA.");

  // 3) insert move
  return await dbAddMove({
    day_id: day.id,
    type: "IN",
    amount: amt,
    note: note || "",
    source: source || "AUTO",
    created_by: created_by || "LOCAL",
    external_id: external_id || null,
  });
}

export async function dbCloseDay({
  day_id,
  closed_by,
  expected_cash,
  cash_counted,
  discrepancy,
  close_note,
}) {
  const payload = {
    closed_at: new Date().toISOString(),
    closed_by,
    expected_cash: expected_cash == null ? null : Number(expected_cash),
    cash_counted: cash_counted == null ? null : Number(cash_counted),
    discrepancy: discrepancy == null ? null : Number(discrepancy),
    close_note: close_note || "",
    handoff_status: "HANDED",
    handed_at: new Date().toISOString(),
    handed_by: closed_by,
  };

  const { data, error } = await supabase
    .from("arka_days")
    .update(payload)
    .eq("id", day_id)
    .eq("handoff_status", "OPEN")
    .is("closed_at", null)
    .select("*")
    .single();

  if (error || !data)
    throw new Error("Dita nuk mund të mbyllet ose është mbyllur tashmë.");
  return data;
}

export async function dbReceiveFromDispatch({
  day_id,
  received_by,
  received_amount,
}) {
  const { data, error } = await supabase
    .from("arka_days")
    .update({
      handoff_status: "RECEIVED",
      received_by,
      received_amount: Number(received_amount),
      received_at: new Date().toISOString(),
    })
    .eq("id", day_id)
    .eq("handoff_status", "HANDED")
    .select("*")
    .single();

  if (error || !data)
    throw new Error("Statusi i ditës ka ndryshuar ose është pranuar tashmë.");
  return data;
}

export async function dbListMoves(day_id) {
  if (!day_id) return [];
  const { data, error } = await supabase
    .from("arka_moves")
    .select("*")
    .eq("day_id", day_id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// -------------------- HISTORY / HANDOFF --------------------

/** List last N days (OPEN + HANDED + RECEIVED) so nothing "disappears" after close. */
export async function dbListDays(limit = 30) {
  const { data, error } = await supabase
    .from('arka_days')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

/** Fetch a specific day row by id. */
export async function dbGetDay(day_id) {
  if (!day_id) return null;
  const { data, error } = await supabase
    .from('arka_days')
    .select('*')
    .eq('id', day_id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

/** List days that are closed and waiting to be received by DISPATCH. */
export async function dbListHandedDays(limit = 30) {
  const { data, error } = await supabase
    .from('arka_days')
    .select('*')
    .eq('handoff_status', 'HANDED')
    .order('closed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}