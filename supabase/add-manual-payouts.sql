-- ============================================================
-- DRIFT — manual payout methods (Venmo / Cash App / Apple Pay)
-- Run ONCE in the Supabase SQL editor. Idempotent.
--
-- What this is:
--   Stripe pays drivers to their bank automatically (weekly). Some drivers
--   want Venmo / Cash App / Apple Pay instead. Stripe can't send to those, so
--   the driver saves their handle here, their earnings are still COLLECTED in
--   Stripe (customer side unchanged), and the owner pays them manually each
--   week and marks it paid on the owner dashboard.
--
--   • profiles.payout_method : 'bank' (default) | 'venmo' | 'cashapp' | 'applepay'
--   • profiles.payout_handle : the @handle / phone / email to send to
--   • manual_payouts         : the owner's log of what was sent, when.
-- ============================================================

-- ---------- 1. driver's chosen method + handle ----------
alter table public.profiles add column if not exists payout_method text not null default 'bank';
alter table public.profiles add column if not exists payout_handle text;

alter table public.profiles drop constraint if exists profiles_payout_method_check;
alter table public.profiles add constraint profiles_payout_method_check
  check (payout_method in ('bank','venmo','cashapp','applepay'));

-- The driver may update their OWN method + handle; everything else on the row
-- stays governed by whatever policies you already have. (No-op if a matching
-- policy already exists.)
do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'own_payout_method'
  ) then
    create policy own_payout_method on public.profiles
      for update to authenticated
      using (id = auth.uid())
      with check (id = auth.uid());
  end if;
end $$;

-- ---------- 2. the owner's manual-payout log ----------
create table if not exists public.manual_payouts (
  id          uuid primary key default gen_random_uuid(),
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  amount      numeric not null,
  method      text not null,
  handle      text,
  reference   text,                       -- optional: Venmo/CashApp txn note
  period_start date,                       -- the week this payout covers
  period_end   date,
  marked_paid_at timestamptz not null default now(),
  paid_by      uuid references public.profiles(id)  -- which owner marked it
);

create index if not exists manual_payouts_driver_idx on public.manual_payouts(driver_id, marked_paid_at desc);

alter table public.manual_payouts enable row level security;

-- Only the service role (the /api/admin owner endpoint) reads or writes this
-- table. No client-side policy = clients can't touch it directly; the owner
-- dashboard goes through the service-role key, which bypasses RLS.
-- (Table is created with RLS on and no permissive policy, which is what we want.)

-- ---------- 3. mark a driver's held earnings as manually paid ----------
-- Flips the matching completed+owed jobs to a 'paid' payout_status so the
-- owner dashboard stops counting them as owed. Called by the admin endpoint.
create or replace function public.mark_manual_paid(p_driver uuid, p_through timestamptz)
returns numeric language plpgsql security definer set search_path = public as $$
declare v_total numeric;
begin
  update public.jobs
    set payout_status = 'paid'
    where driver_id = p_driver
      and status = 'completed'
      and payout_status in ('owed','held')
      and completed_at <= p_through
    returning driver_pay into v_total;
  select coalesce(sum(driver_pay),0) into v_total
    from public.jobs
    where driver_id = p_driver and payout_status = 'paid';
  return v_total;
end $$;

-- Test:
--   select payout_method, payout_handle from public.profiles where is_driver limit 5;
--   select * from public.manual_payouts order by marked_paid_at desc limit 10;
