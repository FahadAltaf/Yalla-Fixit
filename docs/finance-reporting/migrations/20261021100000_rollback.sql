-- Rollback for 20261021100000_finance_core. Review before running; never
-- run automatically. Drops the queue, its invoices and its history.
-- Before go-live these hold only test data. After go-live, do not run it:
-- the invoices and events are the audit trail.
BEGIN;
DROP VIEW IF EXISTS finance.estimate_progress;
DROP FUNCTION IF EXISTS finance.record_invoice(uuid, text, text, date, numeric, text, uuid, text);
DROP FUNCTION IF EXISTS finance.decide_exclusion(uuid, text, text, uuid, text);
DROP FUNCTION IF EXISTS finance.request_exclusion(uuid, text, text, text[], uuid, text);
DROP FUNCTION IF EXISTS finance.apply_action(uuid, text, text, uuid, text, text);
DROP FUNCTION IF EXISTS finance.create_queue_item(text, text, text[], text);
DROP TABLE IF EXISTS finance.queue_events;
DROP TABLE IF EXISTS finance.exclusions;
DROP TABLE IF EXISTS finance.invoices;
DROP TABLE IF EXISTS finance.queue_item_lines;
DROP TABLE IF EXISTS finance.queue_items;
DROP FUNCTION IF EXISTS finance.append_only();
-- Fails, on purpose, if anything else was put in the schema since.
DROP SCHEMA IF EXISTS finance;
COMMIT;
-- Then remove finance from Exposed schemas (Project Settings > API).
