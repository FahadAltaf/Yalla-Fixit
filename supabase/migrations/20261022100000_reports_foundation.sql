-- =====================================================================
-- Finance & Reports P5: the reports foundation (BRD 5.2 B5, 6.9; DEV-455).
--
-- Schema `reports`, apart from the portal's tables in `public`, granted to
-- the server role only, like `fsm` and `finance`:
--
--   reports.saved_filters  each user's filters per report: the selection
--                          they last used (one row, kind 'last_used'; BRD
--                          B1 "selections persist per user") and any they
--                          saved under a name (kind 'saved')
--   reports.access_log     who opened or exported which report, when, with
--                          which filters and how many rows (BRD 6.9 note).
--                          Append-only: a trigger refuses UPDATE, DELETE and
--                          TRUNCATE. The user is not a foreign key, so
--                          deleting a user is never blocked by history
--                          (the reporting_audit_events lesson)
--
-- No report data is stored here: every figure is computed from the FSM
-- copy (`fsm`), the queue (`finance`) and the portal's own tables.
--
-- Live-safe: a new schema; live main reads nothing in it. Idempotent.
-- After applying: add `reports` to Exposed schemas (Project Settings > API).
--
-- Checks: docs/finance-reporting/migrations/20261022100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261022100000_rollback.sql.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS reports;
COMMENT ON SCHEMA reports IS
  'Finance & Reports: saved report filters and the report access log (BRD 5.2 B5, 6.9).';

-- ---------------------------------------------------------------------
-- 1. Saved filters
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports.saved_filters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* A person's own filters go with them. */
  user_id uuid NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  report_key text NOT NULL CHECK (report_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  kind text NOT NULL CHECK (kind IN ('last_used', 'saved')),
  name text CHECK (name IS NULL OR length(trim(name)) BETWEEN 1 AND 60),
  /* What the report's filter bar holds; the report validates it on read. */
  filters jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(filters) = 'object' AND pg_column_size(filters) <= 8192),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT saved_filters_named_when_saved CHECK ((kind = 'saved') = (name IS NOT NULL))
);

/* One "last used" per person and report; saved names unique per report. */
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_filters_last_used
  ON reports.saved_filters (user_id, report_key) WHERE kind = 'last_used';
CREATE UNIQUE INDEX IF NOT EXISTS uq_saved_filters_name
  ON reports.saved_filters (user_id, report_key, lower(name)) WHERE kind = 'saved';

-- ---------------------------------------------------------------------
-- 2. Access log (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reports.access_log (
  id bigserial PRIMARY KEY,
  report_key text NOT NULL CHECK (report_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  action text NOT NULL CHECK (action IN ('view', 'export')),
  /* Not a foreign key: see the header. user_label keeps who it was. */
  user_id uuid,
  user_label text,
  filters jsonb,
  row_count integer CHECK (row_count IS NULL OR row_count >= 0),
  /* 'csv' or 'xlsx' for an export. */
  format text CHECK (format IS NULL OR format IN ('csv', 'xlsx')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_log_report
  ON reports.access_log (report_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_user
  ON reports.access_log (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION reports.access_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = reports, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'reports.access_log is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS access_log_append_only_rows ON reports.access_log;
CREATE TRIGGER access_log_append_only_rows
  BEFORE UPDATE OR DELETE ON reports.access_log
  FOR EACH ROW EXECUTE FUNCTION reports.access_log_append_only();
DROP TRIGGER IF EXISTS access_log_append_only_truncate ON reports.access_log;
CREATE TRIGGER access_log_append_only_truncate
  BEFORE TRUNCATE ON reports.access_log
  FOR EACH STATEMENT EXECUTE FUNCTION reports.access_log_append_only();

-- ---------------------------------------------------------------------
-- 3. Access: the server role only
-- ---------------------------------------------------------------------
ALTER TABLE reports.saved_filters ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports.access_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA reports FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA reports TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA reports FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA reports FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON reports.saved_filters TO service_role;
GRANT SELECT, INSERT ON reports.access_log TO service_role;
GRANT USAGE ON SEQUENCE reports.access_log_id_seq TO service_role;

NOTIFY pgrst, 'reload schema';
