-- Clear the Finance test data (19 Nov 2026), so Ready to invoice can be tested
-- again from the start. Asked for by the user on 19 Nov. Run in the Supabase
-- SQL editor (as the owner: the append-only guards are switched off for the
-- moment the tables are emptied, then on again).
--
-- What goes:
--   * every row of the finance schema's 14 tables: Ready marks, invoices and
--     their lines, % done, holds, queries and their comments, "not
--     invoiceable" marks, the work order snapshots and their history, and
--     the old queue's tables;
--   * the Finance notifications in the inbox (public.portal_notifications
--     whose event starts with "finance."; nothing else in that table).
-- What stays: Zoho FSM (read live, never written by this), users, roles,
-- permissions, Reporting Settings, Reports, AMC, snagging, scheduling.
-- Storage: the uploaded MAHER invoices and evidence stay in the private
-- finance-evidence bucket; empty it by hand in the dashboard if you want
-- (Storage > finance-evidence > select all > Delete). Nothing links to them
-- once these rows are gone.
--
-- One transaction: if any step fails, nothing changes.

-- 0. Before: how many rows each table holds now (run on its own first, to see what will go).
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
UNION ALL SELECT 'progress_entries', count(*) FROM finance.progress_entries
UNION ALL SELECT 'query_threads', count(*) FROM finance.query_threads
UNION ALL SELECT 'query_comments', count(*) FROM finance.query_comments
UNION ALL SELECT 'finance notifications', count(*) FROM public.portal_notifications WHERE event LIKE 'finance.%';

BEGIN;

-- 1. The append-only guards (finance.append_only), off for this transaction only.
ALTER TABLE finance.invoices                 DISABLE TRIGGER USER;
ALTER TABLE finance.queue_events             DISABLE TRIGGER USER;
ALTER TABLE finance.queue_item_lines         DISABLE TRIGGER USER;
ALTER TABLE finance.line_invoices            DISABLE TRIGGER USER;
ALTER TABLE finance.line_invoice_allocations DISABLE TRIGGER USER;
ALTER TABLE finance.line_events              DISABLE TRIGGER USER;
ALTER TABLE finance.progress_entries         DISABLE TRIGGER USER;
ALTER TABLE finance.query_comments           DISABLE TRIGGER USER;

-- 2. Empty all fourteen together (their foreign keys point only at each other; no CASCADE).
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
  finance.progress_entries,
  finance.query_threads,
  finance.query_comments
RESTART IDENTITY;

-- 3. The guards back on.
ALTER TABLE finance.invoices                 ENABLE TRIGGER USER;
ALTER TABLE finance.queue_events             ENABLE TRIGGER USER;
ALTER TABLE finance.queue_item_lines         ENABLE TRIGGER USER;
ALTER TABLE finance.line_invoices            ENABLE TRIGGER USER;
ALTER TABLE finance.line_invoice_allocations ENABLE TRIGGER USER;
ALTER TABLE finance.line_events              ENABLE TRIGGER USER;
ALTER TABLE finance.progress_entries         ENABLE TRIGGER USER;
ALTER TABLE finance.query_comments           ENABLE TRIGGER USER;

-- 4. The Finance notifications in the inbox (only these: every other event stays).
DELETE FROM public.portal_notifications WHERE event LIKE 'finance.%';

COMMIT;

-- Post-check: expect 0 everywhere, and guards_off = 0 (every append-only guard back on).
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
UNION ALL SELECT 'progress_entries', count(*) FROM finance.progress_entries
UNION ALL SELECT 'query_threads', count(*) FROM finance.query_threads
UNION ALL SELECT 'query_comments', count(*) FROM finance.query_comments
UNION ALL SELECT 'finance notifications', count(*) FROM public.portal_notifications WHERE event LIKE 'finance.%';

SELECT count(*) AS guards_on, count(*) FILTER (WHERE tg.tgenabled <> 'O') AS guards_off
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'finance' AND tg.tgname LIKE '%append_only%';
