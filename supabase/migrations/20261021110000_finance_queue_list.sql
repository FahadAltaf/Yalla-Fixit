-- =====================================================================
-- Finance & Reports P4: the queue list's read view (BRD §6.4; DEV-435).
--
-- finance.queue_list: one row per queue item with what the list shows and
-- filters on, joined once here so the screen pages and filters on the
-- server: work order and quotation numbers, client, the quotation's owner
-- (shown as coordinator until D-18 says who that is), assignee, and the
-- completion % as BRD §6.1 defines it:
--
--   (cumulative invoiced on the quotation + this item) / quotation total
--
-- "Cumulative invoiced" is the invoiced items that entered the queue
-- BEFORE this one (by item number), so each item keeps the % it took the
-- quotation to: month 1 of Q-1042 reads 41.7 % even after month 3 is
-- invoiced, and an item is never counted twice.
--
-- Read-only, a view only. Live-safe; live main reads nothing in finance.
-- Idempotent (CREATE OR REPLACE).
--
-- Checks: docs/finance-reporting/migrations/20261021110000.md.
-- Rollback: DROP VIEW IF EXISTS finance.queue_list;
-- =====================================================================

CREATE OR REPLACE VIEW finance.queue_list AS
SELECT
  i.id,
  i.number,
  i.status,
  i.status_changed_at,
  i.entered_at,
  i.value,
  i.line_count,
  i.created_by,
  i.assignee_id,
  coalesce(nullif(trim(u.full_name), ''), u.email) AS assignee_name,
  i.fsm_work_order_id,
  w.number AS work_order_number,
  coalesce(w.company_name, e.company_name) AS client_name,
  i.fsm_estimate_id,
  e.number AS quotation_number,
  e.owner_name AS coordinator_name,
  i.quotation_total,
  CASE WHEN i.quotation_total > 0 THEN
    round(100 * (
      coalesce((SELECT sum(l.amount)
                FROM finance.queue_items i2
                JOIN finance.queue_item_lines l ON l.queue_item_id = i2.id
                WHERE i2.fsm_estimate_id = i.fsm_estimate_id
                  AND i2.status = 'invoiced'
                  AND i2.number < i.number), 0)
      + i.value) / i.quotation_total, 1)
  END AS completion_percent
FROM finance.queue_items i
LEFT JOIN fsm.work_orders w ON w.fsm_work_order_id = i.fsm_work_order_id
LEFT JOIN fsm.estimates e ON e.fsm_estimate_id = i.fsm_estimate_id
LEFT JOIN public.user_profile u ON u.id = i.assignee_id;

REVOKE ALL ON finance.queue_list FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.queue_list TO service_role;

NOTIFY pgrst, 'reload schema';
