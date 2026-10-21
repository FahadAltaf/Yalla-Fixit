-- =====================================================================
-- Finance & Reports P4 fix: a query raised while an item is On Hold.
--
-- Found in the P4 browser test (21 Oct 2026): put an item On Hold, raise a
-- query, answer it. finance.apply_action cleared the hold reason when the
-- query was raised, so the answer tried to return the item to On Hold with
-- no reason, and the queue_items_hold_has_reason rule refused it. Nothing
-- was ever corrupted: the refusal left the item as it was.
--
-- This replaces finance.apply_action with one change: the hold reason is
-- kept while the item's status is On Hold or Query Raised. Everything else
-- is as in 20261021100000. Live-safe (one function in the finance schema;
-- live main does not use it). Idempotent.
--
-- Post-check: the harness test "a query raised while on hold is answered
-- back to On Hold" (checks/40_p3_finance_core.sql); on production, expect
-- `t` from:
--   select prosrc like '%(''on_hold'', ''query_raised'') THEN hold_reason%'
--   from pg_proc where oid = 'finance.apply_action(uuid,text,text,uuid,text,text)'::regprocedure;
-- Rollback: re-run the apply_action definition from 20261021100000.
-- =====================================================================

CREATE OR REPLACE FUNCTION finance.apply_action(
  p_item_id uuid, p_action text, p_expected text, p_actor uuid, p_actor_label text, p_note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_item finance.queue_items%ROWTYPE;
  v_to text;
  v_event text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  SELECT * INTO v_item FROM finance.queue_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'apply_action: no item %', p_item_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_item.status <> p_expected THEN
    RAISE EXCEPTION 'apply_action: the item is % now, not %', v_item.status, p_expected USING ERRCODE = 'serialization_failure';
  END IF;

  CASE p_action
    WHEN 'pick_up' THEN
      IF v_item.status <> 'pending' THEN RAISE EXCEPTION 'apply_action: only a pending item can be picked up' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'in_progress'; v_event := 'picked_up';
    WHEN 'release' THEN
      IF v_item.status <> 'in_progress' THEN RAISE EXCEPTION 'apply_action: only an item in progress can be released' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'pending'; v_event := 'released';
    WHEN 'raise_query' THEN
      IF v_item.status NOT IN ('pending', 'in_progress', 'on_hold') THEN RAISE EXCEPTION 'apply_action: a query cannot be raised on a % item', v_item.status USING ERRCODE = 'check_violation'; END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'apply_action: a query needs its question' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'query_raised'; v_event := 'query_raised';
    WHEN 'answer_query' THEN
      IF v_item.status <> 'query_raised' THEN RAISE EXCEPTION 'apply_action: there is no open query' USING ERRCODE = 'check_violation'; END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'apply_action: an answer needs its text' USING ERRCODE = 'check_violation'; END IF;
      v_to := coalesce(v_item.status_before_query, 'pending'); v_event := 'query_answered';
    WHEN 'put_on_hold' THEN
      IF v_item.status NOT IN ('pending', 'in_progress') THEN RAISE EXCEPTION 'apply_action: a % item cannot be put on hold', v_item.status USING ERRCODE = 'check_violation'; END IF;
      IF v_note IS NULL THEN RAISE EXCEPTION 'apply_action: putting on hold needs a reason' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'on_hold'; v_event := 'put_on_hold';
    WHEN 'resume' THEN
      IF v_item.status <> 'on_hold' THEN RAISE EXCEPTION 'apply_action: only an item on hold can be resumed' USING ERRCODE = 'check_violation'; END IF;
      v_to := 'in_progress'; v_event := 'resumed';
    ELSE
      RAISE EXCEPTION 'apply_action: unknown action %', p_action USING ERRCODE = 'check_violation';
  END CASE;

  UPDATE finance.queue_items SET
    status = v_to,
    status_changed_at = now(),
    updated_at = now(),
    assignee_id = CASE p_action WHEN 'pick_up' THEN p_actor WHEN 'resume' THEN coalesce(assignee_id, p_actor)
                                WHEN 'release' THEN NULL ELSE assignee_id END,
    status_before_query = CASE WHEN p_action = 'raise_query' THEN v_item.status ELSE NULL END,
    query_text = CASE WHEN p_action = 'raise_query' THEN v_note WHEN p_action = 'answer_query' THEN NULL ELSE query_text END,
    /* Kept while a query raised from On Hold is open, so answering it
       returns the item to On Hold with its reason (the bug this fixes). */
    hold_reason = CASE WHEN p_action = 'put_on_hold' THEN v_note
                       WHEN v_to IN ('on_hold', 'query_raised') THEN hold_reason ELSE NULL END
  WHERE id = p_item_id;

  INSERT INTO finance.queue_events (queue_item_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_item_id, v_event, v_item.status, v_to, p_actor, p_actor_label, v_note);
  RETURN v_to;
END;
$$;

REVOKE ALL ON FUNCTION finance.apply_action(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION finance.apply_action(uuid, text, text, uuid, text, text) TO service_role;
