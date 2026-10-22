-- =====================================================================
-- Finance & Reports: invoicing by FSM work order and line item, with
-- partial amounts and the Ready-to-invoice workflow.
--
-- Decided with the user on 22 Oct: Ready to invoice works on FSM work
-- orders and their line items, read live from Zoho FSM by the server and
-- never copied into the portal. What the portal itself decides lives here:
-- Finance or a coordinator marks a whole work order, or single lines, Ready
-- to invoice (FSM is never written); an invoice from MAHER can cover a line
-- in full or in part (an amount of it), the rest staying to invoice; and
-- the queue's workflow (pick up, query, hold, not to be invoiced).
--
-- Nothing here reads schema fsm. Each line keeps the work order number,
-- name and amount FSM gave when it was last marked or invoiced; the server
-- sends them, having just read the work order from FSM.
--
--   finance.line_states               per line: ready or not, and how much
--                                     has been invoiced so far.
--   finance.line_invoices             each MAHER invoice recorded (number,
--                                     date, total, the uploaded file and
--                                     what the scan read, once scanned).
--   finance.line_invoice_allocations  how much of each line an invoice
--                                     covers.
--   finance.work_order_states         per work order: the Ready-to-invoice
--                                     workflow (picked up, query, hold,
--                                     excluded), as the queue had per item.
--   finance.wo_exclusions             "not to be invoiced" requests for a
--                                     work order and their verification.
--   finance.line_events               every change, for the history.
--
-- A line is Not ready, Ready, Partially invoiced or Invoiced (worked out
-- from ready and invoiced_amount against the line's amount before VAT).
-- No line can be invoiced beyond its amount; a MAHER number is recorded
-- once; a retried submission (same idempotency key) changes nothing.
--
-- Writes go only through finance.set_lines_ready, finance.record_line_invoice,
-- finance.wo_apply_action, finance.request_wo_exclusion and
-- finance.decide_wo_exclusion (row locks, one transaction each). Invoices,
-- allocations and events are append-only. An excluded work order, or one
-- with an exclusion waiting, cannot be invoiced.
--
-- Live-safe: new tables and functions in schema finance, which nothing on
-- main reads. The queue tables (20261021100000) are left as they are.
-- Post-check: expect `6 | 5` from
--   select (select count(*) from information_schema.tables where table_schema = 'finance'
--             and table_name in ('line_states', 'line_invoices', 'line_invoice_allocations', 'line_events',
--                                'work_order_states', 'wo_exclusions')),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname in ('set_lines_ready', 'record_line_invoice',
--               'wo_apply_action', 'request_wo_exclusion', 'decide_wo_exclusion'));
-- Rollback: docs/finance-reporting/migrations/20261024100000_rollback.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.line_states (
  fsm_line_id text PRIMARY KEY,
  fsm_work_order_id text NOT NULL,
  /* As FSM gave them when the line was last marked or invoiced. */
  work_order_number text,
  name text,
  /* Before VAT (D-05). */
  amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  ready boolean NOT NULL DEFAULT false,
  ready_at timestamptz,
  ready_by uuid,
  ready_by_label text,
  invoiced_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (invoiced_amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_states_work_order ON finance.line_states (fsm_work_order_id);

CREATE TABLE IF NOT EXISTS finance.line_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  maher_invoice_number text NOT NULL CHECK (length(trim(maher_invoice_number)) BETWEEN 1 AND 60),
  invoice_date date NOT NULL,
  /* As on the invoice (VAT included or not, as MAHER prints it). */
  total_amount numeric(14, 2) NOT NULL CHECK (total_amount > 0),
  /* The uploaded invoice in the private finance-evidence bucket, and what the scan read from it. */
  file_path text,
  scan jsonb,
  note text CHECK (note IS NULL OR length(note) <= 2000),
  recorded_by uuid,
  recorded_by_label text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_line_invoices_number ON finance.line_invoices (lower(trim(maher_invoice_number)));

CREATE TABLE IF NOT EXISTS finance.line_invoice_allocations (
  id bigserial PRIMARY KEY,
  invoice_id uuid NOT NULL REFERENCES finance.line_invoices(id),
  fsm_line_id text NOT NULL,
  fsm_work_order_id text NOT NULL,
  /* Before VAT, like the line's amount. */
  amount numeric(14, 2) NOT NULL CHECK (amount > 0),
  CONSTRAINT allocations_once_per_invoice UNIQUE (invoice_id, fsm_line_id)
);
CREATE INDEX IF NOT EXISTS idx_allocations_work_order ON finance.line_invoice_allocations (fsm_work_order_id);
CREATE INDEX IF NOT EXISTS idx_allocations_line ON finance.line_invoice_allocations (fsm_line_id);

/* The Ready-to-invoice workflow per work order. 'open' is any status the
   lines decide (not ready, pending, partially invoiced, invoiced). */
CREATE TABLE IF NOT EXISTS finance.work_order_states (
  fsm_work_order_id text PRIMARY KEY,
  work_order_number text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'query_raised', 'on_hold', 'excluded')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_before_query text CHECK (status_before_query IS NULL OR status_before_query IN ('open', 'in_progress', 'on_hold')),
  assignee_id uuid,
  assignee_label text,
  hold_reason text,
  query_text text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS finance.wo_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsm_work_order_id text NOT NULL,
  work_order_number text,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 200),
  notes text,
  /* Storage paths of the supporting evidence (BRD 5.1 Step 5). */
  evidence text[] NOT NULL DEFAULT '{}',
  requested_by uuid,
  requested_by_label text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK (decision IN ('verified', 'rejected')),
  decision_note text,
  decided_by uuid,
  decided_by_label text,
  decided_at timestamptz,
  CONSTRAINT wo_exclusions_decision_complete CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CONSTRAINT wo_exclusions_rejection_has_note CHECK (decision IS DISTINCT FROM 'rejected' OR decision_note IS NOT NULL)
);
/* At most one open request per work order. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_wo_exclusions_open ON finance.wo_exclusions (fsm_work_order_id) WHERE decision IS NULL;
CREATE INDEX IF NOT EXISTS idx_wo_exclusions_work_order ON finance.wo_exclusions (fsm_work_order_id);

CREATE TABLE IF NOT EXISTS finance.line_events (
  id bigserial PRIMARY KEY,
  fsm_work_order_id text NOT NULL,
  /* Null for a work-order event (picked up, query, hold, exclusion). */
  fsm_line_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'marked_ready', 'unmarked_ready', 'invoiced',
    'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
    'exclusion_requested', 'exclusion_verified', 'exclusion_rejected')),
  from_status text,
  to_status text,
  amount numeric(14, 2),
  invoice_id uuid REFERENCES finance.line_invoices(id),
  actor_id uuid,
  actor_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_line_events_work_order ON finance.line_events (fsm_work_order_id, created_at DESC);

