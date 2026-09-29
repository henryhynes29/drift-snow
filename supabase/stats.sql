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
