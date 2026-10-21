-- Rollback for 20261022100000_reports_foundation. Drops saved report
-- filters and the report access log; no report figure is stored here.
-- Never run automatically. Remove `reports` from Exposed schemas first.
DROP SCHEMA IF EXISTS reports CASCADE;
NOTIFY pgrst, 'reload schema';
