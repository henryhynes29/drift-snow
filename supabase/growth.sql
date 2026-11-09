-- ============================================================
-- DRIFT — raise offer, refunds, error log, daily activity + funnel (run once; safe to re-run)
--
-- 1. Jobs remember refunds (and anything taken back from the driver) and when
--    the customer raised their offer. Only DRIFT's server writes these.
-- 2. app_errors: app crashes and failed charges/payouts, for the owner dashboard.
-- 3. app_events: anonymous once-a-day visit / active / mapping events, for
--    "how many people were active today" and the booking funnel.
--    Phones can only add rows (never read them); the dashboard reads through the server.
-- ============================================================

-- ---------- 1. refunds + raised offers ----------
alter table public.jobs add column if not exists refunded_amount numeric not null default 0;
alter table public.jobs add column if not exists driver_clawback numeric not null default 0;
alter table public.jobs add column if not exists refund_note     text;
alter table public.jobs add column if not exists refunded_at     timestamptz;
alter table public.jobs add column if not exists offer_raised_at timestamptz;

create or replace function public.jobs_refund_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.refunded_amount := 0; new.driver_clawback := 0; new.refund_note := null;
    new.refunded_at := null; new.offer_raised_at := null;
  elsif not public.is_system() then
    if new.refunded_amount is distinct from old.refunded_amount
    or new.driver_clawback is distinct from old.driver_clawback
    or new.refund_note     is distinct from old.refund_note
    or new.refunded_at     is distinct from old.refunded_at
    or new.offer_raised_at is distinct from old.offer_raised_at then
      raise exception 'Refunds and offer changes are recorded by DRIFT''s server';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_refund_guard on public.jobs;
create trigger jobs_refund_guard before insert or update on public.jobs
  for each row execute function public.jobs_refund_guard();

-- ---------- 2. error log ----------
create table if not exists public.app_errors (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  kind       text not null default 'app' check (kind in ('app', 'server')),
  user_id    uuid,
  role       text,
  message    text not null,
  detail     text,
  url        text,
  ua         text
);
create index if not exists app_errors_created_idx on public.app_errors(created_at desc);
alter table public.app_errors enable row level security;
drop policy if exists app_errors_insert on public.app_errors;
create policy app_errors_insert on public.app_errors for insert to anon, authenticated
  with check (kind = 'app'
    and length(message) <= 500 and coalesce(length(detail), 0) <= 4000
    and coalesce(length(url), 0) <= 500 and coalesce(length(ua), 0) <= 300
    and coalesce(length(role), 0) <= 20
    and (user_id is null or user_id = auth.uid()));
grant insert on public.app_errors to anon, authenticated;
grant usage on sequence public.app_errors_id_seq to anon, authenticated;

-- ---------- 3. daily activity + funnel ----------
create table if not exists public.app_events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  day        date not null default (now() at time zone 'America/Chicago')::date,
  name       text not null check (name in ('visit', 'active', 'map_start', 'map_done', 'book', 'online')),
  anon_id    text not null check (length(anon_id) between 8 and 40),
  user_id    uuid,
  role       text check (role is null or role in ('customer', 'driver')),
  source     text check (source is null or length(source) <= 40),
  path       text check (path is null or length(path) <= 120)
);
create unique index if not exists app_events_once_a_day on public.app_events(day, name, anon_id);
create index if not exists app_events_day_idx on public.app_events(day);
alter table public.app_events enable row level security;
drop policy if exists app_events_insert on public.app_events;
create policy app_events_insert on public.app_events for insert to anon, authenticated
  with check (day = (now() at time zone 'America/Chicago')::date
    and (user_id is null or user_id = auth.uid()));
grant insert on public.app_events to anon, authenticated;
grant usage on sequence public.app_events_id_seq to anon, authenticated;

notify pgrst, 'reload schema';
-- Done.
