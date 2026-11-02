-- Rollback of 20261103100000_finance_query_threads (never automatic; run by hand only if asked).
BEGIN;

/* Work orders held in Query Raised by an open thread go back where they were. */
UPDATE finance.work_order_states s
SET status = CASE WHEN s.status_before_query = 'on_hold' AND s.hold_reason IS NULL THEN 'in_progress' ELSE coalesce(s.status_before_query, 'open') END,
    status_before_query = NULL, query_text = NULL, status_changed_at = now(), updated_at = now()
WHERE s.status = 'query_raised'
  AND EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.fsm_work_order_id = s.fsm_work_order_id AND t.status = 'open');

DROP FUNCTION IF EXISTS finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text);
DROP FUNCTION IF EXISTS finance.open_query_thread(text, text, text, text, text, text[], uuid, text, uuid, text);
DROP TABLE IF EXISTS finance.query_comments;
DROP TABLE IF EXISTS finance.query_threads;

COMMIT;
NOTIFY pgrst, 'reload schema';
