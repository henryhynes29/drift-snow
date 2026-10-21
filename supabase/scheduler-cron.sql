-- ============================================================
-- DRIFT — scheduler heartbeat (run ONCE, after routes.sql). Nothing to edit.
--
-- Every 5 minutes Supabase pings DRIFT so scheduled plows get their
-- check-in reminders and hand-offs even when nobody has the app open.
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'drift-tick';
select cron.schedule('drift-tick', '*/5 * * * *', $$
  select net.http_get(url := 'https://driftplowing.com/api/pay?action=tick');
$$);

-- Done. You should see a number (the timer's id).
