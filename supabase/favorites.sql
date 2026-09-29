-- ============================================================
-- DRIFT — favorite drivers, 20-minute offers, snow alerts
-- (run AFTER stats.sql). Safe to re-run.
--
--   1. Offers stay open for 20 minutes (was 5).
--   2. Customers can save drivers they've used as favorites. When they book,
--      their favorites who are online get the offer FIRST, for 2 minutes,
--      before any other driver can see it.
--   3. Snow alerts: customers get a heads-up before a storm (they can turn it
--      off). One alert per day at most.
-- ============================================================

-- who gets first dibs on an offer, and until when (set by the server when the card is held)
alter table public.jobs add column if not exists preferred_driver_ids uuid[];
alter table public.jobs add column if not exists exclusive_until timestamptz;
alter table public.jobs add column if not exists announced_all_at timestamptz;

-- ---------- 1. offers stay open 20 minutes ----------
create or replace function public.jobs_before_insert()
returns trigger language plpgsql as $$
begin
  if new.offer is null or new.offer < 10 or new.offer > 500 then
    raise exception 'Offer must be between $10 and $500';
  end if;
  new.offer        := round(new.offer);
  new.callout_fee  := 10;
  new.drift_fee    := 5;
  new.price        := new.offer + 10 + 5;
  new.driver_pay   := round(new.offer * 0.80) + 10;
  new.platform_fee := new.price - new.driver_pay;
  new.status       := 'requested';
  new.driver_id    := null;
  new.accepted_at  := null;
  new.expires_at   := now() + interval '20 minutes';
  new.payment_status        := case when public.payments_required() then 'pending' else 'not_required' end;
  new.payment_intent_id     := null;
  new.payment_method_id     := null;
  new.charge_id             := null;
  new.payout_status         := 'none';
  new.transfer_id           := null;
  new.tip_payment_intent_id := null;
  new.tip_transfer_id       := null;
  new.announced_at          := null;
  new.announced_all_at      := null;
  new.preferred_driver_ids  := null;   -- only the server sets first-dibs drivers
  new.exclusive_until       := null;
  new.tip                   := 0;
  return new;
end $$;

-- ---------- 2. favorite drivers ----------
create table if not exists public.favorite_drivers (
  customer_id uuid not null references public.profiles(id) on delete cascade,
  driver_id   uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (customer_id, driver_id)
);
alter table public.favorite_drivers enable row level security;
drop policy if exists fav_read on public.favorite_drivers;
drop policy if exists fav_insert on public.favorite_drivers;
drop policy if exists fav_delete on public.favorite_drivers;
create policy fav_read on public.favorite_drivers for select
  using (auth.uid() = customer_id or auth.uid() = driver_id);
-- you can only favorite a driver who has finished a job for you
create policy fav_insert on public.favorite_drivers for insert with check (
  auth.uid() = customer_id and exists (
    select 1 from public.jobs j
    where j.customer_id = auth.uid() and j.driver_id = favorite_drivers.driver_id and j.status = 'completed')
);
create policy fav_delete on public.favorite_drivers for delete using (auth.uid() = customer_id);


-- Open offers: visible to active drivers — but during the first-dibs window
-- only to the customer's favorite drivers.
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested' and expires_at > now()
      and payment_status in ('authorized', 'not_required')
      and public.is_active_driver(auth.uid())
      and (exclusive_until is null or exclusive_until <= now() or auth.uid() = any(preferred_driver_ids)))
);

create or replace function public.claim_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare got uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_driver and not suspended) then
    raise exception 'Only active drivers can accept jobs';
  end if;
  perform set_config('drift.claiming', 'on', true);
  update jobs
     set driver_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = p_job
     and status = 'requested'
     and driver_id is null
     and expires_at > now()
     and payment_status in ('authorized', 'not_required')
     and customer_id <> auth.uid()
     and (exclusive_until is null or exclusive_until <= now() or auth.uid() = any(preferred_driver_ids))
  returning id into got;
  perform set_config('drift.claiming', 'off', true);
  return got;
end $$;
revoke all on function public.claim_job(uuid) from public;
grant execute on function public.claim_job(uuid) to authenticated;

-- ---------- 3. snow alerts ----------
alter table public.profiles add column if not exists snow_alerts boolean not null default true;
create table if not exists public.snow_alerts (
  day        date primary key,             -- one alert per day, at most
  inches     numeric,
  sent       int,
  created_at timestamptz not null default now()
);
alter table public.snow_alerts enable row level security;  -- server only (no policies)
grant all on public.snow_alerts to service_role;
grant select, insert, delete on public.favorite_drivers to authenticated;
grant all on public.favorite_drivers to service_role;

-- Done. You should see "Success. No rows returned."
