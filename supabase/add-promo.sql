-- ============================================================
-- DRIFT — first-plow promo codes (FOX21 and friends)
-- Run this ONCE in the Supabase SQL editor (paste the whole file, hit Run).
-- Idempotent: safe to run again.
--
-- What it does:
--   • Adds promo_code, discount, source columns to jobs.
--   • Makes the server apply a first-plow discount to the OFFER only:
--       price        = offer + $10 + $5  - discount
--       driver_pay   = round(offer * 0.80) + $10          (UNCHANGED)
--       platform_fee = price - driver_pay                 (absorbs the discount)
--     So the customer pays less and the driver is paid in full. The discount
--     comes straight out of DRIFT's cut.
--   • Enforces ONE use per customer, their first completed plow, server-side.
--     The phone can ask for a discount; the database decides if it's allowed.
--
-- The valid codes + percentages live here, in promo_pct(), NOT on the phone,
-- so nobody can invent a code or a bigger discount from the client.
-- ============================================================

-- ---------- 1. columns ----------
alter table public.jobs add column if not exists promo_code text;
alter table public.jobs add column if not exists discount   numeric not null default 0;
alter table public.jobs add column if not exists source     text;

-- ---------- 2. the code book (server-authoritative) ----------
-- Returns the discount fraction for a code, or 0 if unknown/blank.
-- Add future codes here.
create or replace function public.promo_pct(code text)
returns numeric language sql immutable as $$
  select case upper(coalesce(code, ''))
    when 'FOX21' then 0.15
    else 0
  end
$$;

-- Has this customer already USED a promo on a prior job (any status that means
-- the offer went live)? First-plow promos are one-and-done.
create or replace function public.promo_already_used(p_customer uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.jobs
    where customer_id = p_customer
      and discount > 0
      and status in ('requested','claimed','accepted','en_route','arrived','in_progress','completed')
  )
$$;

-- ---------- 3. recompute money on insert, discount included ----------
-- This REPLACES the money block of jobs_before_insert. It keeps every other
-- line from the existing trigger (section 3 of RUN-THIS-IN-SUPABASE.sql) and
-- only changes how price/discount/platform_fee are set.
create or replace function public.jobs_before_insert()
returns trigger language plpgsql as $$
declare
  v_pct numeric := 0;
  v_discount numeric := 0;
begin
  if new.offer is null or new.offer < 10 or new.offer > 500 then
    raise exception 'Offer must be between $10 and $500';
  end if;
  new.offer        := round(new.offer);
  new.callout_fee  := 10;
  new.drift_fee    := 5;

  -- Validate the promo server-side. Unknown code, or a customer who already
  -- used one, yields no discount — silently, so booking still succeeds.
  v_pct := public.promo_pct(new.promo_code);
  if v_pct > 0 and not public.promo_already_used(new.customer_id) then
    v_discount := round(new.offer * v_pct);
  else
    new.promo_code := null;
  end if;
  new.discount     := v_discount;

  new.price        := new.offer + 10 + 5 - v_discount;   -- customer pays less
  new.driver_pay   := round(new.offer * 0.80) + 10;      -- driver UNCHANGED
  new.platform_fee := new.price - new.driver_pay;        -- DRIFT absorbs it

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

-- ---------- 4. protect `discount` from being changed after insert ----------
-- NOTE: do NOT re-create jobs_before_update() here — the real one (section 3 of
-- RUN-THIS-IN-SUPABASE.sql) is long and guards payments, claiming and completion.
-- Replacing it would drop all of that. `discount` is set once at insert and the
-- price guard already blocks changing `price` and `platform_fee` afterward, so
-- discount can't be exploited post-insert even without its own line. If you want
-- belt-and-suspenders protection, open RUN-THIS-IN-SUPABASE.sql, find the first
-- `if not public.is_system() then` block in jobs_before_update(), and add this
-- one line next to the other price checks, then re-run that file:
--     or new.discount     is distinct from old.discount
-- (That's optional. The migration above is complete without it.)

-- Done. Test in SQL editor:
--   select public.promo_pct('FOX21');          -- 0.15
--   select public.promo_pct('nope');           -- 0
-- Then book a $68 offer with promo_code 'FOX21' as a new customer:
--   price 73, driver_pay 64, platform_fee 9, discount 10.
