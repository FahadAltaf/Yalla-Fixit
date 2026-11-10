-- =====================================================================
-- Finance & Reports P7: check-in compliance records (schema `hr`).
--
-- BRD 5.2 B4; DEV-447, 448, 450. What the portal must remember about
-- compliance, as opposed to what it works out each time:
--
--   hr.waiver_batches         one confirmed outage waived for everyone in
--                             one action (B4 "A confirmed outage can be
--                             waived for everyone in one action").
--   hr.waivers                one waived miss: who, when, why. Never
--                             deleted; a waived miss leaves both required
--                             and performed (TC13).
--   hr.compliance_months      a month once finalised after the dispute
--                             cut-off, with the settings it was worked out
--                             with.
--   hr.compliance_statements  the frozen figures per technician for that
--                             month: never recalculated (B4 "after that no
--                             change is possible").
--
-- Misses themselves are not stored: they are worked out from shifts,
-- appointments and check-ins, so a check-in that arrives late in FSM is
-- counted. Disputes (DEV-449) wait on D-10 and D-19 and are not here.
--
-- Writes go only through hr.record_waivers and hr.finalize_month (one
-- transaction each, SECURITY DEFINER). Everything is append-only.
--
-- Live-safe: a new schema nothing on main reads. Idempotent.
-- After applying, add `hr` to Exposed schemas (Project Settings -> API).
-- Post-check: expect `4 | 2 | f | f` from
--   select (select count(*) from information_schema.tables where table_schema = 'hr'),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'hr' and p.proname in ('record_waivers', 'finalize_month')),
--          has_schema_privilege('anon', 'hr', 'USAGE'),
--          has_schema_privilege('authenticated', 'hr', 'USAGE');
-- Rollback: docs/finance-reporting/migrations/20261023100000_rollback.sql
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS hr;
COMMENT ON SCHEMA hr IS
  'Finance & Reports: check-in compliance waivers and finalised monthly statements (BRD 5.2 B4).';

/* BRD B4's waiver reasons, and the four check-in events. */
CREATE OR REPLACE FUNCTION hr.is_waiver_reason(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT p IN ('App outage', 'No network', 'Device failure', 'Client not present',
               'Job cancelled on site', 'Emergency reassignment')
$$;

CREATE TABLE IF NOT EXISTS hr.waiver_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reason text NOT NULL CHECK (hr.is_waiver_reason(reason)),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  window_from timestamptz NOT NULL,
  window_to timestamptz NOT NULL,
  /* Empty = every kind of check-in. */
  kinds text[] NOT NULL DEFAULT '{}',
  event_count integer NOT NULL CHECK (event_count >= 0),
  created_by uuid,
  created_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waiver_batches_window CHECK (window_to >= window_from)
);

CREATE TABLE IF NOT EXISTS hr.waivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* technician|kind|date-or-appointment, as lib/reports/compliance.ts builds it. */
  event_key text NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 5 AND 200),
  technician_fsm_id text NOT NULL,
  event_kind text NOT NULL
    CHECK (event_kind IN ('shift_check_in', 'shift_check_out', 'appointment_check_in', 'appointment_check_out')),
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  due_at timestamptz,
  reason text NOT NULL CHECK (hr.is_waiver_reason(reason)),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  batch_id uuid REFERENCES hr.waiver_batches(id),
  waived_by uuid,
  waived_by_label text,
  waived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_waivers_month ON hr.waivers (month, technician_fsm_id);

