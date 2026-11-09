-- ============================================================
-- DRIFT — customer problem reports, website reviews, account deletion (run once; safe to re-run)
--
-- 1. Customers can report a problem within 48 hours of a job, with a photo.
--    Photos go in a private issue-photos bucket: issue-photos/<customer id>/<job id>/<time>.jpg
-- 2. Ratings remember whether the customer said OK to show their review on the website.
-- 3. Profiles remember when an account was deleted (the person's details are wiped,
--    job and payment records are kept for taxes and Stripe).
-- 4. A driver can't end up with more than 3 jobs by tapping Accept on two phones at once.
-- ============================================================

-- ---------- 1. problem reports ----------
alter table public.job_issues add column if not exists photos jsonb not null default '[]'::jsonb;
alter table public.job_issues drop constraint if exists job_issues_kind_check;
alter table public.job_issues add constraint job_issues_kind_check check (kind in
  ('blocked', 'no_access', 'damage', 'unsafe', 'other', 'missed', 'piles', 'not_done'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('issue-photos', 'issue-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "drift issue photos upload" on storage.objects;
create policy "drift issue photos upload" on storage.objects for insert to authenticated with check (
  bucket_id = 'issue-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.jobs j where j.id::text = (storage.foldername(name))[2] and j.customer_id = auth.uid())
);
drop policy if exists "drift issue photos view own" on storage.objects;
create policy "drift issue photos view own" on storage.objects for select to authenticated using (
  bucket_id = 'issue-photos' and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------- 2. reviews on the website (opt-in) ----------
alter table public.ratings add column if not exists public_ok boolean not null default false;

-- ---------- 3. deleted accounts ----------
alter table public.profiles add column if not exists deleted_at timestamptz;

-- ---------- 4. accepting jobs: one at a time per driver ----------
-- Found in the storm-night dry run: a driver tapping Accept on two phones/tabs at the same
-- instant could end up with 4 jobs (limit is 3). Each driver's accepts now take turns.
create or replace function public.claim_job(p_job uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare got uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and is_driver and not suspended) then
    raise exception 'Only active drivers can accept jobs';
  end if;
  perform pg_advisory_xact_lock(hashtext('drift-claim:' || auth.uid()::text));
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

notify pgrst, 'reload schema';
-- Done.
