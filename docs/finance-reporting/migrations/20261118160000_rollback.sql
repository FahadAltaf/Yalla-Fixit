-- Rollback of 20261118160000_finance_line_billable (never automatic; run by hand only if asked).
-- Puts back finance.snapshot_work_order of 20261025100000 and drops line_states.billable (what was recorded is lost).
-- The code reads the column with select *, so it keeps working without it (every line counts as billable again).
BEGIN;

CREATE OR REPLACE FUNCTION finance.snapshot_work_order(p_work_order_id text, p_work_order jsonb, p_lines jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
BEGIN
  IF coalesce(p_work_order_id, '') = '' OR jsonb_typeof(p_work_order) <> 'object' THEN
    RAISE EXCEPTION 'snapshot_work_order: no work order' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'snapshot_work_order: lines must be a list' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
             WHERE coalesce(l->>'id', '') = '' OR (l->>'amount')::numeric < 0) THEN
    RAISE EXCEPTION 'snapshot_work_order: every line needs its FSM id and an amount' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.line_states s JOIN jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l ON s.fsm_line_id = l->>'id'
             WHERE s.fsm_work_order_id <> p_work_order_id) THEN
    RAISE EXCEPTION 'snapshot_work_order: a line belongs to another work order' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.work_order_states AS w (
    fsm_work_order_id, work_order_number, client_name, contact_name, quotation_number, coordinator_name, fsm_status,
    work_order_type, fsm_created_at, fsm_completed_at, sub_total, grand_total, seen_at)
  VALUES (
    p_work_order_id,
    nullif(p_work_order->>'number', ''),
    nullif(p_work_order->>'client', ''),
    nullif(p_work_order->>'contact', ''),
    nullif(p_work_order->>'quotation', ''),
    nullif(p_work_order->>'coordinator', ''),
    nullif(p_work_order->>'status', ''),
    nullif(p_work_order->>'type', ''),
    nullif(p_work_order->>'created_at', '')::timestamptz,
    nullif(p_work_order->>'completed_at', '')::timestamptz,
    nullif(p_work_order->>'sub_total', '')::numeric(14, 2),
    nullif(p_work_order->>'grand_total', '')::numeric(14, 2),
    now())
  ON CONFLICT (fsm_work_order_id) DO UPDATE SET
    work_order_number = coalesce(excluded.work_order_number, w.work_order_number),
    client_name = excluded.client_name,
    contact_name = excluded.contact_name,
    quotation_number = excluded.quotation_number,
    coordinator_name = excluded.coordinator_name,
    fsm_status = excluded.fsm_status,
    work_order_type = excluded.work_order_type,
    fsm_created_at = excluded.fsm_created_at,
    fsm_completed_at = excluded.fsm_completed_at,
    sub_total = excluded.sub_total,
    grand_total = excluded.grand_total,
    seen_at = excluded.seen_at;

  INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id, work_order_number, name, amount, amount_with_vat, fsm_completed_at)
  SELECT DISTINCT ON (l->>'id') l->>'id', p_work_order_id, nullif(p_work_order->>'number', ''), l->>'name',
         coalesce((l->>'amount')::numeric(14, 2), 0), nullif(l->>'amount_with_vat', '')::numeric(14, 2),
         nullif(l->>'completed_at', '')::timestamptz
  FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  ON CONFLICT (fsm_line_id) DO UPDATE
    SET work_order_number = coalesce(excluded.work_order_number, line_states.work_order_number),
        name = excluded.name,
        amount = excluded.amount,
        amount_with_vat = excluded.amount_with_vat,
        fsm_completed_at = excluded.fsm_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) TO service_role;

ALTER TABLE finance.line_states DROP COLUMN IF EXISTS billable;

COMMIT;

NOTIFY pgrst, 'reload schema';
