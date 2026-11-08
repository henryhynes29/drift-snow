-- ============================================================
-- DRIFT — job proof, driver presence, chat privacy (run once; safe to re-run)
--
-- 1. Jobs remember when and where the driver arrived and finished, so a job
--    can only be completed at the property (checked by the payment server).
--    A job's map pin can't be moved after booking.
-- 2. Customers can confirm or dispute a job the driver forgot to finish.
-- 3. Payouts can be held (no photos) until DRIFT or the customer confirms.
-- 4. Drivers' phones check in while online, so idle or closed apps go offline.
-- 5. Phone numbers and email addresses are hidden in job chat.
-- ============================================================

-- ---------- 1–3. jobs ----------
alter table public.jobs add column if not exists arrived_at            timestamptz;
alter table public.jobs add column if not exists arrived_lat           double precision;
alter table public.jobs add column if not exists arrived_lng           double precision;
alter table public.jobs add column if not exists completed_lat         double precision;
alter table public.jobs add column if not exists completed_lng         double precision;
alter table public.jobs add column if not exists completed_by          text;   -- driver | customer | auto | cancel
alter table public.jobs add column if not exists confirm_asked_at      timestamptz;
alter table public.jobs add column if not exists customer_confirmed_at timestamptz;
alter table public.jobs add column if not exists disputed_at           timestamptz;
alter table public.jobs add column if not exists payout_hold_reason    text;

alter table public.jobs drop constraint if exists jobs_payout_status_check;
alter table public.jobs add constraint jobs_payout_status_check check (payout_status in
  ('none','owed','paid','failed','held'));

-- Only DRIFT's server writes the proof fields (the phone can't fake an arrival).
create or replace function public.jobs_proof_guard()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.arrived_at := null; new.arrived_lat := null; new.arrived_lng := null;
    new.completed_lat := null; new.completed_lng := null; new.completed_by := null;
    new.confirm_asked_at := null; new.customer_confirmed_at := null; new.disputed_at := null;
    new.payout_hold_reason := null;
  elsif not public.is_system() then
    if new.arrived_at            is distinct from old.arrived_at
    or new.arrived_lat           is distinct from old.arrived_lat
    or new.arrived_lng           is distinct from old.arrived_lng
    or new.completed_lat         is distinct from old.completed_lat
    or new.completed_lng         is distinct from old.completed_lng
    or new.completed_by          is distinct from old.completed_by
    or new.confirm_asked_at      is distinct from old.confirm_asked_at
    or new.customer_confirmed_at is distinct from old.customer_confirmed_at
    or new.disputed_at           is distinct from old.disputed_at
    or new.payout_hold_reason    is distinct from old.payout_hold_reason then
      raise exception 'Arrival and completion are recorded by DRIFT''s server';
    end if;
    -- The job's map pin is what "at the property" is checked against.
    if new.lat is distinct from old.lat or new.lng is distinct from old.lng then
      raise exception 'A job''s location can''t be changed after it''s booked';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_proof_guard on public.jobs;
create trigger jobs_proof_guard before insert or update on public.jobs
  for each row execute function public.jobs_proof_guard();

create index if not exists jobs_arrived_open_idx on public.jobs(arrived_at)
  where status in ('accepted','enroute','plowing');

-- ---------- 4. driver presence ----------
alter table public.profiles add column if not exists last_seen_at   timestamptz;  -- phone check-in while online
alter table public.profiles add column if not exists online_since   timestamptz;
alter table public.profiles add column if not exists active_at      timestamptz;  -- last accept / "I'm still here"
alter table public.profiles add column if not exists idle_warned_at timestamptz;
alter table public.profiles add column if not exists offline_reason text;         -- idle | app_closed (shown once in the app)

create or replace function public.profiles_presence()
returns trigger language plpgsql as $$
begin
  if coalesce(new.is_online, false) and not coalesce(old.is_online, false) then
    new.online_since   := now();
    new.active_at      := now();
    new.last_seen_at   := now();
    new.idle_warned_at := null;
    new.offline_reason := null;
  elsif not coalesce(new.is_online, false) and coalesce(old.is_online, false) then
    new.online_since   := null;
    new.idle_warned_at := null;
    if not public.is_system() then new.offline_reason := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_presence on public.profiles;
create trigger profiles_presence before update on public.profiles
  for each row execute function public.profiles_presence();

-- The owner map reads driver locations through the server (service role), so
-- nothing changes for who can see a driver's location in the app.

-- ---------- 5. chat: hide phone numbers and emails ----------
create or replace function public.messages_hide_contact()
returns trigger language plpgsql as $$
begin
  new.body := regexp_replace(new.body, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email hidden]', 'g');
  new.body := regexp_replace(new.body, '(\+?1[ .-]?)?\(?[0-9]{3}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}', '[number hidden]', 'g');
  return new;
end $$;
drop trigger if exists messages_hide_contact on public.messages;
create trigger messages_hide_contact before insert or update on public.messages
  for each row execute function public.messages_hide_contact();

notify pgrst, 'reload schema';
-- Done.
