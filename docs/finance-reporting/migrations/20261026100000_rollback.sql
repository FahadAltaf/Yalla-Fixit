-- Rollback for 20261026100000_finance_progress. Drops Operations' "% done"
-- entries and their history rows; invoices, Ready marks and the workflow
-- are untouched.
DROP FUNCTION IF EXISTS finance.record_progress(text, text, jsonb, uuid, text, text);
DROP TABLE IF EXISTS finance.progress_entries;
/* The history's progress rows go before the narrower check comes back. */
ALTER TABLE finance.line_events DISABLE TRIGGER USER;
DELETE FROM finance.line_events WHERE event_type = 'progress_recorded';
ALTER TABLE finance.line_events ENABLE TRIGGER USER;
ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected'));
NOTIFY pgrst, 'reload schema';
