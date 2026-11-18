-- Rollback of 20261118150000_finance_invoice_guards (never automatic; run by hand only if asked).
-- Puts back the ten-parameter finance.record_line_invoice of 20261024100000 (no limit check under the lock, no MAHER
-- total) and drops the two columns: every MAHER total and difference reason recorded since is lost.
-- Deploy code from before this change first: the new code sends p_maher_total and would fail against the old function.
BEGIN;

DROP FUNCTION IF EXISTS finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb, numeric, text);

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

REVOKE ALL ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb) TO service_role;

ALTER TABLE finance.line_invoices DROP CONSTRAINT IF EXISTS line_invoices_variance_has_reason;
ALTER TABLE finance.line_invoices DROP COLUMN IF EXISTS variance_reason, DROP COLUMN IF EXISTS maher_total;

COMMIT;

NOTIFY pgrst, 'reload schema';
