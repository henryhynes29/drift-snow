-- ============================================================
-- DRIFT — scheduled plows, driver routes, job queue, sign-up sources
-- (run AFTER favorites.sql). Safe to re-run.
--
--   1. Customers can schedule a plow for a day + 2-hour window (up to 6 days out).
--      The card is held when they book; they're charged only when it's done.
--   2. Drivers claim scheduled jobs ahead of time to build a route.
--      - Free back-out until 3 hours before the window; later = a "late cancel"
--        on their record (the owner dashboard shows it).
--      - They must CHECK IN by 45 minutes before the window. If they don't,
--        the job reopens to every driver.
--      - Jobs nobody claimed go to the regular open-job map 30 minutes before
--        the window.
--   3. A driver can hold up to 3 live jobs at once (finish them in order).
--   4. Where a customer came from (?ref= link) is saved on their profile.
-- ============================================================

-- ---------- new columns ----------
alter table public.jobs add column if not exists window_end     timestamptz;  -- scheduled_for + 2 hours
alter table public.jobs add column if not exists claimed_at     timestamptz;  -- when a driver put it on their route
alter table public.jobs add column if not exists checked_in_at  timestamptz;  -- driver confirmed they're on it
alter table public.jobs add column if not exists reminders_sent int not null default 0;
alter table public.jobs add column if not exists released_at    timestamptz;  -- last time it reopened (no check-in / back-out)

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('requested','scheduled','accepted','enroute','plowing','completed','cancelled','expired'));
create index if not exists jobs_sched_idx on public.jobs(status, scheduled_for) where status = 'scheduled';

alter table public.app_settings add column if not exists last_tick timestamptz;  -- scheduler heartbeat
grant select, update on public.app_settings to service_role;

alter table public.profiles add column if not exists late_cancels int not null default 0;
alter table public.profiles add column if not exists ref_source   text;

-- Every back-out / missed check-in, for the owner dashboard and the driver's own record.
create table if not exists public.driver_backouts (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid references public.jobs(id) on delete set null,
  driver_id  uuid references public.profiles(id) on delete cascade,
  late       boolean not null default false,
  reason     text,                 -- 'backed_out' | 'no_checkin'
  created_at timestamptz not null default now()
);
alter table public.driver_backouts enable row level security;
drop policy if exists backouts_read on public.driver_backouts;
create policy backouts_read on public.driver_backouts for select using (auth.uid() = driver_id);
grant select on public.driver_backouts to authenticated;
grant all on public.driver_backouts to service_role;

-- ---------- new jobs: "now" offers vs scheduled plows ----------
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
  new.driver_id    := null;
  new.accepted_at  := null;
  if new.scheduled_for is not null then
    -- card holds last about 7 days, so scheduled plows are limited to 6 days out
    if new.scheduled_for < now() + interval '1 hour' or new.scheduled_for > now() + interval '6 days 12 hours' then
      raise exception 'Pick a time at least an hour from now and within the next 6 days';
    end if;
    new.status     := 'scheduled';
    new.window_end := new.scheduled_for + interval '2 hours';
    new.expires_at := new.window_end;
  else
    new.status     := 'requested';
    new.window_end := null;
    new.expires_at := now() + interval '20 minutes';
  end if;
  new.claimed_at            := null;
  new.checked_in_at         := null;
  new.reminders_sent        := 0;
  new.released_at           := null;
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
  new.preferred_driver_ids  := null;
  new.exclusive_until       := null;
  new.tip                   := 0;
  return new;
end $$;

