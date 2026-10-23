-- =====================================================================
-- Finance & Reports: what a work order looked like in FSM when the portal
-- last acted on it.
--
-- Ready to invoice reads work orders live from Zoho FSM and copies nothing
-- (the user's direction, 22 Oct). The invoicing metrics, the daily digest
-- and the work still waiting from before the list's dates must not call
-- FSM on every view, though, and the ledger (20261024100000) only knows
-- the lines someone marked or invoiced. So whenever someone acts on a work
-- order (marks it ready, picks it up, invoices, excludes it), the server,
-- which has just read it from FSM for that action, also keeps:
--
--   finance.work_order_states  + client, client contact, quotation,
--                                coordinator, FSM status, type, raised at,
--                                completed at, value before and with VAT,
--                                and when it was read (seen_at).
--   finance.line_states        every line of the work order, with its
--                                name, amount and when FSM completed it
--                                (ready stays false for lines nobody
--                                marked), so "invoiced in full", an
--                                excluded work order's value and the days
--                                from completion to invoice are known
--                                without FSM.
--
-- Work orders nobody acts on are never stored. Writes go only through
-- finance.snapshot_work_order, which never changes a Ready mark, an
-- invoiced amount or a workflow status.
--
-- Live-safe: nullable columns and one function in schema finance, which
-- nothing on main reads.
-- Post-check: expect `11 | 1 | 1` from
--   select (select count(*) from information_schema.columns where table_schema = 'finance'
--             and table_name = 'work_order_states'
--             and column_name in ('client_name', 'contact_name', 'quotation_number', 'coordinator_name', 'fsm_status',
--                                 'work_order_type', 'fsm_created_at', 'fsm_completed_at', 'sub_total', 'grand_total',
--                                 'seen_at')),
--          (select count(*) from information_schema.columns where table_schema = 'finance'
--             and table_name = 'line_states' and column_name = 'fsm_completed_at'),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname = 'snapshot_work_order');
-- Rollback: docs/finance-reporting/migrations/20261025100000_rollback.sql
-- =====================================================================

ALTER TABLE finance.work_order_states
  ADD COLUMN IF NOT EXISTS client_name text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS quotation_number text,
  ADD COLUMN IF NOT EXISTS coordinator_name text,
  ADD COLUMN IF NOT EXISTS fsm_status text,
  ADD COLUMN IF NOT EXISTS work_order_type text,
  ADD COLUMN IF NOT EXISTS fsm_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS fsm_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sub_total numeric(14, 2),
  ADD COLUMN IF NOT EXISTS grand_total numeric(14, 2),
  ADD COLUMN IF NOT EXISTS seen_at timestamptz;

/* When FSM completed the line, as last seen: invoicing waits for it (23 Oct). */
ALTER TABLE finance.line_states
  ADD COLUMN IF NOT EXISTS fsm_completed_at timestamptz;

/* ---------------------------------------------------------------------
   Keep what FSM said about a work order and its lines, as the server has
   just read it. p_work_order: { number, client, contact, quotation,
   coordinator, status, type, created_at, completed_at, sub_total,
   grand_total }; p_lines: [{ id, name, amount, completed_at }].
   A new work order starts Open; an existing one keeps its status,
   assignee and Ready marks.
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

  INSERT INTO finance.line_states (fsm_line_id, fsm_work_order_id, work_order_number, name, amount, fsm_completed_at)
  SELECT DISTINCT ON (l->>'id') l->>'id', p_work_order_id, nullif(p_work_order->>'number', ''), l->>'name',
         coalesce((l->>'amount')::numeric(14, 2), 0), nullif(l->>'completed_at', '')::timestamptz
  FROM jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
  ON CONFLICT (fsm_line_id) DO UPDATE
    SET work_order_number = coalesce(excluded.work_order_number, line_states.work_order_number),
        name = excluded.name,
        amount = excluded.amount,
        fsm_completed_at = excluded.fsm_completed_at;
END;
$$;

REVOKE ALL ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.snapshot_work_order(text, jsonb, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
