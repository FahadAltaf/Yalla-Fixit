-- =====================================================================
-- Finance & Reports: queries as a comment thread (the user's direction,
-- 2 Nov). Replaces "raise a query / answer it" and "mark not invoiceable /
-- verify" with one thing both sides use:
--
--   Finance raises a query on a work order (a question, or "not
--   invoiceable"), and may tag someone in Operations. Operations replies,
--   and marks it resolved or not; Finance is told. The other way round,
--   Operations raises a question to Finance the same way.
--
--   "Not invoiceable" asks for an action, not an answer: Operations closes
--   it only by correcting the completion it recorded (a new Complete /
--   Partially complete entry after the query) or by withdrawing its
--   request to invoice. Finance, who raised it, may close it at any time.
--   There is no verification step any more.
--
--   finance.query_threads    one per query: work order, kind, which side
--                            raised it, whose turn it is, how it ended.
--   finance.query_comments   the thread, append-only: each comment, who
--                            wrote it, whom it tags, and what it did
--                            (raised, comment, not resolved, resolved,
--                            corrected, withdrawn, closed).
--
-- An open thread puts the work order in Query Raised, as before, so the
-- list, the counts and the digest stay right; it goes back to where it was
-- when its last open thread ends. Writes only through
-- finance.open_query_thread and finance.reply_query_thread (one
-- transaction each).
--
-- The queries and not-invoiceable requests made before this are copied in
-- (legacy_ref keeps it idempotent): each old query with its answer, the
-- open one still open; a not-invoiceable request still waiting becomes an
-- open question to Finance, and its "please verify" notices are resolved.
-- The old tables and functions stay, untouched, for the history.
--
-- Live-safe: two new tables and two functions in schema finance; rows
-- copied; a work order whose copied thread is open is put in Query Raised;
-- the stale "please verify" notices are resolved.
-- Nothing on main reads schema finance. Idempotent.
-- Apply with the checks in docs/finance-reporting/migrations/20261103100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261103100000_rollback.sql.
-- =====================================================================

CREATE TABLE IF NOT EXISTS finance.query_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fsm_work_order_id text NOT NULL,
  work_order_number text,
  kind text NOT NULL CHECK (kind IN ('question', 'not_invoiceable')),
  raised_by_side text NOT NULL CHECK (raised_by_side IN ('finance', 'operations')),
  /* The first comment, kept here for lists. */
  subject text NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 2000),
  /* The lines it is about; empty: the whole work order. */
  fsm_line_ids text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  /* Whose turn it is while open. */
  waiting_on text CHECK (waiting_on IN ('finance', 'operations')),
  resolution text CHECK (resolution IN ('answered', 'corrected', 'withdrawn', 'closed')),
  raised_by uuid,
  raised_by_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_comment_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid,
  resolved_by_label text,
  resolved_at timestamptz,
  /* The old query or request it was copied from. */
  legacy_ref text UNIQUE,
  CONSTRAINT query_threads_not_invoiceable_by_finance CHECK (kind <> 'not_invoiceable' OR raised_by_side = 'finance'),
  CONSTRAINT query_threads_open_waits CHECK ((status = 'open') = (waiting_on IS NOT NULL)),
  CONSTRAINT query_threads_resolved_complete CHECK (
    (status = 'resolved') = (resolution IS NOT NULL) AND (status = 'resolved') = (resolved_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_query_threads_work_order ON finance.query_threads (fsm_work_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_threads_status ON finance.query_threads (status, last_comment_at DESC);

CREATE TABLE IF NOT EXISTS finance.query_comments (
  id bigserial PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES finance.query_threads(id),
  side text NOT NULL CHECK (side IN ('finance', 'operations')),
  body text CHECK (body IS NULL OR length(body) BETWEEN 1 AND 2000),
  action text NOT NULL CHECK (action IN ('raised', 'comment', 'not_resolved', 'resolved', 'corrected', 'withdrawn', 'closed')),
  tagged_user_id uuid,
  tagged_label text,
  author_id uuid,
  author_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT query_comments_body_needed CHECK (body IS NOT NULL OR action IN ('corrected', 'withdrawn', 'closed'))
);
CREATE INDEX IF NOT EXISTS idx_query_comments_thread ON finance.query_comments (thread_id, created_at);

DROP TRIGGER IF EXISTS query_comments_append_only ON finance.query_comments;
CREATE TRIGGER query_comments_append_only BEFORE UPDATE OR DELETE ON finance.query_comments
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS query_comments_append_only_truncate ON finance.query_comments;
CREATE TRIGGER query_comments_append_only_truncate BEFORE TRUNCATE ON finance.query_comments
  FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only();

/* ---------------------------------------------------------------------
   Raise a query. Returns the thread's id.
   --------------------------------------------------------------------- */
CREATE OR REPLACE FUNCTION finance.open_query_thread(
  p_work_order_id text, p_work_order_number text, p_kind text, p_side text, p_body text, p_lines text[],
  p_tagged uuid, p_tagged_label text, p_actor uuid, p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_id uuid;
  v_state finance.work_order_states%ROWTYPE;
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_other text := CASE p_side WHEN 'finance' THEN 'operations' ELSE 'finance' END;
BEGIN
  IF coalesce(p_work_order_id, '') = '' THEN
    RAISE EXCEPTION 'open_query_thread: no work order' USING ERRCODE = 'check_violation';
  END IF;
  IF p_side NOT IN ('finance', 'operations') THEN
    RAISE EXCEPTION 'open_query_thread: say which side is asking' USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind NOT IN ('question', 'not_invoiceable') THEN
    RAISE EXCEPTION 'open_query_thread: unknown kind %', p_kind USING ERRCODE = 'check_violation';
  END IF;
  IF p_kind = 'not_invoiceable' AND p_side <> 'finance' THEN
    RAISE EXCEPTION 'open_query_thread: only Finance says a work order is not invoiceable' USING ERRCODE = 'check_violation';
  END IF;
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'open_query_thread: write the query' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.work_order_states (fsm_work_order_id, work_order_number) VALUES (p_work_order_id, nullif(p_work_order_number, ''))
  ON CONFLICT (fsm_work_order_id) DO UPDATE SET work_order_number = coalesce(excluded.work_order_number, work_order_states.work_order_number);
  SELECT * INTO v_state FROM finance.work_order_states WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF v_state.status = 'excluded' THEN
    RAISE EXCEPTION 'open_query_thread: the work order is marked not to be invoiced' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.query_threads (fsm_work_order_id, work_order_number, kind, raised_by_side, subject, fsm_line_ids,
                                     waiting_on, raised_by, raised_by_label)
  VALUES (p_work_order_id, coalesce(nullif(p_work_order_number, ''), v_state.work_order_number), p_kind, p_side, v_body,
          coalesce(p_lines, '{}'), v_other, p_actor, p_actor_label)
  RETURNING id INTO v_id;
  INSERT INTO finance.query_comments (thread_id, side, body, action, tagged_user_id, tagged_label, author_id, author_label)
  VALUES (v_id, p_side, v_body, 'raised', p_tagged, p_tagged_label, p_actor, p_actor_label);

  /* The work order shows Query Raised while any thread on it is open. */
  IF v_state.status IN ('open', 'in_progress', 'on_hold') THEN
    UPDATE finance.work_order_states
    SET status = 'query_raised', status_before_query = v_state.status, query_text = v_body, status_changed_at = now(), updated_at = now()
    WHERE fsm_work_order_id = p_work_order_id;
  END IF;
  INSERT INTO finance.line_events (fsm_work_order_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_work_order_id, 'query_raised', v_state.status,
          CASE WHEN v_state.status IN ('open', 'in_progress', 'on_hold') THEN 'query_raised' ELSE v_state.status END,
          p_actor, p_actor_label,
          CASE WHEN p_kind = 'not_invoiceable' THEN 'Finance: not invoiceable. '
               WHEN p_side = 'finance' THEN 'Finance asks: ' ELSE 'Operations asks: ' END || v_body);
  RETURN v_id;
END;
$$;

/* ---------------------------------------------------------------------
   Reply on a thread. p_action:
     comment        a comment; the other side's turn.
     not_resolved   the side asked replies that it is not resolved (with why).
     resolved       the side asked answers a question and resolves it.
     corrected      Operations corrected the completion it recorded (a not-
                    invoiceable query): only with a new completion entry
                    on the work order since the query.
     withdrawn      Operations withdrew its request to invoice (done by the
                    server just before: a completion entry or the exclusion).
     closed         the side that raised it closes it.
   Returns the thread's status.
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

/* ---------------------------------------------------------------------
   The queries and requests made before this, copied in.
   --------------------------------------------------------------------- */

/* Each old query, with the next answer on the same work order before the next query. */
WITH raised AS (
  SELECT e.*, lead(e.created_at) OVER (PARTITION BY e.fsm_work_order_id ORDER BY e.created_at, e.id) AS next_raised_at
  FROM finance.line_events e
  WHERE e.event_type = 'query_raised'
    AND NOT EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.legacy_ref = 'query-event:' || e.id)
    /* Run again later: not the events the threads write themselves. */
    AND e.created_at < coalesce((SELECT min(t.created_at) FROM finance.query_threads t WHERE t.legacy_ref IS NULL), 'infinity')
),
paired AS (
  SELECT r.*, a.id AS answer_id, a.note AS answer_note, a.actor_id AS answer_by, a.actor_label AS answer_by_label, a.created_at AS answered_at
  FROM raised r
  LEFT JOIN LATERAL (
    SELECT x.* FROM finance.line_events x
    WHERE x.fsm_work_order_id = r.fsm_work_order_id AND x.event_type = 'query_answered' AND x.created_at >= r.created_at
      AND (r.next_raised_at IS NULL OR x.created_at < r.next_raised_at)
    ORDER BY x.created_at, x.id LIMIT 1
  ) a ON true
),
copied AS (
  INSERT INTO finance.query_threads (fsm_work_order_id, work_order_number, kind, raised_by_side, subject, status, waiting_on, resolution,
                                     raised_by, raised_by_label, created_at, last_comment_at, resolved_by, resolved_by_label, resolved_at, legacy_ref)
  SELECT p.fsm_work_order_id, s.work_order_number, 'question', 'finance', coalesce(nullif(trim(p.note), ''), 'No question recorded'),
         CASE WHEN p.answer_id IS NULL THEN 'open' ELSE 'resolved' END,
         CASE WHEN p.answer_id IS NULL THEN 'operations' END,
         CASE WHEN p.answer_id IS NULL THEN NULL ELSE 'answered' END,
         p.actor_id, p.actor_label, p.created_at, coalesce(p.answered_at, p.created_at),
         p.answer_by, p.answer_by_label, p.answered_at, 'query-event:' || p.id
  FROM paired p
  LEFT JOIN finance.work_order_states s ON s.fsm_work_order_id = p.fsm_work_order_id
  RETURNING id, legacy_ref
)
INSERT INTO finance.query_comments (thread_id, side, body, action, author_id, author_label, created_at)
SELECT c.id, v.side, v.body, v.action, v.author_id, v.author_label, v.created_at
FROM copied c
JOIN paired p ON 'query-event:' || p.id = c.legacy_ref
CROSS JOIN LATERAL (
  VALUES ('finance', coalesce(nullif(trim(p.note), ''), 'No question recorded'), 'raised', p.actor_id, p.actor_label, p.created_at),
         ('operations', coalesce(nullif(trim(p.answer_note), ''), 'Answered'), 'resolved', p.answer_by, p.answer_by_label, p.answered_at)
) AS v(side, body, action, author_id, author_label, created_at)
WHERE v.action = 'raised' OR p.answer_id IS NOT NULL;

/* A not-invoiceable request still waiting: now an open question to Finance. */
WITH waiting AS (
  SELECT x.* FROM finance.wo_exclusions x
  WHERE x.decision IS NULL
    AND NOT EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.legacy_ref = 'exclusion:' || x.id)
),
copied AS (
  INSERT INTO finance.query_threads (fsm_work_order_id, work_order_number, kind, raised_by_side, subject, waiting_on,
                                     raised_by, raised_by_label, created_at, last_comment_at, legacy_ref)
  SELECT w.fsm_work_order_id, w.work_order_number, 'question', 'operations',
         left('Not to be invoiced: ' || w.reason || coalesce(' (' || nullif(trim(w.notes), '') || ')', ''), 2000),
         'finance', w.requested_by, w.requested_by_label, w.requested_at, w.requested_at, 'exclusion:' || w.id
  FROM waiting w
  RETURNING id, subject, raised_by, raised_by_label, created_at
)
INSERT INTO finance.query_comments (thread_id, side, body, action, author_id, author_label, created_at)
SELECT id, 'operations', subject, 'raised', raised_by, raised_by_label, created_at FROM copied;

/* A work order with a copied thread still open shows Query Raised, as a new one would. */
UPDATE finance.work_order_states s
SET status_before_query = s.status, status = 'query_raised',
    query_text = (SELECT t.subject FROM finance.query_threads t WHERE t.fsm_work_order_id = s.fsm_work_order_id AND t.status = 'open'
                  ORDER BY t.created_at DESC LIMIT 1),
    status_changed_at = now(), updated_at = now()
WHERE s.status IN ('open', 'in_progress', 'on_hold')
  AND EXISTS (SELECT 1 FROM finance.query_threads t WHERE t.fsm_work_order_id = s.fsm_work_order_id AND t.status = 'open');

/* Their "please verify" notices: there is nothing left to verify. */
UPDATE public.portal_notifications SET resolved_at = now()
WHERE event = 'finance.exclusion_requested' AND resolved_at IS NULL;

/* ---------------------------------------------------------------------
   Server-only
   --------------------------------------------------------------------- */
ALTER TABLE finance.query_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.query_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON finance.query_threads, finance.query_comments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE finance.query_comments_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.open_query_thread(text, text, text, text, text, text[], uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT SELECT ON finance.query_threads, finance.query_comments TO service_role;
GRANT EXECUTE ON FUNCTION finance.open_query_thread(text, text, text, text, text, text[], uuid, text, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION finance.reply_query_thread(uuid, text, text, text, uuid, text, uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
