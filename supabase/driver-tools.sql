-- ============================================================
-- DRIFT — driver tools (run AFTER routes.sql). Safe to re-run.
--
--   1. Home zone: where a driver works from + how far they'll go.
--      Job alerts only go to drivers whose zone covers the job.
--   2. Mileage: miles driven on each job (for the driver's tax summary).
--   3. Problems: "car in the way", "can't reach it", "damage"... reported
--      from a job. DRIFT's server writes them; both people on the job and
--      the owner dashboard can see them.
-- ============================================================

-- ---------- 1. home zone ----------
alter table public.profiles add column if not exists home_lat       double precision;
alter table public.profiles add column if not exists home_lng       double precision;
alter table public.profiles add column if not exists home_radius_mi int;   -- null = anywhere in the service area
alter table public.profiles drop constraint if exists profiles_home_radius_check;
alter table public.profiles add constraint profiles_home_radius_check
  check (home_radius_mi is null or home_radius_mi between 1 and 60);

-- ---------- 2. miles driven on a job ----------
alter table public.jobs add column if not exists driver_miles numeric;

-- Only the job's driver can record miles, and only a sane number.
create or replace function public.jobs_miles_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.driver_miles := null;
  elsif new.driver_miles is distinct from old.driver_miles and not public.is_system() then
    if auth.uid() is distinct from old.driver_id then
      raise exception 'Only the driver can record miles';
    end if;
    if new.driver_miles is not null and (new.driver_miles < 0 or new.driver_miles > 300) then
      raise exception 'Miles must be between 0 and 300';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_miles_guard on public.jobs;
create trigger jobs_miles_guard before insert or update on public.jobs
  for each row execute function public.jobs_miles_guard();

-- ---------- 3. job problems ----------
create table if not exists public.job_issues (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  reporter_id uuid references public.profiles(id) on delete set null,
  kind        text not null check (kind in ('blocked','no_access','damage','unsafe','other')),
  note        text,
  released    boolean not null default false,   -- the driver gave the job back
  status      text not null default 'open' check (status in ('open','resolved')),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists job_issues_job_idx on public.job_issues(job_id);
create index if not exists job_issues_open_idx on public.job_issues(status) where status = 'open';
alter table public.job_issues enable row level security;
drop policy if exists issues_read on public.job_issues;
create policy issues_read on public.job_issues for select using (
  exists (select 1 from public.jobs j where j.id = job_id and (j.customer_id = auth.uid() or j.driver_id = auth.uid()))
  or reporter_id = auth.uid()
);
grant select on public.job_issues to authenticated;
grant all on public.job_issues to service_role;

-- driver backouts can now also be "released" (gave a live job back)
alter table public.driver_backouts drop constraint if exists driver_backouts_reason_check;

-- Done. You should see "Success. No rows returned."
