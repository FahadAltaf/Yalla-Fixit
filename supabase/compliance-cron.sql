-- Manpower Compliance scheduled jobs (Sharon's action point C4; Sami's
-- decision of 29 Oct 2026 to use scheduled jobs). NOT a migration: run it by
-- hand in the Supabase SQL Editor, once, after the code is deployed and the
-- migration 20261029130000_compliance_site_sync_and_jobs.sql is applied.
--
-- What it does: every 6 hours (00:00, 06:00, 12:00, 18:00 UTC = 04:00, 10:00,
-- 16:00, 22:00 Dubai), pg_cron asks pg_net to POST to the
-- portal's site-sync route. The route asks Zoho FSM which appointments are on
-- now and recomputes each linked employee's
-- current site, then writes one row to
-- compliance_job_runs. The cron secret is read from Supabase Vault, never
-- written into the job's command.
--
-- Before running: replace PASTE_THE_CRON_SECRET with the value of the
-- portal's CRON_SECRET environment variable (the same secret the task
-- reminder route uses), and check the portal URL.

-- 1. Extensions (already installed on this project; harmless if so).
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. The secret, stored once in Vault.
SELECT vault.create_secret('PASTE_THE_CRON_SECRET', 'compliance_cron_secret', 'CRON_SECRET for the compliance job routes');

-- 3. The job: every 6 hours (Sami, 30 Oct 2026).
SELECT cron.schedule(
  'compliance-site-sync',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://portal.yallafixit.ae/api/compliance/jobs/site-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'compliance_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Check: the job is listed, and after 15 minutes a run row appears.
-- SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'compliance-site-sync';
-- SELECT job, trigger, started_at, finished_at, ok, summary, error FROM public.compliance_job_runs ORDER BY started_at DESC LIMIT 5;

-- Rollback:
-- SELECT cron.unschedule('compliance-site-sync');
-- SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'compliance_cron_secret'), 'retired');
