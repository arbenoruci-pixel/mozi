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
 *
 * If you still see "duplicate key" after this change,
 * search the whole project for `dbOpenDay` and remove any calls.
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
  if (external_id) {
    const { data: existing } = await supabase
      .from("arka_moves")
      .select("*")
      .eq("external_id", external_id)
      .maybeSingle();
    if (existing) return existing;
  }

  const { data, error } = await supabase
    .from("arka_moves")
    .insert([
      {
        day_id,
        type,
        amount: Number(amount),
        note,
        source,
        created_by,
        external_id: external_id || null,
      },
    ])
    .select("*")
    .single();

  if (error) throw error;
  return data;
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
  const { data, error } = await supabase
    .from("arka_moves")
    .select("*")
    .eq("day_id", day_id)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}