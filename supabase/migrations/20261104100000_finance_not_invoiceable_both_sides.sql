-- 20261104100000_finance_not_invoiceable_both_sides
--
-- Not invoiceable, from either side, and back (the user's direction, 2 Nov):
-- Finance or Operations marks a work order not invoiceable at once, and the
-- other side is told who did it; either side marks it invoiceable again once
-- things change. Queries are questions only, as a conversation: either side
-- replies, either side closes it. No resolved / not resolved, no verification.
--
--   finance.wo_exclusions      + marked_by_side, reverted_at / _by / _by_label / _by_side, revert_note
--   finance.line_events        event type + 'exclusion_reverted'
--   finance.mark_not_invoiceable(...)   one transaction: the mark, the status, the history
--   finance.mark_invoiceable(...)       one transaction: back to open (or in a query), the history
--   finance.reply_query_thread(...)     replaced: 'comment' or 'closed', either side
--
-- Live-safe: nullable columns, a wider check, functions in schema finance (nothing on main reads it).
-- Idempotent. Post-check in docs/finance-reporting/migrations/20261104100000.md.

BEGIN;

ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS marked_by_side text;
ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS reverted_at timestamptz;
ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS reverted_by uuid;
ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS reverted_by_label text;
ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS reverted_by_side text;
ALTER TABLE finance.wo_exclusions ADD COLUMN IF NOT EXISTS revert_note text;
ALTER TABLE finance.wo_exclusions DROP CONSTRAINT IF EXISTS wo_exclusions_sides_check;
ALTER TABLE finance.wo_exclusions ADD CONSTRAINT wo_exclusions_sides_check CHECK (
  (marked_by_side IS NULL OR marked_by_side IN ('finance', 'operations'))
  AND (reverted_by_side IS NULL OR reverted_by_side IN ('finance', 'operations')));

ALTER TABLE finance.line_events DROP CONSTRAINT IF EXISTS line_events_event_type_check;
ALTER TABLE finance.line_events ADD CONSTRAINT line_events_event_type_check CHECK (event_type IN (
  'marked_ready', 'unmarked_ready', 'invoiced',
  'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
  'exclusion_requested', 'exclusion_verified', 'exclusion_rejected', 'exclusion_reverted',
  'progress_recorded',
  'fsm_completed', 'fsm_not_completed'));

/* ---------------------------------------------------------------------
   Mark a work order not invoiceable: Finance or Operations, at once.
   Refused once any of it is invoiced. A request still waiting from before
   (the old verification step) is closed by this mark.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.mark_not_invoiceable(
  p_work_order_id text, p_work_order_number text, p_side text, p_reason text, p_notes text, p_evidence text[],
  p_actor uuid, p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_from text;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
BEGIN
  IF p_side NOT IN ('finance', 'operations') THEN
    RAISE EXCEPTION 'mark_not_invoiceable: say which side is marking it' USING ERRCODE = 'check_violation';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'mark_not_invoiceable: Give the reason it is not invoiceable.' USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO finance.work_order_states (fsm_work_order_id, work_order_number) VALUES (p_work_order_id, nullif(p_work_order_number, ''))
  ON CONFLICT (fsm_work_order_id) DO UPDATE SET work_order_number = coalesce(excluded.work_order_number, work_order_states.work_order_number);
  SELECT status INTO v_from FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF v_from = 'excluded' THEN
    RAISE EXCEPTION 'mark_not_invoiceable: It is already marked not invoiceable. Reload to see the latest.' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.line_states s WHERE s.fsm_work_order_id = p_work_order_id AND s.invoiced_amount > 0) THEN
    RAISE EXCEPTION 'mark_not_invoiceable: Part of this work order is already invoiced, so it cannot be marked not invoiceable.'
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE finance.wo_exclusions
  SET decision = 'rejected', decision_note = 'Replaced by a mark not invoiceable', decided_by = p_actor,
      decided_by_label = p_actor_label, decided_at = now()
  WHERE fsm_work_order_id = p_work_order_id AND decision IS NULL;

  INSERT INTO finance.wo_exclusions (fsm_work_order_id, work_order_number, reason, notes, evidence, requested_by, requested_by_label,
                                     decision, decided_by, decided_by_label, decided_at, marked_by_side)
  VALUES (p_work_order_id, nullif(p_work_order_number, ''), v_reason, nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_evidence, '{}'),
          p_actor, p_actor_label, 'verified', p_actor, p_actor_label, now(), p_side)
  RETURNING id INTO v_id;

  UPDATE finance.work_order_states
  SET status = 'excluded', status_changed_at = now(), assignee_id = NULL, assignee_label = NULL, updated_at = now()
  WHERE fsm_work_order_id = p_work_order_id;

  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_work_order_id, 'exclusion_verified', v_from, 'excluded', p_actor, p_actor_label,
          CASE p_side WHEN 'finance' THEN 'Finance: ' ELSE 'Operations: ' END || v_reason);
  RETURN v_id;
END;
$$;

/* ---------------------------------------------------------------------
   Mark it invoiceable again: Finance or Operations. Back to Open (In
   Progress when some of it was invoiced before), or to Query Raised while
   a query on it is still open.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.mark_invoiceable(
  p_work_order_id text, p_side text, p_note text, p_actor uuid, p_actor_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_from text;
  v_base text;
  v_to text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF p_side NOT IN ('finance', 'operations') THEN
    RAISE EXCEPTION 'mark_invoiceable: say which side is marking it' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_from FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF v_from IS DISTINCT FROM 'excluded' THEN
    RAISE EXCEPTION 'mark_invoiceable: It is not marked not invoiceable. Reload to see the latest.' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE finance.wo_exclusions
  SET reverted_at = now(), reverted_by = p_actor, reverted_by_label = p_actor_label, reverted_by_side = p_side, revert_note = v_note
  WHERE fsm_work_order_id = p_work_order_id AND decision = 'verified' AND reverted_at IS NULL;

  v_base := CASE WHEN EXISTS (SELECT 1 FROM finance.line_states s WHERE s.fsm_work_order_id = p_work_order_id AND s.invoiced_amount > 0)
                 THEN 'in_progress' ELSE 'open' END;
  v_to := CASE WHEN EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.fsm_work_order_id = p_work_order_id AND t.status = 'open')
               THEN 'query_raised' ELSE v_base END;
  UPDATE finance.work_order_states
  SET status = v_to, status_before_query = CASE WHEN v_to = 'query_raised' THEN v_base ELSE NULL END,
      status_changed_at = now(), updated_at = now()
  WHERE fsm_work_order_id = p_work_order_id;

  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_work_order_id, 'exclusion_reverted', 'excluded', v_to, p_actor, p_actor_label,
          CASE p_side WHEN 'finance' THEN 'Finance' ELSE 'Operations' END || ' marked it invoiceable' || coalesce(': ' || v_note, ''));
  RETURN v_to;
END;
$$;

/* ---------------------------------------------------------------------
   A reply on a query: a comment (the other side's turn), or closing the
   conversation. Either side may close it. Returns the thread's status.
   --------------------------------------------------------------------- */
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
  v_to text;
BEGIN
  IF p_side NOT IN ('finance', 'operations') THEN
    RAISE EXCEPTION 'reply_query_thread: say which side is replying' USING ERRCODE = 'check_violation';
  END IF;
  IF p_action NOT IN ('comment', 'closed') THEN
    RAISE EXCEPTION 'reply_query_thread: reply or close' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_thread FROM finance.query_threads WHERE id = p_thread_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reply_query_thread: no query %', p_thread_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_thread.status <> 'open' THEN
    RAISE EXCEPTION 'reply_query_thread: the query is already closed' USING ERRCODE = 'check_violation';
  END IF;
  IF p_action = 'comment' AND v_body IS NULL THEN
    RAISE EXCEPTION 'reply_query_thread: write the reply' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.query_comments (thread_id, side, body, action, tagged_user_id, tagged_label, author_id, author_label)
  VALUES (p_thread_id, p_side, v_body, p_action, p_tagged, p_tagged_label, p_actor, p_actor_label);

  IF p_action = 'comment' THEN
    UPDATE finance.query_threads SET waiting_on = v_other, last_comment_at = now() WHERE id = p_thread_id;
    RETURN 'open';
  END IF;

  UPDATE finance.query_threads
  SET status = 'resolved', waiting_on = NULL, resolution = 'closed', resolved_by = p_actor, resolved_by_label = p_actor_label,
      resolved_at = now(), last_comment_at = now()
  WHERE id = p_thread_id;

  /* The last open query ended: the work order goes back to where it was (a hold with no reason left: in progress). */
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
          'Closed: ' || coalesce(v_body, v_thread.subject));
  RETURN 'resolved';
END;
$$;

REVOKE ALL ON FUNCTION finance.mark_not_invoiceable(text, text, text, text, text, text[], uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.mark_invoiceable(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.mark_not_invoiceable(text, text, text, text, text, text[], uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.mark_invoiceable(text, text, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