/* Append-only, with the schema's existing trigger function (20261021100000). */
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['line_invoices', 'line_invoice_allocations', 'line_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finance.%I', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON finance.%I FOR EACH ROW EXECUTE FUNCTION finance.append_only()',
                   t || '_append_only', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON finance.%I', t || '_append_only_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON finance.%I FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only()',
                   t || '_append_only_truncate', t);
  END LOOP;
END;
$$;

/* ---------------------------------------------------------------------
   Mark lines Ready to invoice, or take the mark off.
   p_lines: [{ "id", "name", "amount" }] as the server has just read them
   from FSM for this work order. Returns how many lines changed; lines
   already in the state asked for are left alone (their name and amount
   are brought up to date either way).
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.set_lines_ready(
  p_work_order_id text, p_work_order_number text, p_lines jsonb, p_ready boolean, p_actor uuid, p_actor_label text,
  p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_changed integer;
BEGIN
  IF jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'set_lines_ready: no lines' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l
             WHERE coalesce(l->>'id', '') = '' OR (l->>'amount')::numeric < 0) THEN
    RAISE EXCEPTION 'set_lines_ready: every line needs its FSM id and an amount' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.line_states s JOIN jsonb_array_elements(p_lines) l ON s.fsm_line_id = l->>'id'
             WHERE s.fsm_work_order_id <> p_work_order_id) THEN
    RAISE EXCEPTION 'set_lines_ready: a line belongs to another work order' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id, work_order_number, name, amount)
  SELECT DISTINCT ON (l->>'id') l->>'id', p_work_order_id, p_work_order_number, l->>'name', coalesce((l->>'amount')::numeric(14, 2), 0)
  FROM jsonb_array_elements(p_lines) l
  ON CONFLICT (fsm_line_id) DO UPDATE
    SET work_order_number = excluded.work_order_number, name = excluded.name, amount = excluded.amount;

  WITH changed AS (
    UPDATE finance.line_states s
    SET ready = p_ready,
        ready_at = CASE WHEN p_ready THEN now() ELSE NULL END,
        ready_by = CASE WHEN p_ready THEN p_actor ELSE NULL END,
        ready_by_label = CASE WHEN p_ready THEN p_actor_label ELSE NULL END,
        updated_at = now()
    WHERE s.fsm_line_id IN (SELECT l->>'id' FROM jsonb_array_elements(p_lines) l) AND s.ready IS DISTINCT FROM p_ready
    RETURNING s.fsm_line_id
  )
  INSERT INTO finance.line_events (fsm_work_order_id, fsm_line_id, event_type, actor_id, actor_label, note)
  SELECT p_work_order_id, c.fsm_line_id, CASE WHEN p_ready THEN 'marked_ready' ELSE 'unmarked_ready' END,
         p_actor, p_actor_label, nullif(trim(coalesce(p_note, '')), '')
  FROM changed c;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed;
END;
$$;

/* ---------------------------------------------------------------------
   Record a MAHER invoice against lines, in full or in part.
   p_allocations: [{ "line", "amount", "work_order", "work_order_number",
   "name", "line_amount" }]: what this invoice covers, and each line as the
   server has just read it from FSM (line_amount before VAT). Each line is
   locked and may not be invoiced beyond its amount. Invoicing a line also
   marks it Ready. Same idempotency key again: the first invoice's id.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.record_line_invoice(
  p_key text, p_number text, p_date date, p_total numeric, p_allocations jsonb,
  p_actor uuid, p_actor_label text, p_note text DEFAULT NULL, p_file_path text DEFAULT NULL, p_scan jsonb DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_invoice uuid;
  v_alloc record;
  v_line record;
  v_state record;
BEGIN
  SELECT id INTO v_existing FROM finance.line_invoices WHERE idempotency_key = p_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'record_line_invoice: no lines' USING ERRCODE = 'check_violation';
  END IF;
  /* Work marked not to be invoiced, or waiting for that to be decided, is not invoiced. */
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a
             WHERE coalesce(a->>'line', '') = '' OR coalesce(a->>'work_order', '') = '' OR (a->>'line_amount') IS NULL) THEN
    RAISE EXCEPTION 'record_line_invoice: every line needs its FSM id, work order and amount' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_allocations) a
    WHERE EXISTS (SELECT 1 FROM finance.work_order_states w WHERE w.fsm_work_order_id = a->>'work_order' AND w.status = 'excluded')
       OR EXISTS (SELECT 1 FROM finance.wo_exclusions x WHERE x.fsm_work_order_id = a->>'work_order' AND x.decision IS NULL)
  ) THEN
    RAISE EXCEPTION 'record_line_invoice: a work order on this invoice is marked not to be invoiced, or waiting for that to be decided'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.line_invoices WHERE lower(trim(maher_invoice_number)) = lower(trim(p_number))) THEN
    RAISE EXCEPTION 'record_line_invoice: MAHER invoice % is already recorded', trim(p_number) USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO finance.line_invoices (idempotency_key, maher_invoice_number, invoice_date, total_amount, file_path, scan, note,
                                     recorded_by, recorded_by_label)
  VALUES (p_key, trim(p_number), p_date, p_total, p_file_path, p_scan, nullif(trim(coalesce(p_note, '')), ''), p_actor, p_actor_label)
  RETURNING id INTO v_invoice;

  FOR v_alloc IN
    SELECT a->>'line' AS line, (a->>'amount')::numeric(14, 2) AS amount, a->>'work_order' AS work_order,
           a->>'work_order_number' AS work_order_number, a->>'name' AS name, (a->>'line_amount')::numeric(14, 2) AS line_amount
    FROM jsonb_array_elements(p_allocations) a
  LOOP
    IF v_alloc.amount IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION 'record_line_invoice: an amount must be above zero' USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id, work_order_number, name, amount)
    VALUES (v_alloc.line, v_alloc.work_order, v_alloc.work_order_number, v_alloc.name, greatest(v_alloc.line_amount, 0))
    ON CONFLICT (fsm_line_id) DO NOTHING;
    SELECT * INTO v_state FROM finance.line_states WHERE fsm_line_id = v_alloc.line FOR UPDATE;
    IF v_state.fsm_work_order_id <> v_alloc.work_order THEN
      RAISE EXCEPTION 'record_line_invoice: line % belongs to another work order', v_alloc.line USING ERRCODE = 'check_violation';
    END IF;
    /* FSM's amount now, which can have changed since the line was marked. */
    UPDATE finance.line_states SET amount = greatest(v_alloc.line_amount, 0), name = coalesce(v_alloc.name, name),
           work_order_number = coalesce(v_alloc.work_order_number, work_order_number)
    WHERE fsm_line_id = v_alloc.line;
    SELECT fsm_line_id, fsm_work_order_id, amount INTO v_line FROM finance.line_states WHERE fsm_line_id = v_alloc.line;

    IF v_state.invoiced_amount + v_alloc.amount > coalesce(v_line.amount, 0) + 0.01 THEN
      RAISE EXCEPTION 'record_line_invoice: line % has % left to invoice, not %',
        v_line.fsm_line_id, greatest(coalesce(v_line.amount, 0) - v_state.invoiced_amount, 0), v_alloc.amount
        USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO finance.line_invoice_allocations (invoice_id, fsm_line_id, fsm_work_order_id, amount)
    VALUES (v_invoice, v_line.fsm_line_id, v_line.fsm_work_order_id, v_alloc.amount);

    UPDATE finance.line_states
    SET invoiced_amount = invoiced_amount + v_alloc.amount,
        ready = true,
        ready_at = coalesce(ready_at, now()),
        ready_by = coalesce(ready_by, p_actor),
        ready_by_label = coalesce(ready_by_label, p_actor_label),
        updated_at = now()
    WHERE fsm_line_id = v_line.fsm_line_id;

    INSERT INTO finance.line_events (fsm_work_order_id, fsm_line_id, event_type, amount, invoice_id, actor_id, actor_label, note)
    VALUES (v_line.fsm_work_order_id, v_line.fsm_line_id, 'invoiced', v_alloc.amount, v_invoice, p_actor, p_actor_label, trim(p_number));
  END LOOP;

  RETURN v_invoice;