-- ---------- edits: route/check-in fields belong to DRIFT's server ----------
create or replace function public.jobs_before_update()
returns trigger language plpgsql as $$
begin
  if not public.is_system() then
    if new.customer_id  is distinct from old.customer_id
    or new.offer        is distinct from old.offer
    or new.price        is distinct from old.price
    or new.driver_pay   is distinct from old.driver_pay
    or new.platform_fee is distinct from old.platform_fee
    or new.callout_fee  is distinct from old.callout_fee
    or new.drift_fee    is distinct from old.drift_fee
    or new.tip          is distinct from old.tip
    or new.expires_at   is distinct from old.expires_at
    or new.scheduled_for  is distinct from old.scheduled_for
    or new.window_end     is distinct from old.window_end
    or new.claimed_at     is distinct from old.claimed_at
    or new.checked_in_at  is distinct from old.checked_in_at
    or new.reminders_sent is distinct from old.reminders_sent
    or new.released_at    is distinct from old.released_at then
      raise exception 'Job prices, times and ownership can''t be changed';
    end if;
    if new.payment_status        is distinct from old.payment_status
    or new.payment_intent_id     is distinct from old.payment_intent_id
    or new.payment_method_id     is distinct from old.payment_method_id
    or new.charge_id             is distinct from old.charge_id
    or new.payout_status         is distinct from old.payout_status
    or new.transfer_id           is distinct from old.transfer_id
    or new.tip_payment_intent_id is distinct from old.tip_payment_intent_id
    or new.tip_transfer_id       is distinct from old.tip_transfer_id
    or new.announced_at          is distinct from old.announced_at then
      raise exception 'Payment details can only be changed by DRIFT''s payment server';
    end if;
    if new.driver_id is distinct from old.driver_id
       and coalesce(current_setting('drift.claiming', true), '') <> 'on' then
      raise exception 'Drivers can only be assigned by accepting the job';
    end if;
    -- scheduled plows are started / claimed through DRIFT's server
    if (old.status = 'scheduled' and new.status not in ('scheduled', 'cancelled'))
       or (new.status = 'scheduled' and old.status <> 'scheduled') then
      raise exception 'Scheduled plows are started from the driver app';
    end if;
    if old.payment_status <> 'not_required' then
      if new.status = 'completed' and old.status <> 'completed' then
        raise exception 'Jobs are completed through the payment server';
      end if;
      if new.status in ('cancelled','expired') and old.status not in ('cancelled','expired') then
        raise exception 'Cancel through the payment server so the card hold is released';
      end if;
    end if;
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then new.cancelled_at := now(); end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end $$;

-- ---------- profiles: late cancels are DRIFT's; the sign-up source can be set once ----------
create or replace function public.profiles_driver_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_system() then
    if new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_account_id  is distinct from old.stripe_account_id
    or new.payouts_ready      is distinct from old.payouts_ready
    or new.suspended          is distinct from old.suspended
    or new.rating             is distinct from old.rating
    or new.ratings_count      is distinct from old.ratings_count
    or new.jobs_count         is distinct from old.jobs_count
    or new.late_cancels       is distinct from old.late_cancels
    or (old.ref_source is not null and new.ref_source is distinct from old.ref_source) then
      raise exception 'That part of your profile is managed by DRIFT';
    end if;
  end if;
  if new.is_driver and not coalesce(old.is_driver, false) then
    if not exists (select 1 from public.legal_acceptances
                   where user_id = new.id and role = 'driver') then
      raise exception 'Accept the Independent Contractor Agreement before driving';
    end if;
  end if;
  if not new.is_driver or new.suspended then new.is_online := false; end if;
  return new;
end $$;

-- ---------- who can see jobs ----------
-- Scheduled plows: active drivers see the ones nobody has claimed (to build a
-- route), plus ones whose driver missed check-in (45 min before the window).
create or replace function public.sched_open(j public.jobs) returns boolean
language sql stable as $$
  select j.status = 'scheduled' and j.window_end > now()
     and j.payment_status in ('authorized', 'not_required')
     and (j.driver_id is null
          or (j.checked_in_at is null and now() >= j.scheduled_for - interval '45 minutes')) $$;

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested' and expires_at > now()
      and payment_status in ('authorized', 'not_required')
      and public.is_active_driver(auth.uid())
      and (exclusive_until is null or exclusive_until <= now() or auth.uid() = any(preferred_driver_ids)))
  or (public.sched_open(jobs) and public.is_active_driver(auth.uid()) and customer_id <> auth.uid())
);

-- ---------- first tap wins (live offers) — now up to 3 jobs at once ----------
create or replace function public.claim_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare got uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_driver and not suspended) then
    raise exception 'Only active drivers can accept jobs';
  end if;
  if (select count(*) from jobs where driver_id = auth.uid() and status in ('accepted','enroute','plowing')) >= 3 then
    raise exception 'You already have 3 jobs lined up — finish one first';
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

-- For the customer: how many of their driver's jobs come before theirs (0 = you're next / now).
create or replace function public.queue_position(p_job uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from jobs o, jobs mine
   where mine.id = p_job and mine.customer_id = auth.uid() and mine.driver_id is not null
     and o.driver_id = mine.driver_id and o.id <> mine.id
     and o.status in ('accepted','enroute','plowing')
     and (o.status in ('enroute','plowing') or o.accepted_at < mine.accepted_at) $$;
revoke all on function public.queue_position(uuid) from public;
grant execute on function public.queue_position(uuid) to authenticated;

-- Done. You should see "Success. No rows returned."
