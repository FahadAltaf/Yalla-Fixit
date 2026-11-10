-- Rollback for 20261021110000_finance_queue_list. A read-only view: dropping
-- it loses no data. Never run automatically.
DROP VIEW IF EXISTS finance.queue_list;
