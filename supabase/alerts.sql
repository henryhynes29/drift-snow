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
