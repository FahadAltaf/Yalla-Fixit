-- =====================================================================
-- Finance & Reports: invoicing by line item, with partial amounts.
--
-- Decided with the user on 22 Oct: invoicing works on FSM work orders and
-- their line items, read from the copy in schema fsm. Finance or a
-- coordinator marks a whole work order, or single lines, Ready to invoice
-- in the portal (FSM is never written). An invoice from MAHER can cover a
-- line in full or in part (an amount of it); the rest stays to invoice.
--
--   finance.line_states               per line: ready or not, and how much
--                                     has been invoiced so far.
--   finance.line_invoices             each MAHER invoice recorded (number,
--                                     date, total, the uploaded file and
--                                     what the scan read, once scanned).
--   finance.line_invoice_allocations  how much of each line an invoice
--                                     covers.
--   finance.line_events               every change, for the history.
--
-- A line is Not ready, Ready, Partially invoiced or Invoiced (worked out
-- from ready and invoiced_amount against the line's amount before VAT).
-- No line can be invoiced beyond its amount; a MAHER number is recorded
-- once; a retried submission (same idempotency key) changes nothing.
--
-- Writes go only through finance.set_lines_ready and
-- finance.record_line_invoice (row locks, one transaction each). Invoices,
-- allocations and events are append-only.
--
-- Live-safe: new tables and functions in schema finance, which nothing on
-- main reads. The queue tables (20261021100000) are left as they are.
-- Post-check: expect `4 | 2` from
--   select (select count(*) from information_schema.tables where table_schema = 'finance'
--             and table_name in ('line_states', 'line_invoices', 'line_invoice_allocations', 'line_events')),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname in ('set_lines_ready', 'record_line_invoice'));
-- Rollback: docs/finance-reporting/migrations/20261024100000_rollback.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.line_states (
  fsm_line_id text PRIMARY KEY,
  fsm_work_order_id text NOT NULL,
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

CREATE TABLE IF NOT EXISTS finance.line_events (
  id bigserial PRIMARY KEY,
  fsm_work_order_id text NOT NULL,
  fsm_line_id text,
  event_type text NOT NULL CHECK (event_type IN ('marked_ready', 'unmarked_ready', 'invoiced')),
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
   Mark lines Ready to invoice, or take the mark off. Every line must be a
   current line of one work order in the FSM copy. Returns how many lines
   changed; lines already in the state asked for are left alone.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.set_lines_ready(
  p_work_order_id text, p_lines text[], p_ready boolean, p_actor uuid, p_actor_label text, p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_wanted integer := coalesce(array_length(p_lines, 1), 0);
  v_found integer;
  v_changed integer;
BEGIN
  IF v_wanted = 0 THEN
    RAISE EXCEPTION 'set_lines_ready: no lines' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO v_found
  FROM fsm.line_items l
  WHERE l.fsm_line_id = ANY (p_lines) AND l.fsm_work_order_id = p_work_order_id AND l.removed_at IS NULL;
  IF v_found <> (SELECT count(DISTINCT x) FROM unnest(p_lines) x) THEN
    RAISE EXCEPTION 'set_lines_ready: % line(s) are not current lines of work order %',
      (SELECT count(DISTINCT x) FROM unnest(p_lines) x) - v_found, p_work_order_id USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id)
  SELECT DISTINCT x, p_work_order_id FROM unnest(p_lines) x
  ON CONFLICT (fsm_line_id) DO NOTHING;

  WITH changed AS (
    UPDATE finance.line_states s
    SET ready = p_ready,
        ready_at = CASE WHEN p_ready THEN now() ELSE NULL END,
        ready_by = CASE WHEN p_ready THEN p_actor ELSE NULL END,
        ready_by_label = CASE WHEN p_ready THEN p_actor_label ELSE NULL END,
        updated_at = now()
    WHERE s.fsm_line_id = ANY (p_lines) AND s.ready IS DISTINCT FROM p_ready
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
   p_allocations: [{ "line": "<fsm_line_id>", "amount": 1234.50 }]
   Each line is locked, must be a current line in the FSM copy, and may
   not be invoiced beyond its amount (before VAT). Invoicing a line also
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
  IF EXISTS (SELECT 1 FROM finance.line_invoices WHERE lower(trim(maher_invoice_number)) = lower(trim(p_number))) THEN
    RAISE EXCEPTION 'record_line_invoice: MAHER invoice % is already recorded', trim(p_number) USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO finance.line_invoices (idempotency_key, maher_invoice_number, invoice_date, total_amount, file_path, scan, note,
                                     recorded_by, recorded_by_label)
  VALUES (p_key, trim(p_number), p_date, p_total, p_file_path, p_scan, nullif(trim(coalesce(p_note, '')), ''), p_actor, p_actor_label)
  RETURNING id INTO v_invoice;

  FOR v_alloc IN
    SELECT a->>'line' AS line, (a->>'amount')::numeric(14, 2) AS amount FROM jsonb_array_elements(p_allocations) a
  LOOP
    IF v_alloc.amount IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION 'record_line_invoice: an amount must be above zero' USING ERRCODE = 'check_violation';
    END IF;
    SELECT fsm_line_id, fsm_work_order_id, amount INTO v_line
    FROM fsm.line_items WHERE fsm_line_id = v_alloc.line AND removed_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'record_line_invoice: line % is not a current FSM line', v_alloc.line USING ERRCODE = 'check_violation';
    END IF;

    INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id) VALUES (v_line.fsm_line_id, v_line.fsm_work_order_id)
    ON CONFLICT (fsm_line_id) DO NOTHING;
    SELECT * INTO v_state FROM finance.line_states WHERE fsm_line_id = v_line.fsm_line_id FOR UPDATE;

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
   Server-only
   --------------------------------------------------------------------- */
ALTER TABLE finance.line_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_invoice_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.line_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON finance.line_states, finance.line_invoices, finance.line_invoice_allocations, finance.line_events
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.set_lines_ready(text, text[], boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.line_states, finance.line_invoices, finance.line_invoice_allocations, finance.line_events TO service_role;
GRANT EXECUTE ON FUNCTION finance.set_lines_ready(text, text[], boolean, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
