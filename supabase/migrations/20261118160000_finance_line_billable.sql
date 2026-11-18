-- 20261118160000_finance_line_billable
--
-- Completion % and "to invoice" without the non-billable lines (Sami, 9 Nov 2026).
--
-- A work order can mix billable lines and lines FSM bills as Non Billable (27 Oct). The work order page already
-- counts only the billable lines, but the Ready to invoice list, the invoicing metrics and the daily email work from
-- FSM's total, which includes the non-billable lines: a work order whose billable lines were invoiced in full still
-- showed "Partially invoiced", a completion % below 100 and an amount left "to invoice" that will never be invoiced.
--
-- finance.line_states gets "billable" (null: not known yet, counted as billable, as before). The snapshot the server
-- keeps whenever someone acts on a work order (20261025100000) now records it per line, from FSM's Billing Status.
--
-- Live-safe: one nullable column, and finance.snapshot_work_order replaced with the same signature. The code live now
-- sends no "billable", which leaves the column as it is. One transaction. Idempotent.
--
-- Post-check: expect `1 | t` from
--   select (select count(*) from information_schema.columns where table_schema = 'finance'
--             and table_name = 'line_states' and column_name = 'billable'),
--          (select pg_get_functiondef(p.oid) like '%billable%' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname = 'snapshot_work_order');
-- Rollback: docs/finance-reporting/migrations/20261118160000_rollback.sql

BEGIN;

ALTER TABLE finance.line_states ADD COLUMN IF NOT EXISTS billable boolean;

/* ---------------------------------------------------------------------
   As 20261025100000, and each line's "billable" (true, false, or left out
   to keep what is stored).
   --------------------------------------------------------------------- */
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

  INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id, work_order_number, name, amount, amount_with_vat, fsm_completed_at,
                                   billable)
  SELECT DISTINCT ON (l->>'id') l->>'id', p_work_order_id, nullif(p_work_order->>'number', ''), l->>'name',
         coalesce((l->>'amount')::numeric(14, 2), 0), nullif(l->>'amount_with_vat', '')::numeric(14, 2),
         nullif(l->>'completed_at', '')::timestamptz,
         CASE WHEN l ? 'billable' AND jsonb_typeof(l->'billable') = 'boolean' THEN (l->>'billable')::boolean END
  FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  ON CONFLICT (fsm_line_id) DO UPDATE
    SET work_order_number = coalesce(excluded.work_order_number, line_states.work_order_number),
        name = excluded.name,
        amount = excluded.amount,
        amount_with_vat = excluded.amount_with_vat,
        fsm_completed_at = excluded.fsm_completed_at,
        billable = coalesce(excluded.billable, line_states.billable);
END;
$$;

REVOKE ALL ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
