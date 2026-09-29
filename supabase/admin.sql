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

-- Done. You should see "Success. No rows returned."
