/* TEPIHA → ARKA (Supabase)
   Fix duplicate key on arka_days.day_key and enable OPEN/NOOP/REOPEN + cash-only when day is OPEN.

   Run in Supabase SQL Editor.
*/

-- 1) Ensure required columns exist
alter table if exists public.arka_days
  add column if not exists day_key text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by text;

-- 2) Backfill day_key if missing
update public.arka_days
set day_key = to_char(opened_at::date, 'YYYY-MM-DD')
where day_key is null;

-- 3) Ensure UNIQUE day_key (avoid duplicates)
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='arka_days_day_key_key'
  ) then
    execute 'create unique index arka_days_day_key_key on public.arka_days(day_key)';
  end if;
end $$;

-- 4) RPC: OPEN / NOOP / REOPEN
create or replace function public.arka_open_day(
  p_day_key text,
  p_initial_cash numeric default 0,
  p_opened_by text default null
)
returns public.arka_days
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.arka_days;
begin
  select * into d
  from public.arka_days
  where day_key = p_day_key
  for update;

  if not found then
    insert into public.arka_days
      (day_key, opened_at, opened_by, initial_cash, closed_at, closed_by, reopened_at, reopened_by, handoff_status)
    values
      (p_day_key, now(), coalesce(p_opened_by,'LOCAL'), coalesce(p_initial_cash,0), null, null, null, null, 'OPEN')
    returning * into d;
    return d;
  end if;

  -- already OPEN -> NOOP
  if d.handoff_status = 'OPEN' and d.closed_at is null then
    return d;
  end if;

  update public.arka_days
  set handoff_status = 'OPEN',
      closed_at = null,
      closed_by = null,
      handed_at = null,
      handed_by = null,
      received_at = null,
      received_by = null,
      received_amount = null,
      expected_cash = null,
      cash_counted = null,
      discrepancy = null,
      close_note = null,
      reopened_at = now(),
      reopened_by = coalesce(p_opened_by,'LOCAL')
  where id = d.id
  returning * into d;

  return d;
end $$;

-- allow calling from frontend
grant execute on function public.arka_open_day(text, numeric, text) to anon, authenticated;

-- 5) RPC: CLOSE DAY
create or replace function public.arka_close_day(
  p_day_id bigint,
  p_user text default null
)
returns public.arka_days
language plpgsql
as $$
declare
  d public.arka_days;
begin
  update public.arka_days
  set closed_at = now(),
      closed_by = p_user
  where id = p_day_id
  returning * into d;

  return d;
end $$;

-- 6) RLS: allow moves insert only when day is OPEN (closed_at is null)
alter table if exists public.arka_days enable row level security;
alter table if exists public.arka_moves enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename='arka_days' and policyname='read_arka_days') then
    execute 'create policy "read_arka_days" on public.arka_days for select using (true)';
  end if;

  if not exists (select 1 from pg_policies where tablename='arka_days' and policyname='write_arka_days') then
    execute 'create policy "write_arka_days" on public.arka_days for insert with check (true)';
  end if;

  if not exists (select 1 from pg_policies where tablename='arka_days' and policyname='update_arka_days') then
    execute 'create policy "update_arka_days" on public.arka_days for update using (true) with check (true)';
  end if;

  if not exists (select 1 from pg_policies where tablename='arka_moves' and policyname='read_arka_moves') then
    execute 'create policy "read_arka_moves" on public.arka_moves for select using (true)';
  end if;

  if not exists (select 1 from pg_policies where tablename='arka_moves' and policyname='insert_moves_only_when_open') then
    execute $pol$
      create policy "insert_moves_only_when_open"
      on public.arka_moves
      for insert
      with check (
        exists (
          select 1 from public.arka_days d
          where d.id = arka_moves.day_id
            and d.closed_at is null
        )
      )
    $pol$;
  end if;
end $$;
