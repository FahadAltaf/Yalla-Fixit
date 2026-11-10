-- Rollback of 20261103110000_finance_fsm_completion_log (never automatic; run by hand only if asked).
-- Fails at the ADD CONSTRAINT if any fsm_completed / fsm_not_completed event exists: they are history and stay.
BEGIN;

DROP FUNCTION IF EXISTS finance.record_fsm_completion(text, boolean, text, uuid, text);

ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected',
  'progress_recorded'));

COMMIT;
NOTIFY pgrst, 'reload schema';