END;
$$;

/* ---------------------------------------------------------------------
   The Ready-to-invoice workflow on a work order (BRD 5.1 Step 4, as the
   queue had it per item). p_expected is the status the person saw; if it
   has moved on, nothing changes and they are told.

     pick_up       open -> in_progress (the person becomes the assignee)
     release       in_progress -> open
     raise_query   open | in_progress | on_hold -> query_raised (question required)
     answer_query  query_raised -> where it was (answer required)
     put_on_hold   open | in_progress -> on_hold (reason required)
     resume        on_hold -> in_progress
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.wo_apply_action(
  p_work_order_id text, p_action text, p_expected text, p_actor uuid, p_actor_label text, p_note text DEFAULT NULL,
  p_work_order_number text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_state finance.work_order_states%ROWTYPE;
  v_to text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  INSERT INTO finance.work_order_states (fsm_work_order_id, work_order_number) VALUES (p_work_order_id, p_work_order_number)
  ON CONFLICT (fsm_work_order_id) DO UPDATE SET work_order_number = coalesce(excluded.work_order_number, work_order_states.work_order_number);
  SELECT * INTO v_state FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF v_state.status <> p_expected THEN
    RAISE EXCEPTION 'wo_apply_action: the work order is % now, not %', v_state.status, p_expected USING ERRCODE = 'serialization_failure';
  END IF;

  CASE p_action
    WHEN 'pick_up' THEN
      IF v_state.status <> 'open' THEN RAISE EXCEPTION 'wo_apply_action: only an open work order can be picked up' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'in_progress';
      UPDATE finance.work_order_states SET assignee_id = p_actor, assignee_label = p_actor_label WHERE fsm_work_order_id = p_work_order_id;
    WHEN 'release' THEN
      IF v_state.status <> 'in_progress' THEN RAISE EXCEPTION 'wo_apply_action: only a work order in progress can be released' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'open';
      UPDATE finance.work_order_states SET assignee_id = NULL, assignee_label = NULL WHERE fsm_work_order_id = p_work_order_id;
    WHEN 'raise_query' THEN
      IF v_state.status NOT IN ('open', 'in_progress', 'on_hold') THEN
        RAISE EXCEPTION 'wo_apply_action: a query cannot be raised now' USING ERRCODE = 'check_violation';
      END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'wo_apply_action: a query needs the question' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'query_raised';
      UPDATE finance.work_order_states SET status_before_query = v_state.status, query_text = v_note WHERE fsm_work_order_id = p_work_order_id;
    WHEN 'answer_query' THEN
      IF v_state.status <> 'query_raised' THEN RAISE EXCEPTION 'wo_apply_action: there is no query to answer' USING ERRCODE = 'check_violation'; END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'wo_apply_action: an answer is required' USING ERRCODE = 'check_violation'; END IF;
      /* Back where it was; a hold with no reason left goes back to in progress. */
      v_to := CASE
        WHEN v_state.status_before_query = 'on_hold' AND v_state.hold_reason IS NULL THEN 'in_progress'
        ELSE coalesce(v_state.status_before_query, 'open')
      END;
      UPDATE finance.work_order_states SET status_before_query = NULL, query_text = NULL WHERE fsm_work_order_id = p_work_order_id;
    WHEN 'put_on_hold' THEN
      IF v_state.status NOT IN ('open', 'in_progress') THEN
        RAISE EXCEPTION 'wo_apply_action: only an open or in-progress work order can be put on hold' USING ERRCODE = 'check_violation';
      END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'wo_apply_action: a hold needs a reason' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'on_hold';
      UPDATE finance.work_order_states SET hold_reason = v_note WHERE fsm_work_order_id = p_work_order_id;
    WHEN 'resume' THEN
      IF v_state.status <> 'on_hold' THEN RAISE EXCEPTION 'wo_apply_action: only a work order on hold can be resumed' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'in_progress';
      UPDATE finance.work_order_states SET hold_reason = NULL WHERE fsm_work_order_id = p_work_order_id;
    ELSE
      RAISE EXCEPTION 'wo_apply_action: unknown action %', p_action USING ERRCODE = 'check_violation';
  END CASE;

  UPDATE finance.work_order_states SET status = v_to, status_changed_at = now(), updated_at = now() WHERE fsm_work_order_id = p_work_order_id;
  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_work_order_id,
          CASE p_action WHEN 'pick_up' THEN 'picked_up' WHEN 'release' THEN 'released' WHEN 'raise_query' THEN 'query_raised'
                        WHEN 'answer_query' THEN 'query_answered' WHEN 'put_on_hold' THEN 'put_on_hold' ELSE 'resumed' END,
          v_state.status, v_to, p_actor, p_actor_label, v_note);
  RETURN v_to;
