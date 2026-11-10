-- Rollback of 20261104100000_finance_not_invoiceable_both_sides (never automatic; run by hand only if asked).
-- Puts back the reply rules of 20261103100000 (resolved / not resolved / corrected / withdrawn; only the raiser closes),
-- drops the two mark functions and the new columns (who marked a work order, and who undid it, are lost).
-- Fails at the ADD CONSTRAINT if any 'exclusion_reverted' event exists: history stays; delete those first only if asked.
-- Work orders already marked stay Excluded.
BEGIN;

DROP FUNCTION IF EXISTS finance.mark_not_invoiceable(text, text, text, text, text, text[], uuid, text);
DROP FUNCTION IF EXISTS finance.mark_invoiceable(text, text, text, uuid, text);

CREATE OR REPLACE FUNCTION finance.reply_query_thread(
  p_thread_id uuid, p_side text, p_body text, p_action text, p_tagged uuid, p_tagged_label text, p_actor uuid, p_actor_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_thread finance.query_threads%ROWTYPE;
  v_state finance.work_order_states%ROWTYPE;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_other text := CASE p_side WHEN 'finance' THEN 'operations' ELSE 'finance' END;
  v_resolution text;
  v_to text;
BEGIN
  IF p_side NOT IN ('finance', 'operations') THEN
    RAISE EXCEPTION 'reply_query_thread: say which side is replying' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_thread FROM finance.query_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reply_query_thread: no query %', p_thread_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_thread.status <> 'open' THEN
    RAISE EXCEPTION 'reply_query_thread: the query is already resolved' USING ERRCODE = 'serialization_failure';
  END IF;

  CASE p_action
    WHEN 'comment' THEN
      IF v_body IS NULL THEN RAISE EXCEPTION 'reply_query_thread: write the comment' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'not_resolved' THEN
      IF p_side = v_thread.raised_by_side THEN
        RAISE EXCEPTION 'reply_query_thread: only the side asked marks it not resolved' USING ERRCODE = 'check_violation';
      END IF;
      IF v_body IS NULL THEN RAISE EXCEPTION 'reply_query_thread: say why it is not resolved' USING ERRCODE = 'check_violation'; END IF;
    WHEN 'resolved' THEN
      IF p_side = v_thread.raised_by_side THEN
        RAISE EXCEPTION 'reply_query_thread: the side that raised it closes it instead' USING ERRCODE = 'check_violation';
      END IF;
      IF v_thread.kind = 'not_invoiceable' THEN
        RAISE EXCEPTION 'reply_query_thread: a not-invoiceable query needs the completion corrected or the request to invoice withdrawn'
          USING ERRCODE = 'check_violation';
      END IF;
      IF v_body IS NULL THEN RAISE EXCEPTION 'reply_query_thread: write the answer' USING ERRCODE = 'check_violation'; END IF;
      v_resolution := 'answered';
    WHEN 'corrected', 'withdrawn' THEN
      IF v_thread.kind <> 'not_invoiceable' OR p_side <> 'operations' THEN
        RAISE EXCEPTION 'reply_query_thread: only Operations corrects or withdraws, on a not-invoiceable query' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM finance.progress_entries e
                     WHERE e.fsm_work_order_id = v_thread.fsm_work_order_id AND e.recorded_at > v_thread.created_at)
         AND NOT (p_action = 'withdrawn' AND EXISTS (SELECT 1 FROM finance.work_order_states s
                     WHERE s.fsm_work_order_id = v_thread.fsm_work_order_id AND s.status = 'excluded')) THEN
        RAISE EXCEPTION 'reply_query_thread: nothing has been corrected on the work order since the query' USING ERRCODE = 'check_violation';
      END IF;
      v_resolution := p_action;
    WHEN 'closed' THEN
      IF p_side <> v_thread.raised_by_side THEN
        RAISE EXCEPTION 'reply_query_thread: only the side that raised it closes it' USING ERRCODE = 'check_violation';
      END IF;
      v_resolution := 'closed';
    ELSE
      RAISE EXCEPTION 'reply_query_thread: unknown action %', p_action USING ERRCODE = 'check_violation';
  END CASE;

  INSERT INTO finance.query_comments (thread_id, side, body, action, tagged_user_id, tagged_label, author_id, author_label)
  VALUES (p_thread_id, p_side, v_body, p_action, p_tagged, p_tagged_label, p_actor, p_actor_label);

  IF v_resolution IS NULL THEN
    UPDATE finance.query_threads SET waiting_on = v_other, last_comment_at = now() WHERE id = p_thread_id;
    RETURN 'open';
  END IF;

  UPDATE finance.query_threads
  SET status = 'resolved', waiting_on = NULL, resolution = v_resolution, resolved_by = p_actor, resolved_by_label = p_actor_label,
      resolved_at = now(), last_comment_at = now()
  WHERE id = p_thread_id;

  /* The last open thread ended: the work order goes back to where it was (a hold with no reason left: in progress). */
  SELECT * INTO v_state FROM finance.work_order_states WHERE fsm_work_order_id = v_thread.fsm_work_order_id FOR UPDATE;
  IF FOUND AND v_state.status = 'query_raised'
     AND NOT EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.fsm_work_order_id = v_thread.fsm_work_order_id AND t.status = 'open') THEN
    v_to := CASE
      WHEN v_state.status_before_query = 'on_hold' AND v_state.hold_reason IS NULL THEN 'in_progress'
      ELSE coalesce(v_state.status_before_query, 'open')
    END;
    UPDATE finance.work_order_states
    SET status = v_to, status_before_query = NULL, query_text = NULL, status_changed_at = now(), updated_at = now()
    WHERE fsm_work_order_id = v_thread.fsm_work_order_id;
  END IF;
  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (v_thread.fsm_work_order_id, 'query_answered', v_state.status, coalesce(v_to, v_state.status), p_actor, p_actor_label,
          CASE v_resolution
            WHEN 'answered' THEN 'Resolved: '
            WHEN 'corrected' THEN 'Completion corrected: '
            WHEN 'withdrawn' THEN 'Request to invoice withdrawn: '
            ELSE 'Closed: ' END
          || coalesce(v_body, v_thread.subject));
  RETURN 'resolved';
END;
$$;
REVOKE ALL ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) TO service_role;

ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected',
  'progress_recorded',
  'fsm_completed', 'fsm_not_completed'));

ALTER TABLE finance.wo_exclusions DROP CONSTRAINT IF EXISTS wo_exclusions_sides_check;
ALTER TABLE finance.wo_exclusions DROP COLUMN IF EXISTS marked_by_side, DROP COLUMN IF EXISTS reverted_at, DROP COLUMN IF EXISTS reverted_by,
  DROP COLUMN IF EXISTS reverted_by_label, DROP COLUMN IF EXISTS reverted_by_side, DROP COLUMN IF EXISTS revert_note;

COMMIT;
NOTIFY pgrst, 'reload schema';
