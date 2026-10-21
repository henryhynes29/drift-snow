-- ============================================================
-- DRIFT — scheduler heartbeat (run ONCE, after routes.sql)
--
-- Scheduled plows need a check every 5 minutes: check-in reminders for
-- drivers, handing a job to other drivers when someone misses check-in,
-- and alerting everyone 30 minutes before a window nobody claimed.
-- Supabase's free built-in scheduler (pg_cron + pg_net) calls DRIFT's
-- server every 5 minutes to do that.
--
-- BEFORE RUNNING: replace PASTE_YOUR_CRON_SECRET_HERE below with the value of
-- CRON_SECRET from Vercel -> Settings -> Environment Variables (click the eye icon).
-- ============================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'drift-tick';
select cron.schedule('drift-tick', '*/5 * * * *', $$
  select net.http_get(
    url := 'https://driftplowing.com/api/pay?action=tick',
    headers := jsonb_build_object('Authorization', 'Bearer PASTE_YOUR_CRON_SECRET_HERE')
  );
$$);

-- Done. To check it's running later:  select * from cron.job_run_details order by start_time desc limit 5;
