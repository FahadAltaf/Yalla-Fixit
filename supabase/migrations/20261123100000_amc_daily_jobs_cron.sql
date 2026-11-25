-- =====================================================================
-- The AMC daily job, every morning at 06:00 Dubai (DEV-485, 23 Nov 2026)
--
-- !! Apply ONLY after the live portal runs the amc-hardening code with
-- !! DEV-485 (lib/amc/daily-jobs.ts). Older code runs EVERY AMC job when
-- !! called, client reminder emails included. With DEV-485 the morning run
-- !! does only what AMC configuration -> Daily jobs switches on (first
-- !! release: expiry notices and PPM confirmation reminders), and client
-- !! emails stay held while "Client emails" is off.
--
-- How it works: pg_cron (already used here for the Zoho token refresh)
-- calls the portal's /api/amc-jobs/run through pg_net, with the portal's
-- CRON_SECRET in the x-cron-secret header. The secret and the portal
-- address live in Supabase Vault, never in this file.
--
-- BEFORE running this file:
--   1. The live portal has CRON_SECRET set (the same one the Snagging
--      escalations and Todos reminders use). Check with the host.
--   2. In the SQL editor, store the two values in Vault (once):
--        select vault.create_secret('<the CRON_SECRET value>', 'amc_cron_secret');
--        select vault.create_secret('https://<the live portal address>', 'amc_portal_url');
--      (no slash at the end of the address)
--
-- AFTER: Settings -> AMC configuration -> Daily jobs -> Last runs shows a
-- "Scheduled" run after 06:00 Dubai. pg_cron's own log:
--   select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'amc-daily-jobs') order by start_time desc limit 5;
--
-- Rollback at the end.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'amc_cron_secret') THEN
    RAISE EXCEPTION 'Store the CRON_SECRET in Vault first: select vault.create_secret(''<value>'', ''amc_cron_secret'');';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'amc_portal_url') THEN
    RAISE EXCEPTION 'Store the live portal address in Vault first: select vault.create_secret(''https://...'', ''amc_portal_url'');';
  END IF;
  /* Run again safely: the old schedule is replaced. */
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'amc-daily-jobs') THEN
    PERFORM cron.unschedule('amc-daily-jobs');
  END IF;
END $$;

-- 02:00 UTC = 06:00 Dubai (no daylight saving there).
SELECT cron.schedule(
  'amc-daily-jobs',
  '0 2 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'amc_portal_url') || '/api/amc-jobs/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'amc_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

-- Check (read-only):
--   select jobname, schedule, active from cron.job where jobname = 'amc-daily-jobs';   -- expect 0 2 * * *, true

-- Rollback:
--   select cron.unschedule('amc-daily-jobs');
