-- Clear the Finance test data (27 Oct 2026), so Ready to invoice can be
-- tested from the start. Run once in the Supabase SQL editor (as the owner:
-- the append-only guards are switched off for the moment the tables are
-- emptied, then on again).
--
-- Only the finance schema's 12 tables are emptied. Nothing else: no FSM
-- data (FSM is read live, never written), no public schema tables, no
-- users, roles or settings, no storage files. One transaction: if any step
-- fails, nothing changes.
--
-- Before (counted 27 Oct, 11:20): queue_items 6, queue_item_lines 16,
-- queue_events 17, invoices 2, exclusions 2, line_states 16, line_invoices
-- 11, line_invoice_allocations 12, line_events 42, work_order_states 8,
-- wo_exclusions 1, progress_entries 9 (142 rows).

BEGIN;

-- 1. The append-only guards (finance.append_only), off for this transaction only.
ALTER TABLE finance.invoices                 DISABLE TRIGGER USER;
ALTER TABLE finance.queue_events             DISABLE TRIGGER USER;
ALTER TABLE finance.queue_item_lines         DISABLE TRIGGER USER;
ALTER TABLE finance.line_invoices            DISABLE TRIGGER USER;
ALTER TABLE finance.line_invoice_allocations DISABLE TRIGGER USER;
ALTER TABLE finance.line_events              DISABLE TRIGGER USER;
ALTER TABLE finance.progress_entries         DISABLE TRIGGER USER;

-- 2. Empty all twelve together (their foreign keys point only at each other; no CASCADE).
TRUNCATE TABLE
  finance.queue_items,
  finance.queue_item_lines,
  finance.queue_events,
  finance.invoices,
  finance.exclusions,
  finance.line_states,
  finance.line_invoices,
  finance.line_invoice_allocations,
  finance.line_events,
  finance.work_order_states,
  finance.wo_exclusions,
  finance.progress_entries
RESTART IDENTITY;

-- 3. The guards back on.
ALTER TABLE finance.invoices                 ENABLE TRIGGER USER;
ALTER TABLE finance.queue_events             ENABLE TRIGGER USER;
ALTER TABLE finance.queue_item_lines         ENABLE TRIGGER USER;
ALTER TABLE finance.line_invoices            ENABLE TRIGGER USER;
ALTER TABLE finance.line_invoice_allocations ENABLE TRIGGER USER;
ALTER TABLE finance.line_events              ENABLE TRIGGER USER;
ALTER TABLE finance.progress_entries         ENABLE TRIGGER USER;

COMMIT;

-- Post-check: expect 0 rows everywhere, and 13 guards back on (enabled = 'O').
SELECT 'queue_items' AS t, count(*) FROM finance.queue_items
UNION ALL SELECT 'queue_item_lines', count(*) FROM finance.queue_item_lines
UNION ALL SELECT 'queue_events', count(*) FROM finance.queue_events
UNION ALL SELECT 'invoices', count(*) FROM finance.invoices
UNION ALL SELECT 'exclusions', count(*) FROM finance.exclusions
UNION ALL SELECT 'line_states', count(*) FROM finance.line_states
UNION ALL SELECT 'line_invoices', count(*) FROM finance.line_invoices
UNION ALL SELECT 'line_invoice_allocations', count(*) FROM finance.line_invoice_allocations
UNION ALL SELECT 'line_events', count(*) FROM finance.line_events
UNION ALL SELECT 'work_order_states', count(*) FROM finance.work_order_states
UNION ALL SELECT 'wo_exclusions', count(*) FROM finance.wo_exclusions
UNION ALL SELECT 'progress_entries', count(*) FROM finance.progress_entries;

SELECT count(*) AS guards_on
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance' AND tg.tgname LIKE '%append_only%' AND tg.tgenabled = 'O';