END;
$$;

/* A coordinator marks a work order not to be invoiced (BRD 5.1 Step 5, TC05). */
CREATE OR REPLACE FUNCTION finance.request_wo_exclusion(
  p_work_order_id text, p_reason text, p_notes text, p_evidence text[], p_actor uuid, p_actor_label text,
  p_work_order_number text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_status text;
BEGIN
  INSERT INTO finance.work_order_states (fsm_work_order_id, work_order_number) VALUES (p_work_order_id, p_work_order_number)
  ON CONFLICT (fsm_work_order_id) DO UPDATE SET work_order_number = coalesce(excluded.work_order_number, work_order_states.work_order_number);
  SELECT status INTO v_status FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF v_status = 'excluded' THEN
    RAISE EXCEPTION 'request_wo_exclusion: the work order is already excluded' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.wo_exclusions WHERE fsm_work_order_id = p_work_order_id AND decision IS NULL) THEN
    RAISE EXCEPTION 'request_wo_exclusion: a request is already waiting for verification' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.line_states s WHERE s.fsm_work_order_id = p_work_order_id AND s.invoiced_amount > 0) THEN
    RAISE EXCEPTION 'request_wo_exclusion: part of this work order is already invoiced' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO finance.wo_exclusions (fsm_work_order_id, work_order_number, reason, notes, evidence, requested_by, requested_by_label)
  VALUES (p_work_order_id, p_work_order_number, trim(p_reason), nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_evidence, '{}'), p_actor, p_actor_label)
  RETURNING id INTO v_id;
  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_work_order_id, 'exclusion_requested', v_status, v_status, p_actor, p_actor_label, trim(p_reason));
  RETURN v_id;
