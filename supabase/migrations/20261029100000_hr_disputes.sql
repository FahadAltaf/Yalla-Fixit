-- =====================================================================
-- Finance & Reports: compliance disputes (BRD 5.2 B4, §6.8, N12, TC14;
-- DEV-449). Schema `hr`, next to the waivers.
--
--   hr.disputes           a technician's dispute of one missed check-in,
--                         with their reason. Raised by the technician, or
--                         for them by a supervisor or coordinator (most
--                         technicians use the FSM app, not the portal).
--                         One per missed event.
--   hr.dispute_decisions  the reviewer's decision: accepted (the miss is
--                         waived, with a waiver reason) or rejected (with
--                         the reason recorded). One per dispute.
--   hr.waivers.dispute_id the waiver an accepted dispute made.
--
-- Rules the functions hold, whatever calls them:
--   - a dispute is raised only up to the cut-off day, that day included
--     (TC14: the 26th is refused), and never on a finalised month;
--   - an event already waived, or already disputed, cannot be disputed;
--   - a decision is made once; an accepted one waives the miss in the
--     same transaction;
--   - a month cannot be finalised while a dispute on it is undecided
--     (hr.finalize_month is replaced with that one check added).
--
-- Who may decide (the named reviewers in Settings -> Reporting) is checked
-- by the portal before it calls hr.decide_dispute.
--
-- Live-safe: new tables in `hr`, which nothing on main reads; one nullable
-- column on hr.waivers (its append-only trigger is for rows, not DDL); the
-- replaced finalize_month keeps its signature and grants. Idempotent.
-- Apply with the checks in docs/finance-reporting/migrations/20261029100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261029100000_rollback.sql.
-- =====================================================================

CREATE TABLE IF NOT EXISTS hr.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* technician|kind|date-or-appointment, as lib/reports/compliance.ts builds it. */
  event_key text NOT NULL UNIQUE CHECK (length(event_key) BETWEEN 5 AND 200),
  technician_fsm_id text NOT NULL,
  event_kind text NOT NULL
    CHECK (event_kind IN ('shift_check_in', 'shift_check_out', 'appointment_check_in', 'appointment_check_out')),
  month text NOT NULL CHECK (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  event_date date NOT NULL,
  due_at timestamptz,
  appointment_number text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
  /* Raised by someone else for the technician (told by phone or in person). */
  on_behalf boolean NOT NULL DEFAULT false,
  raised_by uuid,
  raised_by_label text,
  raised_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_disputes_month ON hr.disputes (month, technician_fsm_id);

CREATE TABLE IF NOT EXISTS hr.dispute_decisions (
  dispute_id uuid PRIMARY KEY REFERENCES hr.disputes(id),
  outcome text NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  /* Accepted: the reason the miss is waived for. */
  waiver_reason text CHECK (waiver_reason IS NULL OR hr.is_waiver_reason(waiver_reason)),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  decided_by uuid,
  decided_by_label text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dispute_decisions_accepted_reason CHECK (outcome <> 'accepted' OR waiver_reason IS NOT NULL),
  /* BRD §6.8: a rejection says why. */
  CONSTRAINT dispute_decisions_rejected_note CHECK (outcome <> 'rejected' OR length(btrim(coalesce(note, ''))) >= 3)
);

ALTER TABLE hr.waivers ADD COLUMN IF NOT EXISTS dispute_id uuid REFERENCES hr.disputes(id);

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['disputes', 'dispute_decisions'] LOOP
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
   Raise a dispute. p_event: { key, technician, kind, month, date, due_at,
   appointment_number }. p_cutoff: the month's last day for disputes
   (the portal works it out from the cut-off day setting).
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION hr.raise_dispute(
  p_event jsonb, p_reason text, p_cutoff date, p_on_behalf boolean, p_actor uuid, p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_month text := p_event->>'month';
BEGIN
  IF (now() AT TIME ZONE 'Asia/Dubai')::date > p_cutoff THEN
    RAISE EXCEPTION 'raise_dispute: disputes for % closed on %', v_month, p_cutoff USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.compliance_months WHERE month = v_month) THEN
    RAISE EXCEPTION 'raise_dispute: % is finalised; no change is possible', v_month USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.waivers WHERE event_key = p_event->>'key') THEN
    RAISE EXCEPTION 'raise_dispute: this check-in is already waived' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.disputes WHERE event_key = p_event->>'key') THEN
    RAISE EXCEPTION 'raise_dispute: this check-in is already disputed' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO hr.disputes (event_key, technician_fsm_id, event_kind, month, event_date, due_at, appointment_number,
                           reason, on_behalf, raised_by, raised_by_label)
  VALUES (p_event->>'key', p_event->>'technician', p_event->>'kind', v_month, (p_event->>'date')::date,
          nullif(p_event->>'due_at', '')::timestamptz, nullif(p_event->>'appointment_number', ''),
          btrim(p_reason), coalesce(p_on_behalf, false), p_actor, p_actor_label)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

