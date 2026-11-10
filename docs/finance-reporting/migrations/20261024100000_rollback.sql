-- Rollback for 20261024100000_finance_line_ledger. Only before go-live:
-- recorded invoices are records Finance relies on.
DROP FUNCTION IF EXISTS finance.decide_wo_exclusion(uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS finance.request_wo_exclusion(text, text, text, text[], uuid, text, text);
DROP FUNCTION IF EXISTS finance.wo_apply_action(text, text, text, uuid, text, text, text);
DROP FUNCTION IF EXISTS finance.record_line_invoice(text, text, date, numeric, jsonb, uuid, text, text, text, jsonb);
DROP FUNCTION IF EXISTS finance.set_lines_ready(text, text, jsonb, boolean, uuid, text, text);
DROP TABLE IF EXISTS finance.line_events;
DROP TABLE IF EXISTS finance.line_invoice_allocations;
DROP TABLE IF EXISTS finance.line_invoices;
DROP TABLE IF EXISTS finance.line_states;
DROP TABLE IF EXISTS finance.wo_exclusions;
DROP TABLE IF EXISTS finance.work_order_states;
NOTIFY pgrst, 'reload schema';
