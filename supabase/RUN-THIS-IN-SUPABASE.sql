-- ============================================================
-- DRIFT — ALL-IN-ONE database setup. Paste this whole file into
-- Supabase → SQL Editor → New query → Run. Safe to run again.
-- (schema + legal_acceptances + dispatch + payments + alerts + admin + stats + favorites, in order.)
-- ============================================================

-- ============================================================
-- DRIFT — database schema for Supabase (Postgres)
-- ------------------------------------------------------------
-- HOW TO USE:
--   1. Create a project at supabase.com
--   2. Open the SQL Editor
--   3. Paste this whole file and click Run
--   4. Enable Realtime for: jobs, messages, driver_locations
--      (Database → Replication → toggle those tables on)
--
-- Safe to re-run: it drops/recreates policies and uses IF NOT EXISTS.
-- ============================================================

-- ---- extensions ----
create extension if not exists "pgcrypto";

-- ============================================================
-- PROFILES  (one row per signed-in user; extends auth.users)
-- ============================================================
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          text not null default 'customer' check (role in ('customer','driver')),
  name          text,
  phone         text,
  email         text,
  referral_code text,

  -- driver-only fields (null for customers)
  truck              text,
  tools              text[] default '{}',
  tier               text default 'Rookie',
  rating             numeric default 5.0,
  jobs_count         int default 0,
  is_online          boolean default false,
  stripe_account_id  text,           -- Stripe Connect account
  insurance_status   text default 'pending' check (insurance_status in ('pending','verified','none')),
  docs               jsonb default '{}'::jsonb,   -- {license, plate, w9, ...}

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ============================================================
-- PROPERTIES  (a customer's mapped driveway/lot)
-- ============================================================
create table if not exists public.properties (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  label         text default 'Home',
  address       text,
  lat           double precision,
  lng           double precision,
  center        jsonb,                 -- { lng, lat }
  features      jsonb default '[]'::jsonb,  -- GeoJSON plow/push polygons
  sqft          int default 0,             -- measured plow area
  grade         text default 'flat' check (grade in ('flat','moderate','steep')),
  hazards       text[] default '{}',
  shared        boolean default false,
  map_img       text,                  -- Mapbox static image URL of the outline
  instructions  text,                  -- custom notes for the plower

  auto_plow            boolean default false,
  auto_plow_threshold  int default 2,  -- inches of snow that triggers dispatch

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists properties_owner_idx on public.properties(owner_id);

-- ============================================================
-- JOBS  (the shared record both sides act on)
-- ============================================================
create table if not exists public.jobs (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references public.properties(id) on delete set null,
  customer_id   uuid not null references public.profiles(id) on delete cascade,
  driver_id     uuid references public.profiles(id) on delete set null,

  job_type      text not null default 'driveway',   -- driveway|sidewalk|digout|commercial|jumpstart
  status        text not null default 'requested'
                  check (status in ('requested','accepted','enroute','plowing','completed','cancelled')),
  tool          text,
  salt          boolean default false,
  instructions  text,

  quote         jsonb,                 -- full price breakdown snapshot
  price         numeric,               -- what the customer pays
  driver_pay    numeric,               -- what the driver earns
  platform_fee  numeric,               -- your cut

  scheduled_for timestamptz,           -- null = on-demand now
  eta_minutes   int,
  driver_pos    jsonb,                 -- { lng, lat } live-ish snapshot
  photos        jsonb default '{"before":[],"after":[]}'::jsonb,

  tip           numeric default 0,
  rating        int,                   -- customer's rating of this job

  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);
create index if not exists jobs_customer_idx on public.jobs(customer_id);
create index if not exists jobs_driver_idx   on public.jobs(driver_id);
create index if not exists jobs_status_idx   on public.jobs(status);

-- ============================================================
-- MESSAGES  (chat thread per job)
-- ============================================================
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  sender_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists messages_job_idx on public.messages(job_id);

-- ============================================================
-- DRIVER_LOCATIONS  (live GPS, one row per driver, upserted)
-- ============================================================
create table if not exists public.driver_locations (
  driver_id  uuid primary key references public.profiles(id) on delete cascade,
  lng        double precision,
  lat        double precision,
  heading    double precision,
  updated_at timestamptz not null default now()
);

-- ============================================================
-- RATINGS  (two-way)
-- ============================================================
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  rater_id   uuid not null references public.profiles(id) on delete cascade,
  ratee_id   uuid not null references public.profiles(id) on delete cascade,
  stars      int not null check (stars between 1 and 5),
  comment    text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- PAYOUTS  (driver earnings ledger; mirrors Stripe transfers)
-- ============================================================
create table if not exists public.payouts (
  id                 uuid primary key default gen_random_uuid(),
  driver_id          uuid not null references public.profiles(id) on delete cascade,
  job_id             uuid references public.jobs(id) on delete set null,
  amount             numeric not null,
  status             text not null default 'pending' check (status in ('pending','paid','failed')),
  stripe_transfer_id text,
  created_at         timestamptz not null default now()
);

-- ============================================================
-- REFERRALS  (two-sided)
-- ============================================================
create table if not exists public.referrals (
  id          uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  code        text,
  invitee     text,
  kind        text default 'rider' check (kind in ('rider','driver')),
  status      text default 'joined',
  reward      numeric default 0,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- updated_at helper + triggers
-- ============================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists t_profiles_touch on public.profiles;
create trigger t_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists t_properties_touch on public.properties;
create trigger t_properties_touch before update on public.properties
  for each row execute function public.touch_updated_at();

-- ============================================================
-- Auto-create a profile row when a user signs up.
-- Role + name are passed in auth metadata at signup time.
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', ''),
    coalesce(new.raw_user_meta_data->>'role', 'customer'),
    new.raw_user_meta_data->>'phone'
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table public.profiles         enable row level security;
alter table public.properties       enable row level security;
alter table public.jobs             enable row level security;
alter table public.messages         enable row level security;
alter table public.driver_locations enable row level security;
alter table public.ratings          enable row level security;
alter table public.payouts          enable row level security;
alter table public.referrals        enable row level security;

-- profiles: everyone can read basic profiles (needed to show driver/customer cards);
-- you can only edit your own.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update using (auth.uid() = id);

-- properties: only the owner can see/manage their properties.
drop policy if exists properties_owner_all on public.properties;
create policy properties_owner_all on public.properties for all
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- jobs: the customer and the assigned driver can see the job.
-- Online drivers can also see unassigned 'requested' jobs (the dispatch pool).
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested')
);
drop policy if exists jobs_customer_insert on public.jobs;
create policy jobs_customer_insert on public.jobs for insert with check (auth.uid() = customer_id);
-- customer or the assigned driver can update (accept, progress, complete, cancel).
drop policy if exists jobs_update on public.jobs;
create policy jobs_update on public.jobs for update using (
  auth.uid() = customer_id or auth.uid() = driver_id
  or (driver_id is null and status = 'requested')  -- allow a driver to claim it
);

-- messages: only the two people on the job.
drop policy if exists messages_participants on public.messages;
create policy messages_participants on public.messages for select using (
  exists (select 1 from public.jobs j where j.id = job_id
          and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
);
drop policy if exists messages_send on public.messages;
create policy messages_send on public.messages for insert with check (
  sender_id = auth.uid()
  and exists (select 1 from public.jobs j where j.id = job_id
              and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
);

-- driver_locations: a driver writes their own; anyone on that driver's active job can read.
drop policy if exists driverloc_self_write on public.driver_locations;
create policy driverloc_self_write on public.driver_locations for all
  using (auth.uid() = driver_id) with check (auth.uid() = driver_id);
drop policy if exists driverloc_read on public.driver_locations;
create policy driverloc_read on public.driver_locations for select using (
  exists (select 1 from public.jobs j
          where j.driver_id = driver_locations.driver_id
          and j.customer_id = auth.uid()
          and j.status in ('accepted','enroute','plowing'))
);

-- ratings: participants of the job can write; ratee + rater can read.
drop policy if exists ratings_rw on public.ratings;
create policy ratings_rw on public.ratings for all
  using (auth.uid() = rater_id or auth.uid() = ratee_id)
  with check (auth.uid() = rater_id);

-- payouts: a driver sees only their own.
drop policy if exists payouts_own on public.payouts;
create policy payouts_own on public.payouts for select using (auth.uid() = driver_id);

-- referrals: you see your own.
drop policy if exists referrals_own on public.referrals;
create policy referrals_own on public.referrals for all
  using (auth.uid() = referrer_id) with check (auth.uid() = referrer_id);

-- ============================================================
-- Driver recruiting leads (from the public /drive.html signup page).
-- Written server-side via the service role key, so no public RLS insert policy
-- is needed. Only you (via the service role / admin) read these.
-- ============================================================
create table if not exists public.driver_applications (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,
  email       text,
  area        text,          -- town / ZIP they cover
  equipment   text,          -- plow truck, snowblower, skid steer, etc.
  experience  text,
  status      text not null default 'new'
                check (status in ('new','contacted','onboarding','active','declined')),
  created_at  timestamptz not null default now()
);
alter table public.driver_applications enable row level security;
-- No public policies: inserts happen with the service role key from /api/driver-signup.

-- ============================================================
-- DONE. Next: enable Realtime on jobs, messages, driver_locations
-- in Database → Replication, then add your keys to the app.
-- ============================================================


-- ============================================================
-- DRIFT — signed legal agreements (clickwrap audit trail)
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Every time a customer agrees to the Terms + Release, or a driver agrees to the
-- Independent Contractor Agreement, the app inserts a row here. Rows are
-- append-only: users can insert their own and read their own, never edit or
-- delete. This is the record you'd show a court or an arbitrator.
-- ============================================================
create table if not exists public.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,  -- kept if the account is later deleted
  role         text not null check (role in ('customer','driver')),
  documents    text[] not null,          -- e.g. {customerTerms, customerRelease}
  version      text not null,            -- LEGAL_VERSION from src/legal.js
  accepted_at  timestamptz not null,     -- time on the device when they tapped Agree
  recorded_at  timestamptz not null default now(),  -- time the server received it
  user_agent   text
);
create index if not exists legal_acceptances_user_idx on public.legal_acceptances(user_id);

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_insert_own on public.legal_acceptances;
create policy legal_insert_own on public.legal_acceptances for insert with check (auth.uid() = user_id);

drop policy if exists legal_read_own on public.legal_acceptances;
create policy legal_read_own on public.legal_acceptances for select using (auth.uid() = user_id);
-- (no update / delete policies on purpose — the record can't be altered from the app)


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


-- ============================================================
-- DRIFT — payments (run AFTER dispatch.sql). Safe to re-run.
--
-- What this adds:
--   1. A switch (app_settings.require_payment). While it's OFF the app works
--      like before with no card needed. Turn it ON once Stripe keys are in
--      Vercel — from then on a job only reaches drivers after the customer's
--      card is held, and only the payment server can mark a job complete.
--   2. Payment fields on jobs and profiles that ONLY the server can change
--      (the server uses the service-role key; phones can't touch these).
--   3. Drivers only see offers whose card hold went through.
-- ============================================================

-- ---------- 1. the on/off switch ----------
create table if not exists public.app_settings (
  id              int primary key default 1 check (id = 1),
  require_payment boolean not null default false
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
alter table public.app_settings enable row level security;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select using (true);
-- (no insert/update policy: change it only from the SQL Editor)

create or replace function public.payments_required() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select require_payment from app_settings where id = 1), false) $$;

-- Is this request coming from DRIFT's own server (service-role key)?
create or replace function public.is_system() returns boolean
language sql stable as $$
  select current_user in ('service_role', 'postgres', 'supabase_admin') $$;

-- ---------- 2. new columns ----------
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists payouts_ready      boolean not null default false;
-- (profiles.stripe_account_id already exists from schema.sql)

alter table public.jobs add column if not exists payment_status        text not null default 'not_required';
alter table public.jobs add column if not exists payment_intent_id     text;
alter table public.jobs add column if not exists payment_method_id     text;
alter table public.jobs add column if not exists charge_id             text;
alter table public.jobs add column if not exists payout_status         text not null default 'none';
alter table public.jobs add column if not exists transfer_id           text;
alter table public.jobs add column if not exists tip_payment_intent_id text;
alter table public.jobs add column if not exists tip_transfer_id       text;
alter table public.jobs add column if not exists announced_at          timestamptz;

alter table public.jobs drop constraint if exists jobs_payment_status_check;
alter table public.jobs add constraint jobs_payment_status_check check (payment_status in
  ('not_required','pending','authorized','captured','canceled','failed','refunded','disputed'));
alter table public.jobs drop constraint if exists jobs_payout_status_check;
alter table public.jobs add constraint jobs_payout_status_check check (payout_status in
  ('none','owed','paid','failed'));

create index if not exists jobs_payment_intent_idx on public.jobs(payment_intent_id);

-- ---------- 3. jobs: money + payment fields are server-only ----------
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
  new.payment_status        := case when public.payments_required() then 'pending' else 'not_required' end;
  new.payment_intent_id     := null;
  new.payment_method_id     := null;
  new.charge_id             := null;
  new.payout_status         := 'none';
  new.transfer_id           := null;
  new.tip_payment_intent_id := null;
  new.tip_transfer_id       := null;
  new.announced_at          := null;
  new.tip                   := 0;
  return new;
end $$;

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
    or new.expires_at   is distinct from old.expires_at then
      raise exception 'Job prices and ownership can''t be changed';
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
    -- With payments on, finishing a job (which charges the card) and cancelling a
    -- held card go through the payment server.
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

-- ---------- 4. profiles: Stripe fields are server-only ----------
create or replace function public.profiles_driver_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_system() then
    if new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_account_id  is distinct from old.stripe_account_id
    or new.payouts_ready      is distinct from old.payouts_ready
    or new.rating             is distinct from old.rating
    or new.jobs_count         is distinct from old.jobs_count then
      raise exception 'That part of your profile is managed by DRIFT';
    end if;
  end if;
  if new.is_driver and not coalesce(old.is_driver, false) then
    if not exists (select 1 from public.legal_acceptances
                   where user_id = new.id and role = 'driver') then
      raise exception 'Accept the Independent Contractor Agreement before driving';
    end if;
  end if;
  if not new.is_driver then new.is_online := false; end if;
  return new;
end $$;

-- ---------- 5. drivers only see offers whose card is held ----------
drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested' and expires_at > now()
      and payment_status in ('authorized', 'not_required')
      and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_driver))
);

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
     and payment_status in ('authorized', 'not_required')
     and customer_id <> auth.uid()
  returning id into got;
  perform set_config('drift.claiming', 'off', true);
  return got;
end $$;
revoke all on function public.claim_job(uuid) from public;
grant execute on function public.claim_job(uuid) to authenticated;

-- Done. You should see "Success. No rows returned."
-- LATER, once Stripe keys are in Vercel and you've tested, turn payments on with:
--   update public.app_settings set require_payment = true where id = 1;


-- ============================================================
-- DRIFT — job alerts for drivers (run AFTER payments.sql). Safe to re-run.
-- Stores each driver phone's push "address" so DRIFT's server can send a
-- "New plow request" alert when the app is closed.
-- ============================================================
create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;

drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions for select using (auth.uid() = user_id);
drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions for insert with check (auth.uid() = user_id);
drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions for update using (auth.uid() = user_id);
drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions for delete using (auth.uid() = user_id);

-- When a job's alert went out (so drivers are only pinged once per offer).
alter table public.jobs add column if not exists announced_at timestamptz;

-- Done. You should see "Success. No rows returned."


-- ============================================================
-- DRIFT — real photos, driver documents, owner controls
-- (run AFTER alerts.sql). Safe to re-run.
--
--   1. Private photo storage for before/after job photos. Only the job's
--      driver can upload; only that driver and that customer can view.
--   2. Private storage for driver documents (driver's license, vehicle
--      registration). Only the driver can upload/see their own; the owner
--      sees them through the owner dashboard (server, service-role key).
--   3. A driver_documents table: what was uploaded, when, and whether the
--      owner approved it.
--   4. profiles.suspended: the owner can switch a driver off. Suspended
--      drivers can't see or accept jobs.
-- ============================================================

-- ---------- storage buckets (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-photos', 'job-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('driver-docs', 'driver-docs', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- job photos live at  job-photos/<job id>/<before|after>-<time>.jpg
drop policy if exists "drift job photos upload" on storage.objects;
create policy "drift job photos upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'job-photos' and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
      and j.driver_id = auth.uid()
      and j.status in ('accepted','enroute','plowing','completed')
  )
);
drop policy if exists "drift job photos view" on storage.objects;
create policy "drift job photos view" on storage.objects for select to authenticated using (
  bucket_id = 'job-photos' and exists (
    select 1 from public.jobs j
    where j.id::text = (storage.foldername(name))[1]
      and (j.driver_id = auth.uid() or j.customer_id = auth.uid())
  )
);

-- driver documents live at  driver-docs/<user id>/<kind>-<time>.jpg
drop policy if exists "drift driver docs upload" on storage.objects;
create policy "drift driver docs upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "drift driver docs view own" on storage.objects;
create policy "drift driver docs view own" on storage.objects for select to authenticated using (
  bucket_id = 'driver-docs' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------- driver documents ----------
create table if not exists public.driver_documents (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('license','registration','insurance','other')),
  path         text not null,                 -- driver-docs/<user id>/...
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  note         text,                          -- owner's note, e.g. "photo blurry"
  uploaded_at  timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index if not exists driver_documents_user_idx on public.driver_documents(user_id, kind, uploaded_at desc);
alter table public.driver_documents enable row level security;

drop policy if exists driver_docs_insert_own on public.driver_documents;
create policy driver_docs_insert_own on public.driver_documents for insert with check (
  auth.uid() = user_id and status = 'pending' and note is null and reviewed_at is null
  and split_part(path, '/', 1) = auth.uid()::text
);
drop policy if exists driver_docs_read_own on public.driver_documents;
create policy driver_docs_read_own on public.driver_documents for select using (auth.uid() = user_id);
-- (no update/delete policies: only the owner dashboard can review)

-- ---------- suspension ----------
alter table public.profiles add column if not exists suspended boolean not null default false;

create or replace function public.profiles_driver_guard()
returns trigger language plpgsql as $$
begin
  if not public.is_system() then
    if new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_account_id  is distinct from old.stripe_account_id
    or new.payouts_ready      is distinct from old.payouts_ready
    or new.suspended          is distinct from old.suspended
    or new.rating             is distinct from old.rating
    or new.jobs_count         is distinct from old.jobs_count then
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

-- Helpers that look up profiles/jobs without triggering each other's
-- row-level rules (avoids an infinite loop between the two policies).
create or replace function public.is_active_driver(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = uid and is_driver and not suspended) $$;
create or replace function public.shares_job(me uuid, other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jobs
                 where (customer_id = me and driver_id = other) or (driver_id = me and customer_id = other)) $$;
revoke all on function public.is_active_driver(uuid) from public;
revoke all on function public.shares_job(uuid, uuid) from public;
grant execute on function public.is_active_driver(uuid) to authenticated;
grant execute on function public.shares_job(uuid, uuid) to authenticated;

drop policy if exists jobs_read on public.jobs;
create policy jobs_read on public.jobs for select using (
  auth.uid() = customer_id
  or auth.uid() = driver_id
  or (driver_id is null and status = 'requested' and expires_at > now()
      and payment_status in ('authorized', 'not_required')
      and public.is_active_driver(auth.uid()))
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
  returning id into got;
  perform set_config('drift.claiming', 'off', true);
  return got;
end $$;
revoke all on function public.claim_job(uuid) from public;
grant execute on function public.claim_job(uuid) to authenticated;

-- ---------- privacy: who can see whose profile ----------
-- Before: any signed-in user could read everyone's phone and email.
-- Now: you can read your own profile, and the other person on a job you share
-- (customer <-> their driver). The owner dashboard reads everything server-side.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (
  auth.uid() = id or public.shares_job(auth.uid(), id)
);


-- ---------- safety: every account has a profile row ----------
-- (Accounts made before the sign-up trigger existed would otherwise load as blank.)
insert into public.profiles (id, email, name, role, phone)
select u.id, u.email, coalesce(u.raw_user_meta_data->>'name', ''),
       coalesce(u.raw_user_meta_data->>'role', 'customer'), u.raw_user_meta_data->>'phone'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Done. You should see "Success. No rows returned."


-- ============================================================
-- DRIFT — real driver stats (run AFTER admin.sql). Safe to re-run.
--
--   * A driver's "jobs done" count goes up by one each time a job they're on
--     is completed (it used to stay at 0).
--   * A driver's star rating is the real average of the ratings customers gave
--     them. New drivers show "New driver" instead of a made-up 5.0.
--   * Ratings can only be left by the customer or driver ON that job, once per
--     job each, after it's completed. Customers can add a short written review.
--   * A customer can read the reviews of the driver on their job.
-- ============================================================

-- New drivers have no rating until someone rates them.
alter table public.profiles alter column rating drop default;
alter table public.profiles add column if not exists ratings_count int not null default 0;

-- Only DRIFT (the server / database) can change ratings, counts and payout fields.
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
    or new.jobs_count         is distinct from old.jobs_count then
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

-- ---------- jobs done ----------
create or replace function public.count_completed_job()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' and new.driver_id is not null then
    update profiles set jobs_count = coalesce(jobs_count, 0) + 1 where id = new.driver_id;
  end if;
  return new;
end $$;
drop trigger if exists t_jobs_count_completed on public.jobs;
create trigger t_jobs_count_completed after update of status on public.jobs
  for each row execute function public.count_completed_job();

-- ---------- ratings ----------
-- keep only the first rating per person per job (older test data may have repeats)
delete from public.ratings a using public.ratings b
 where a.job_id = b.job_id and a.rater_id = b.rater_id and (a.created_at, a.id) > (b.created_at, b.id);
create unique index if not exists ratings_one_per_job on public.ratings(job_id, rater_id);
alter table public.ratings drop constraint if exists ratings_comment_len;
alter table public.ratings add constraint ratings_comment_len check (comment is null or char_length(comment) <= 500);

drop policy if exists ratings_rw on public.ratings;
drop policy if exists ratings_read on public.ratings;
drop policy if exists ratings_insert on public.ratings;
-- You can read reviews you wrote, reviews about you, and reviews about the
-- driver on your job (so customers can see what others said). Reviewers stay anonymous.
create policy ratings_read on public.ratings for select
  using (auth.uid() = rater_id or auth.uid() = ratee_id or public.shares_job(auth.uid(), ratee_id));
create policy ratings_insert on public.ratings for insert with check (
  auth.uid() = rater_id and exists (
    select 1 from public.jobs j
    where j.id = job_id and j.status = 'completed'
      and ((j.customer_id = auth.uid() and j.driver_id = ratee_id)
        or (j.driver_id = auth.uid() and j.customer_id = ratee_id))
  )
);
-- (no update/delete: a rating, once left, stays)

create or replace function public.refresh_rating()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update profiles
     set rating = (select round(avg(stars)::numeric, 2) from ratings where ratee_id = new.ratee_id),
         ratings_count = (select count(*) from ratings where ratee_id = new.ratee_id)
   where id = new.ratee_id;
  return new;
end $$;
drop trigger if exists t_ratings_refresh on public.ratings;
create trigger t_ratings_refresh after insert on public.ratings
  for each row execute function public.refresh_rating();

-- ---------- fix up existing accounts ----------
-- Real averages where ratings exist; no rating (blank) where nobody has rated yet.
update public.profiles p
   set rating = (select round(avg(r.stars)::numeric, 2) from public.ratings r where r.ratee_id = p.id),
       ratings_count = (select count(*) from public.ratings r where r.ratee_id = p.id);
-- Real completed-job counts.
update public.profiles p
   set jobs_count = (select count(*) from public.jobs j where j.driver_id = p.id and j.status = 'completed');

-- Done. You should see "Success. No rows returned."


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


