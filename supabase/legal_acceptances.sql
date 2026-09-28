-- ============================================================
-- DRIFT — signed legal agreements (clickwrap audit trail)
-- Run once in Supabase → SQL Editor. Safe to re-run.
--
-- Every time a customer agrees to the Terms + Release, or a driver agrees to the
-- Independent Contractor Agreement, the app inserts a row here. Rows are
-- append-only: users can insert their own and read their own, never edit or
-- delete. This is the record you'd show a court or an arbitrator.
-- ============================================================
create table if not exists public.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,  -- kept if the account is later deleted
  role         text not null check (role in ('customer','driver')),
  documents    text[] not null,          -- e.g. {customerTerms, customerRelease}
  version      text not null,            -- LEGAL_VERSION from src/legal.js
  accepted_at  timestamptz not null,     -- time on the device when they tapped Agree
  recorded_at  timestamptz not null default now(),  -- time the server received it
  user_agent   text
);
create index if not exists legal_acceptances_user_idx on public.legal_acceptances(user_id);

alter table public.legal_acceptances enable row level security;

drop policy if exists legal_insert_own on public.legal_acceptances;
create policy legal_insert_own on public.legal_acceptances for insert with check (auth.uid() = user_id);

drop policy if exists legal_read_own on public.legal_acceptances;
create policy legal_read_own on public.legal_acceptances for select using (auth.uid() = user_id);
-- (no update / delete policies on purpose — the record can't be altered from the app)