CREATE TABLE IF NOT EXISTS hr.compliance_months (
  month text PRIMARY KEY CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  /* The settings in force when it was finalised (threshold, rate, cap). */
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  finalized_by uuid,
  finalized_by_label text,
  finalized_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hr.compliance_statements (
  month text NOT NULL REFERENCES hr.compliance_months(month),
  technician_fsm_id text NOT NULL,
  technician_name text,
  required integer NOT NULL CHECK (required >= 0),
  performed integer NOT NULL CHECK (performed >= 0),
  missed integer NOT NULL CHECK (missed >= 0),
  waived integer NOT NULL CHECK (waived >= 0),
  /* Unrounded; null when nothing was required. */
  compliance_percent numeric(9, 6),
  /* Null while no threshold is set (D-09). */
  below_threshold boolean,
  penalty_before_cap numeric(10, 2),
  penalty_payable numeric(10, 2),
  PRIMARY KEY (month, technician_fsm_id),
  CONSTRAINT statements_counts CHECK (required = performed + missed)
);

/* ---------------------------------------------------------------------
   Append-only
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION hr.append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = hr, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['waiver_batches', 'waivers', 'compliance_months', 'compliance_statements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON hr.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON hr.%I FOR EACH ROW EXECUTE FUNCTION hr.append_only()',
                   t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON hr.%I', t || '_append_only_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON hr.%I FOR EACH STATEMENT EXECUTE FUNCTION hr.append_only()',
                   t || '_append_only_truncate', t);
  END LOOP;
END;
$$;

/* ---------------------------------------------------------------------
   Waive misses: one, several, or a confirmed outage (p_batch set).
   p_events: [{ "key", "technician", "kind", "month", "due_at" }].
   An event already waived is skipped, so a retried click changes nothing.
   A finalised month cannot be touched. Returns how many were waived now.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION hr.record_waivers(
  p_events jsonb, p_reason text, p_note text, p_actor uuid, p_actor_label text, p_batch jsonb DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, pg_temp
AS $$
DECLARE
  v_batch uuid;
  v_count integer;
  v_closed text;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) = 0 THEN
    RAISE EXCEPTION 'record_waivers: no events' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT hr.is_waiver_reason(p_reason) THEN
    RAISE EXCEPTION 'record_waivers: % is not a waiver reason', p_reason USING ERRCODE = 'check_violation';
  END IF;

  SELECT m.month INTO v_closed
  FROM hr.compliance_months m
  WHERE m.month IN (SELECT e->>'month' FROM jsonb_array_elements(p_events) e)
  LIMIT 1;
  IF v_closed IS NOT NULL THEN
    RAISE EXCEPTION 'record_waivers: % is finalised; no change is possible', v_closed USING ERRCODE = 'check_violation';
  END IF;

  IF p_batch IS NOT NULL THEN
    INSERT INTO hr.waiver_batches (reason, note, window_from, window_to, kinds, event_count, created_by, created_by_label)
    VALUES (p_reason, nullif(trim(coalesce(p_note, '')), ''), (p_batch->>'from')::timestamptz, (p_batch->>'to')::timestamptz,
            coalesce(ARRAY(SELECT jsonb_array_elements_text(p_batch->'kinds')), '{}'), jsonb_array_length(p_events),
            p_actor, p_actor_label)
    RETURNING id INTO v_batch;
  END IF;

  INSERT INTO hr.waivers (event_key, technician_fsm_id, event_kind, month, due_at, reason, note, batch_id, waived_by, waived_by_label)
  SELECT e->>'key', e->>'technician', e->>'kind', e->>'month', nullif(e->>'due_at', '')::timestamptz,
         p_reason, nullif(trim(coalesce(p_note, '')), ''), v_batch, p_actor, p_actor_label
  FROM jsonb_array_elements(p_events) e
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

/* ---------------------------------------------------------------------
   Finalise a month after its dispute cut-off: the statements are frozen
   with the settings used. Once only. p_rows: [{ technician, name,
   required, performed, missed, waived, compliance_percent,
   below_threshold, penalty_before_cap, penalty_payable }].
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION hr.finalize_month(
  p_month text, p_cutoff date, p_rows jsonb, p_settings jsonb, p_actor uuid, p_actor_label text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF (now() AT TIME ZONE 'Asia/Dubai')::date <= p_cutoff THEN
    RAISE EXCEPTION 'finalize_month: disputes for % are open until %', p_month, p_cutoff USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.compliance_months WHERE month = p_month) THEN
    RAISE EXCEPTION 'finalize_month: % is already finalised', p_month USING ERRCODE = 'unique_violation';
  END IF;
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finalize_month: rows must be an array' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO hr.compliance_months (month, settings, finalized_by, finalized_by_label)
  VALUES (p_month, p_settings, p_actor, p_actor_label);

  INSERT INTO hr.compliance_statements (month, technician_fsm_id, technician_name, required, performed, missed, waived,
                                        compliance_percent, below_threshold, penalty_before_cap, penalty_payable)
  SELECT p_month, r->>'technician', r->>'name', (r->>'required')::int, (r->>'performed')::int, (r->>'missed')::int,
         (r->>'waived')::int, (r->>'compliance_percent')::numeric, (r->>'below_threshold')::boolean,
         (r->>'penalty_before_cap')::numeric, (r->>'penalty_payable')::numeric
  FROM jsonb_array_elements(p_rows) r;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

/* ---------------------------------------------------------------------
   Server-only
   --------------------------------------------------------------------- */
ALTER TABLE hr.waiver_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.compliance_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.compliance_statements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA hr FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hr TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA hr FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA hr FROM PUBLIC, anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA hr TO service_role;
GRANT EXECUTE ON FUNCTION hr.record_waivers(jsonb, text, text, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION hr.finalize_month(text, date, jsonb, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION hr.is_waiver_reason(text) TO service_role;

NOTIFY pgrst, 'reload schema';
