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
    or new.tip_transfer_id       is distinct from old.tip_transfer_id then
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
