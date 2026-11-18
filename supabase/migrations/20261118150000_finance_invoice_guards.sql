-- 20261118150000_finance_invoice_guards
--
-- Two fixes from Sami's review of invoicing (9 and 13 Nov 2026).
--
-- 1. The invoice limit is checked inside the database, under the line's lock.
--    Before: the server worked out how much of a line may be invoiced now (all of what is left once the work order
--    is Completed and flagged, else Operations' "invoice" percentage) and checked it in code; the database checked
--    only that a line is never invoiced beyond its whole amount. Two people recording invoices on the same
--    partly-done line at the same moment both passed the code's check, so together they could invoice more than
--    Operations allowed. Now each line sent carries "max_invoiced": the most that may have been invoiced on the line
--    in total once this invoice is in (what was invoiced when the server read it, plus what may be invoiced now).
--    finance.record_line_invoice refuses, with the line locked, when the invoiced amount would pass it. A second
--    invoice at the same moment waits for the first and is then refused.
--
-- 2. The MAHER total and the reason for a difference.
--    Before: the invoice total was always the portal's figure (the lines plus VAT), so no difference could be seen
--    and no reason was ever asked for. Now Finance enters the total printed on the MAHER invoice (the scan fills it
--    in). It is kept as maher_total. When it differs from the portal's total by more than AED 1.00 (VAT rounding),
--    a reason is required (variance_reason). The database refuses an invoice without one.
--
-- Live-safe:
--   * two nullable columns on finance.line_invoices and a CHECK that existing rows pass (maher_total is null);
--   * finance.record_line_invoice is replaced with two more parameters, both with defaults. The code now live calls
--     it with the ten parameters it always sent and keeps working: no max_invoiced means the old check only, no
--     MAHER total means no difference to explain.
-- One transaction. Idempotent.
--
-- Post-check: expect `2 | 1 | 12` from
--   select (select count(*) from information_schema.columns where table_schema = 'finance'
--             and table_name = 'line_invoices' and column_name in ('maher_total', 'variance_reason')),
--          (select count(*) from pg_constraint where conname = 'line_invoices_variance_has_reason'),
--          (select max(p.pronargs) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname = 'record_line_invoice');
-- Rollback: docs/finance-reporting/migrations/20261118150000_rollback.sql

BEGIN;

ALTER TABLE finance.line_invoices
  ADD COLUMN IF NOT EXISTS maher_total numeric(14, 2) CHECK (maher_total IS NULL OR maher_total > 0),
  ADD COLUMN IF NOT EXISTS variance_reason text CHECK (variance_reason IS NULL OR length(variance_reason) <= 500);

ALTER TABLE finance.line_invoices DROP CONSTRAINT IF EXISTS line_invoices_variance_has_reason;
ALTER TABLE finance.line_invoices ADD CONSTRAINT line_invoices_variance_has_reason CHECK (
  maher_total IS NULL
  OR abs(maher_total - total_amount) <= 1.00
  OR length(trim(coalesce(variance_reason, ''))) > 0
);

/* The old ten-parameter function goes; the new one takes the same ten first, so calls by name still match it. */
DROP FUNCTION IF EXISTS finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb);

/* ---------------------------------------------------------------------
   Record a MAHER invoice against lines, in full or in part.
   p_allocations: [{ "line", "amount", "work_order", "work_order_number",
   "name", "line_amount", "max_invoiced" }]: what this invoice covers, and
   each line as the server has just read it from FSM (line_amount before
   VAT). max_invoiced (optional): the most the line may have invoiced in
   total once this invoice is in. Each line is locked and may not be
   invoiced beyond its amount, nor beyond max_invoiced. Invoicing a line
   also marks it Ready. p_maher_total: the total printed on the MAHER
   invoice; more than AED 1.00 away from p_total needs p_variance_reason.
   Same idempotency key again: the first invoice's id.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.record_line_invoice(
  p_key text, p_number text, p_date date, p_total numeric, p_allocations jsonb,
  p_actor uuid, p_actor_label text, p_note text DEFAULT NULL, p_file_path text DEFAULT NULL, p_scan jsonb DEFAULT NULL,
  p_maher_total numeric DEFAULT NULL, p_variance_reason text DEFAULT NULL)
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
  v_reason text := nullif(trim(coalesce(p_variance_reason, '')), '');
BEGIN
  SELECT id INTO v_existing FROM finance.line_invoices WHERE idempotency_key = p_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF jsonb_typeof(p_allocations) <> 'array' OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'record_line_invoice: no lines' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_allocations) a
             WHERE coalesce(a->>'line', '') = '' OR coalesce(a->>'work_order', '') = '' OR (a->>'line_amount') IS NULL) THEN
    RAISE EXCEPTION 'record_line_invoice: every line needs its FSM id, work order and amount' USING ERRCODE = 'check_violation';
  END IF;
  IF p_maher_total IS NOT NULL AND p_maher_total <= 0 THEN
    RAISE EXCEPTION 'record_line_invoice: the MAHER total must be above zero' USING ERRCODE = 'check_violation';
  END IF;
  IF p_maher_total IS NOT NULL AND abs(p_maher_total - p_total) > 1.00 AND v_reason IS NULL THEN
    RAISE EXCEPTION 'record_line_invoice: the MAHER total (%) differs from the lines (%) by more than AED 1.00: give the reason',
      p_maher_total, p_total USING ERRCODE = 'check_violation';
  END IF;
  /* Work marked not to be invoiced, or waiting for that to be decided, is not invoiced. */
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
                                     recorded_by, recorded_by_label, maher_total, variance_reason)
  VALUES (p_key, trim(p_number), p_date, p_total, p_file_path, p_scan, nullif(trim(coalesce(p_note, '')), ''), p_actor, p_actor_label,
          p_maher_total, v_reason)
  RETURNING id INTO v_invoice;

  FOR v_alloc IN
    SELECT a->>'line' AS line, (a->>'amount')::numeric(14, 2) AS amount, a->>'work_order' AS work_order,
           a->>'work_order_number' AS work_order_number, a->>'name' AS name, (a->>'line_amount')::numeric(14, 2) AS line_amount,
           nullif(a->>'max_invoiced', '')::numeric(14, 2) AS max_invoiced
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
    /* What may be invoiced now, checked with the line locked: someone else's invoice a moment ago counts. */
    IF v_alloc.max_invoiced IS NOT NULL AND v_state.invoiced_amount + v_alloc.amount > v_alloc.max_invoiced + 0.01 THEN
      RAISE EXCEPTION 'record_line_invoice: line % can take % more now, not %. Someone may have just invoiced it: reload to see the latest.',
        v_line.fsm_line_id, greatest(v_alloc.max_invoiced - v_state.invoiced_amount, 0), v_alloc.amount
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

REVOKE ALL ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb, numeric, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb, numeric, text)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
