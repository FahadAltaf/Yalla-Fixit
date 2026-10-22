-- Rollback for 20261025100000_finance_work_order_snapshot. The snapshot
-- columns only repeat what FSM holds; dropping them loses nothing else.
DROP FUNCTION IF EXISTS finance.snapshot_work_order(text, jsonb, jsonb);
ALTER TABLE finance.work_order_states
  DROP COLUMN IF EXISTS client_name,
  DROP COLUMN IF EXISTS quotation_number,
  DROP COLUMN IF EXISTS coordinator_name,
  DROP COLUMN IF EXISTS fsm_status,
  DROP COLUMN IF EXISTS work_order_type,
  DROP COLUMN IF EXISTS fsm_created_at,
  DROP COLUMN IF EXISTS sub_total,
  DROP COLUMN IF EXISTS seen_at;
NOTIFY pgrst, 'reload schema';