/* ---------------------------------------------------------------------
   Decide a dispute, once. Accepted: the miss is waived with p_waiver_reason
   in the same transaction (an event someone waived meanwhile stays as it
   is). Allowed until the month is finalised, so a dispute raised on the
   cut-off day can still be decided after it.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION hr.decide_dispute(
  p_dispute uuid, p_outcome text, p_waiver_reason text, p_note text, p_actor uuid, p_actor_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = hr, pg_temp
AS $$
DECLARE
  d hr.disputes%ROWTYPE;
BEGIN
  SELECT * INTO d FROM hr.disputes WHERE id = p_dispute FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'decide_dispute: no such dispute' USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.compliance_months WHERE month = d.month) THEN
    RAISE EXCEPTION 'decide_dispute: % is finalised; no change is possible', d.month USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.dispute_decisions WHERE dispute_id = p_dispute) THEN
    RAISE EXCEPTION 'decide_dispute: this dispute is already decided' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO hr.dispute_decisions (dispute_id, outcome, waiver_reason, note, decided_by, decided_by_label)
  VALUES (p_dispute, p_outcome, CASE WHEN p_outcome = 'accepted' THEN p_waiver_reason END,
          nullif(btrim(coalesce(p_note, '')), ''), p_actor, p_actor_label);

  IF p_outcome = 'accepted' THEN
    INSERT INTO hr.waivers (event_key, technician_fsm_id, event_kind, month, due_at, reason, note, dispute_id, waived_by, waived_by_label)
    VALUES (d.event_key, d.technician_fsm_id, d.event_kind, d.month, d.due_at, p_waiver_reason,
            left('Dispute accepted: ' || d.reason, 2000), d.id, p_actor, p_actor_label)
    ON CONFLICT (event_key) DO NOTHING;
  END IF;
  RETURN p_outcome;
END;
$$;

/* ---------------------------------------------------------------------
   hr.finalize_month as in 20261023100000, refusing while a dispute on the
   month is undecided: "figures are final after disputes" (E3).
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
  v_open integer;
BEGIN
  IF (now() AT TIME ZONE 'Asia/Dubai')::date <= p_cutoff THEN
    RAISE EXCEPTION 'finalize_month: disputes for % are open until %', p_month, p_cutoff USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM hr.compliance_months WHERE month = p_month) THEN
    RAISE EXCEPTION 'finalize_month: % is already finalised', p_month USING ERRCODE = 'unique_violation';
  END IF;
  SELECT count(*) INTO v_open
  FROM hr.disputes d
  WHERE d.month = p_month AND NOT EXISTS (SELECT 1 FROM hr.dispute_decisions x WHERE x.dispute_id = d.id);
  IF v_open > 0 THEN
    RAISE EXCEPTION 'finalize_month: % dispute(s) on % are still to be decided', v_open, p_month USING ERRCODE = 'check_violation';
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
   Server-only, like the rest of `hr`
   --------------------------------------------------------------------- */
ALTER TABLE hr.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr.dispute_decisions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON hr.disputes, hr.dispute_decisions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hr.raise_dispute(jsonb, text, date, boolean, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION hr.decide_dispute(uuid, text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON hr.disputes, hr.dispute_decisions TO service_role;
GRANT EXECUTE ON FUNCTION hr.raise_dispute(jsonb, text, date, boolean, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION hr.decide_dispute(uuid, text, text, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
