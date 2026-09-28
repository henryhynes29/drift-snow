-- ============================================================
-- DRIFT — live dispatch (run AFTER schema.sql). Safe to re-run.
--
-- Run order in Supabase SQL Editor: schema.sql -> legal_acceptances.sql -> dispatch.sql
--
-- What this adds:
--   1. Jobs carry the customer's OFFER plus a snapshot of the property
--      (address, map outline, hazards) so drivers can see what they'd accept.
--   2. The DATABASE computes every dollar amount from the offer — the phone
--      can't send a fake price or a fake driver payout.
--        customer total = offer + $10 call-out + $5 DRIFT fee
--        driver pay     = 80% of offer + $10 call-out
--   3. claim_job(): the first driver to tap Accept wins, atomically. Everyone
--      else gets "already taken." No one can be assigned any other way.
--   4. Offers expire after 5 minutes if nobody accepts.
--   5. Only drivers can see the open-job pool, and only jobs that are still live.
--   6. Realtime is switched on for jobs, messages and driver locations.
--   7. Only people who signed the driver agreement can be drivers.
-- ============================================================

-- ---------- 1. new columns ----------
alter table public.profiles add column if not exists is_driver boolean not null default false;

alter table public.jobs add column if not exists offer        numeric;
alter table public.jobs add column if not exists callout_fee  numeric;
alter table public.jobs add column if not exists drift_fee    numeric;
alter table public.jobs add column if not exists address      text;
alter table public.jobs add column if not exists lat          double precision;
alter table public.jobs add column if not exists lng          double precision;
alter table public.jobs add column if not exists site         jsonb default '{}'::jsonb;  -- outline, hazards, notes
alter table public.jobs add column if not exists expires_at   timestamptz;
alter table public.jobs add column if not exists accepted_at  timestamptz;
alter table public.jobs add column if not exists cancelled_at timestamptz;

-- allow the 'expired' status
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in ('requested','accepted','enroute','plowing','completed','cancelled','expired'));

-- properties drawn with the simple (non-satellite) editor keep their outline too
alter table public.properties add column if not exists zones jsonb default '[]'::jsonb;
alter table public.properties add column if not exists size  jsonb;

create index if not exists jobs_open_idx on public.jobs(status, expires_at) where driver_id is null;

-- ---------- 2. money is computed by the database ----------
-- Change these numbers here (and in src/App.jsx) if you change your fees.
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
  new.expires_at   := now() + interval '5 minutes';
  return new;
end $$;

drop trigger if exists t_jobs_before_insert on public.jobs;
create trigger t_jobs_before_insert before insert on public.jobs
  for each row execute function public.jobs_before_insert();

-- After insert, nobody can change the money, the customer, or who the driver is
-- (except claim_job, which sets a flag for itself).
create or replace function public.jobs_before_update()
returns trigger language plpgsql as $$
begin
  if new.customer_id  is distinct from old.customer_id
  or new.offer        is distinct from old.offer
  or new.price        is distinct from old.price
  or new.driver_pay   is distinct from old.driver_pay
  or new.platform_fee is distinct from old.platform_fee
  or new.callout_fee  is distinct from old.callout_fee
  or new.drift_fee    is distinct from old.drift_fee
  or new.expires_at   is distinct from old.expires_at then
    raise exception 'Job prices and ownership can''t be changed';
  end if;
  if new.driver_id is distinct from old.driver_id
     and coalesce(current_setting('drift.claiming', true), '') <> 'on' then
    raise exception 'Drivers can only be assigned by accepting the job';
  end if;
  if new.status = 'cancelled' and old.status <> 'cancelled' then new.cancelled_at := now(); end if;
  if new.status = 'completed' and new.completed_at is null then new.completed_at := now(); end if;
  return new;
end $$;

drop trigger if exists t_jobs_before_update on public.jobs;
create trigger t_jobs_before_update before update on public.jobs
  for each row execute function public.jobs_before_update();

-- ---------- 3. first tap wins ----------
-- Returns the job id if YOU got it, or null if someone else did / it expired.
create or replace function public.claim_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare got uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_driver) then
    raise exception 'Only drivers can accept jobs';
  end if;
  perform set_config('drift.claiming', 'on', true);
  update jobs
     set driver_id = auth.uid(), status = 'accepted', accepted_at = now()
   where id = p_job
     and status = 'requested'
     and driver_id is null
     and expires_at > now()
     and customer_id <> auth.uid()
  returning id into got;
  perform set_config('drift.claiming', 'off', true);
  return got;
end $$;

revoke all on function public.claim_job(uuid) from public;
grant execute on function public.claim_job(uuid) to authenticated;

-- ---------- 3b. only people who signed the driver agreement can be drivers ----------
-- The app flips profiles.is_driver on after the Independent Contractor Agreement
-- is accepted. This makes sure nobody can skip that step by editing their profile.
create or replace function public.profiles_driver_guard()
returns trigger language plpgsql as $$
begin
  if new.is_driver and not coalesce(old.is_driver, false) then
    if not exists (select 1 from public.legal_acceptances
                   where user_id = new.id and role = 'driver') then
      raise exception 'Accept the Independent Contractor Agreement before driving';
    end if;
  end if;
  if not new.is_driver then new.is_online := false; end if;
  return new;
end $$;

drop trigger if exists t_profiles_driver_guard on public.profiles;
create trigger t_profiles_driver_guard before update on public.profiles
  for each row execute function public.profiles_driver_guard();

-- ---------- 4/5. who can see and change jobs ----------
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested' and expires_at > now()
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_driver))
);

drop policy if exists jobs_customer_insert on public.jobs;
create policy jobs_customer_insert on public.jobs for insert with check (auth.uid() = customer_id);

-- The customer (to cancel / expire) and the assigned driver (to move the job
-- along) can update. Nobody else. The trigger above blocks money/ownership edits.
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update using (
  auth.uid() = customer_id or auth.uid() = driver_id
);

-- ---------- 6. realtime ----------
-- Phones get instant updates for jobs, chat messages and the driver's location.
do $$
declare t text;
begin
  foreach t in array array['jobs','messages','driver_locations'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Done. You should see "Success. No rows returned."
