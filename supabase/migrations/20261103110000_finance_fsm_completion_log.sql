-- =====================================================================
-- Finance & Reports: completion sent to Zoho FSM, on the work order's
-- history (the user's direction, 2 Nov).
--
-- When Operations marks a line or the whole work order complete, the
-- portal completes it in FSM too (lib/server/finance/fsm-completion.ts,
-- behind FINANCE_FSM_COMPLETION=on). The portal's completion is saved
-- whatever FSM says; FSM's answer, done or the reason it refused, is kept
-- here so it can be seen later on the work order's history.
--
--   finance.line_events        + 'fsm_completed', 'fsm_not_completed'.
--   finance.record_fsm_completion   writes one such event.
--
-- Live-safe: a wider check on line_events.event_type and one function in
-- schema finance. Nothing on main reads schema finance. Idempotent.
-- Apply with the checks in docs/finance-reporting/migrations/20261103110000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261103110000_rollback.sql.
-- =====================================================================

ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected',
  'progress_recorded',
  'fsm_completed', 'fsm_not_completed'));

CREATE OR REPLACE FUNCTION finance.record_fsm_completion(
  p_work_order_id text, p_completed boolean, p_note text, p_actor uuid, p_actor_label text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
BEGIN
  IF coalesce(p_work_order_id, '') = '' THEN
    RAISE EXCEPTION 'record_fsm_completion: no work order' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO finance.line_events (fsm_work_order_id, event_type, actor_id, actor_label, note)
  VALUES (p_work_order_id, CASE WHEN p_completed THEN 'fsm_completed' ELSE 'fsm_not_completed' END, p_actor, p_actor_label,
          left(nullif(trim(coalesce(p_note, '')), ''), 2000));
END;
$$;

REVOKE ALL ON FUNCTION finance.record_fsm_completion(text, boolean, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.record_fsm_completion(text, boolean, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
