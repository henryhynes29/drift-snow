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
