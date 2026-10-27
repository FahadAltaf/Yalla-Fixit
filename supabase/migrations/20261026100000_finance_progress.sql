-- =====================================================================
-- Finance & Reports: how far work has got, as Operations records it.
--
-- FSM cannot record partial completion (decided 26 Oct, invoicing changes
-- 4, 5 and 7). Operations enters "X % done" against a work order or one of
-- its lines, with one of two purposes:
--
--   invoice       X % done, invoice this: Finance may invoice up to X % of
--                 the line before the work order is completed in FSM, and
--                 the record dialog is filled with it.
--   revenue_only  X % done, recognise the revenue, do not invoice yet: work
--                 straddling a month end, invoiced only when finished.
--
-- Both count towards the recognised value (Finance books revenue at month
-- end without an invoice). The latest entry for a line, or for the whole
-- work order, is the one that counts; the earlier ones stay as history.
--
--   finance.progress_entries   every entry: work order, line (null = the
--                              whole work order), percent, purpose, the
--                              value before VAT it applied to, who, when.
--   finance.line_events        + 'progress_recorded', for the history tab.
--
-- Writes only through finance.record_progress (one transaction). Entries
-- are append-only. Operations never records an invoice through this: the
-- invoice functions are unchanged and stay with Finance.
--
-- Live-safe: one new table and one function in schema finance, and a wider
-- check on line_events.event_type. Nothing on main reads schema finance.
-- Post-check: expect `1 | 1 | t` from
--   select (select count(*) from information_schema.tables where table_schema = 'finance'
--             and table_name = 'progress_entries'),
--          (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--             where n.nspname = 'finance' and p.proname = 'record_progress'),
--          (select pg_get_constraintdef(oid) like '%progress_recorded%' from pg_constraint
--             where conname = 'line_events_event_type_check');
-- Rollback: docs/finance-reporting/migrations/20261026100000_rollback.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.progress_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsm_work_order_id text NOT NULL,
  work_order_number text,
  /* Null: the whole work order (the percent applies to every line). */
  fsm_line_id text,
  line_name text,
  percent numeric(5, 2) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  purpose text NOT NULL CHECK (purpose IN ('invoice', 'revenue_only')),
  /* The line's, or the work order's, value before VAT as FSM gave it then. */
  value_before_vat numeric(14, 2) NOT NULL DEFAULT 0 CHECK (value_before_vat >= 0),
  note text CHECK (note IS NULL OR length(note) <= 2000),
  recorded_by uuid,
  recorded_by_label text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_progress_entries_work_order ON finance.progress_entries (fsm_work_order_id, recorded_at DESC);

DROP TRIGGER IF EXISTS progress_entries_append_only ON finance.progress_entries;
CREATE TRIGGER progress_entries_append_only BEFORE UPDATE OR DELETE ON finance.progress_entries
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS progress_entries_append_only_truncate ON finance.progress_entries;
CREATE TRIGGER progress_entries_append_only_truncate BEFORE TRUNCATE ON finance.progress_entries
  FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only();

/* The history can say a percentage was recorded. */
ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected',
  'progress_recorded'));

/* ---------------------------------------------------------------------
   Record "X % done" for a work order or some of its lines.
   p_entries: [{ line: FSM line id or null, name, percent, purpose, value }],
   value being the line's (or work order's) amount before VAT now. A line
   cannot be put below what has already been invoiced of it. Returns how
   many entries were recorded.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.record_progress(
  p_work_order_id text, p_work_order_number text, p_entries jsonb, p_actor uuid, p_actor_label text, p_note text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_entry record;
  v_state record;
  v_count integer := 0;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF coalesce(p_work_order_id, '') = '' THEN
    RAISE EXCEPTION 'record_progress: no work order' USING ERRCODE = 'check_violation';
  END IF;
  IF jsonb_typeof(p_entries) <> 'array' OR jsonb_array_length(p_entries) = 0 OR jsonb_array_length(p_entries) > 500 THEN
    RAISE EXCEPTION 'record_progress: no lines' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id AND status = 'excluded') THEN
    RAISE EXCEPTION 'record_progress: the work order is marked not to be invoiced' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_entry IN
    SELECT nullif(e->>'line', '') AS line, e->>'name' AS name, (e->>'percent')::numeric(5, 2) AS percent,
           e->>'purpose' AS purpose, coalesce((e->>'value')::numeric(14, 2), 0) AS value
    FROM jsonb_array_elements(p_entries) e
  LOOP
    IF v_entry.percent IS NULL OR v_entry.percent < 0 OR v_entry.percent > 100 THEN
      RAISE EXCEPTION 'record_progress: a percentage must be from 0 to 100' USING ERRCODE = 'check_violation';
    END IF;
    IF v_entry.purpose IS NULL OR v_entry.purpose NOT IN ('invoice', 'revenue_only') THEN
      RAISE EXCEPTION 'record_progress: say whether to invoice it or recognise the revenue only' USING ERRCODE = 'check_violation';
    END IF;
    IF v_entry.value < 0 THEN
      RAISE EXCEPTION 'record_progress: a value cannot be negative' USING ERRCODE = 'check_violation';
    END IF;
    IF v_entry.line IS NOT NULL THEN
      SELECT fsm_work_order_id, invoiced_amount INTO v_state FROM finance.line_states WHERE fsm_line_id = v_entry.line;
      IF FOUND AND v_state.fsm_work_order_id <> p_work_order_id THEN
        RAISE EXCEPTION 'record_progress: line % belongs to another work order', v_entry.line USING ERRCODE = 'check_violation';
      END IF;
      IF FOUND AND v_state.invoiced_amount > round(v_entry.value * v_entry.percent / 100, 2) + 0.01 THEN
        RAISE EXCEPTION 'record_progress: % is already invoiced beyond % %%', coalesce(v_entry.name, 'a line'), v_entry.percent
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

    INSERT INTO finance.progress_entries (fsm_work_order_id, work_order_number, fsm_line_id, line_name, percent, purpose,
                                          value_before_vat, note, recorded_by, recorded_by_label)
    VALUES (p_work_order_id, nullif(p_work_order_number, ''), v_entry.line, v_entry.name, v_entry.percent, v_entry.purpose,
            v_entry.value, v_note, p_actor, p_actor_label);
    INSERT INTO finance.line_events (fsm_work_order_id, fsm_line_id, event_type, to_status, amount, actor_id, actor_label, note)
    VALUES (p_work_order_id, v_entry.line, 'progress_recorded', v_entry.purpose, round(v_entry.value * v_entry.percent / 100, 2),
            p_actor, p_actor_label,
            trim(both ' ' FROM format('%s%% done, %s', v_entry.percent::text,
              CASE v_entry.purpose WHEN 'invoice' THEN 'to invoice' ELSE 'revenue only' END)
              || coalesce('. ' || v_note, '')));
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

ALTER TABLE finance.progress_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.progress_entries FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.record_progress(text, text, jsonb, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.progress_entries TO service_role;
GRANT EXECUTE ON FUNCTION finance.record_progress(text, text, jsonb, uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