END;
$$;

/* Behrouz verifies (the work order becomes Excluded) or rejects with a note. */
CREATE OR REPLACE FUNCTION finance.decide_wo_exclusion(
  p_exclusion_id uuid, p_decision text, p_note text, p_actor uuid, p_actor_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_ex finance.wo_exclusions%ROWTYPE;
  v_from text;
  v_to text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF p_decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'decide_wo_exclusion: decide verified or rejected' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_ex FROM finance.wo_exclusions WHERE id = p_exclusion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decide_wo_exclusion: no request %', p_exclusion_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_ex.decision IS NOT NULL THEN
    RAISE EXCEPTION 'decide_wo_exclusion: already %', v_ex.decision USING ERRCODE = 'serialization_failure';
  END IF;
  IF p_decision = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'decide_wo_exclusion: a rejection needs a note' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE finance.wo_exclusions SET decision = p_decision, decision_note = v_note, decided_by = p_actor,
         decided_by_label = p_actor_label, decided_at = now()
  WHERE id = p_exclusion_id;

  SELECT status INTO v_from FROM finance.work_order_states WHERE fsm_work_order_id = v_ex.fsm_work_order_id FOR UPDATE;
  v_to := CASE WHEN p_decision = 'verified' THEN 'excluded' ELSE v_from END;
  UPDATE finance.work_order_states
  SET status = v_to,
      status_changed_at = CASE WHEN v_to IS DISTINCT FROM v_from THEN now() ELSE status_changed_at END,
      assignee_id = CASE WHEN p_decision = 'verified' THEN NULL ELSE assignee_id END,
      assignee_label = CASE WHEN p_decision = 'verified' THEN NULL ELSE assignee_label END,
      updated_at = now()
  WHERE fsm_work_order_id = v_ex.fsm_work_order_id;

  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (v_ex.fsm_work_order_id, CASE WHEN p_decision = 'verified' THEN 'exclusion_verified' ELSE 'exclusion_rejected' END,
          v_from, v_to, p_actor, p_actor_label, coalesce(v_note, v_ex.reason));
  RETURN v_to;
END;
$$;

/* ---------------------------------------------------------------------
   Server-only
   --------------------------------------------------------------------- */
ALTER TABLE finance.line_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_invoice_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.work_order_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.wo_exclusions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON finance.line_states, finance.line_invoices, finance.line_invoice_allocations, finance.line_events,
  finance.work_order_states, finance.wo_exclusions
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.wo_apply_action(text, text, text, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.request_wo_exclusion(text, text, text, text[], uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.decide_wo_exclusion(uuid, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.set_lines_ready(text, text, jsonb, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.line_states, finance.line_invoices, finance.line_invoice_allocations, finance.line_events,
  finance.work_order_states, finance.wo_exclusions TO service_role;
GRANT EXECUTE ON FUNCTION finance.wo_apply_action(text, text, text, uuid, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.request_wo_exclusion(text, text, text, text[], uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.decide_wo_exclusion(uuid, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.set_lines_ready(text, text, jsonb, boolean, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
