-- =====================================================================
-- Finance & Reports P3: the invoicing core (BRD §5.1; DEV-434, 437, 438, 440).
--
-- Schema `finance` (decided 20 Oct), apart from the portal's tables in
-- `public`, granted to the server role only, like `fsm`:
--
--   finance.queue_items       one Ready-to-Invoice item: a set of completed
--                             FSM lines from one work order (Step 2)
--   finance.queue_item_lines  the lines of each item. UNIQUE (fsm_line_id):
--                             a line belongs to one item, ever, so it can
--                             never be presented or invoiced twice
--   finance.invoices          the MAHER invoice recorded on an item
--                             (Step 7). Append-only
--   finance.exclusions        "not to be invoiced" requests and Behrouz's
--                             decision (Step 5)
--   finance.queue_events      every change, with actor and time. Append-
--                             only; the source of the Step 8 metrics
--   finance.estimate_progress cumulative invoiced, remaining and completion
--                             per quotation: computed, never typed (Step 2)
--
-- Every state change goes through one function, in one transaction, with
-- the item locked and the status the user last saw checked, so two people
-- acting at once cannot both succeed and a failure part-way leaves nothing
-- changed. Recording an invoice is idempotent on a key the browser sends.
--
-- Not here, on purpose: what CREATES items. The trigger (DEV-433) waits on
-- D-01..D-03 (what "completed" means, the flag, how a second batch starts).
-- finance.create_queue_item takes the lines explicitly, so the trigger can
-- be wired to it without changing this model.
--
-- Assumptions pending D-05 (stated, configurable later): an item's value
-- is the sum of its lines' FSM `Amount` (after discount, before tax); the
-- completion % divides by the quotation's pre-tax `Sub_Total`. Both FSM
-- amounts are kept on each line so the basis can change without loss.
--
-- Live-safe: a new schema; live main reads nothing in it. Idempotent.
-- After applying: add `finance` to Exposed schemas (Project Settings > API).
--
-- Checks: docs/finance-reporting/migrations/20261021100000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261021100000_rollback.sql.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS finance;
COMMENT ON SCHEMA finance IS
  'Finance & Reports: the Ready-to-Invoice queue (BRD 5.1). Changed only through the finance.* functions.';

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS finance.queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* A short number people can say on the phone: FQ-1001. */
  number bigint GENERATED ALWAYS AS IDENTITY (START WITH 1001) UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'query_raised', 'on_hold', 'excluded', 'invoiced')),
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  /* Where a raised query returns to once answered. */
  status_before_query text CHECK (status_before_query IN ('pending', 'in_progress', 'on_hold')),
  fsm_work_order_id text NOT NULL,
  fsm_estimate_id text,
  /* Snapshots at creation: what Finance was shown, whatever FSM does later. */
  value numeric(14,2) NOT NULL CHECK (value >= 0),
  quotation_total numeric(14,2),
  line_count integer NOT NULL CHECK (line_count > 0),
  /* What made it (the trigger's key, or a manual creation's). Unique, so a
     replayed sync or a retried request never makes a second item. */
  trigger_key text NOT NULL UNIQUE CHECK (length(trigger_key) BETWEEN 1 AND 300),
  created_by text NOT NULL DEFAULT 'sync',
  assignee_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  hold_reason text,
  query_text text,
  entered_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT queue_items_hold_has_reason CHECK (status <> 'on_hold' OR hold_reason IS NOT NULL),
  CONSTRAINT queue_items_query_has_text CHECK (status <> 'query_raised' OR query_text IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_queue_items_status ON finance.queue_items (status, status_changed_at);
CREATE INDEX IF NOT EXISTS idx_queue_items_estimate ON finance.queue_items (fsm_estimate_id) WHERE fsm_estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_items_work_order ON finance.queue_items (fsm_work_order_id);
CREATE INDEX IF NOT EXISTS idx_queue_items_assignee ON finance.queue_items (assignee_id)
  WHERE status IN ('pending', 'in_progress', 'query_raised', 'on_hold');

CREATE TABLE IF NOT EXISTS finance.queue_item_lines (
  queue_item_id uuid NOT NULL REFERENCES finance.queue_items(id) ON DELETE RESTRICT,
  /* One item per line, ever: the rule that stops double invoicing. */
  fsm_line_id text NOT NULL UNIQUE,
  name text,
  quantity numeric(12,3),
  unit_price numeric(14,2),
  /* Both FSM amounts, as they were when the item was made (D-05). */
  line_amount numeric(14,2),
  amount numeric(14,2) NOT NULL,
  sequence integer,
  PRIMARY KEY (queue_item_id, fsm_line_id)
);

CREATE TABLE IF NOT EXISTS finance.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id uuid NOT NULL UNIQUE REFERENCES finance.queue_items(id) ON DELETE RESTRICT,
  maher_invoice_number text NOT NULL CHECK (length(trim(maher_invoice_number)) BETWEEN 1 AND 60),
  invoice_date date NOT NULL,
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  /* The item's value when recorded; the variance is derived, never typed. */
  queue_value numeric(14,2) NOT NULL,
  variance numeric(14,2) GENERATED ALWAYS AS (amount - queue_value) STORED,
  variance_reason text,
  idempotency_key text NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 8 AND 100),
  recorded_by uuid,
  recorded_by_label text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invoices_variance_has_reason
    CHECK (amount = queue_value OR (variance_reason IS NOT NULL AND length(trim(variance_reason)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_invoices_recorded ON finance.invoices (recorded_at);

CREATE TABLE IF NOT EXISTS finance.exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_item_id uuid NOT NULL REFERENCES finance.queue_items(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 1 AND 200),
  notes text,
  /* Storage paths of the supporting evidence (Step 5). */
  evidence text[] NOT NULL DEFAULT '{}',
  requested_by uuid,
  requested_by_label text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decision text CHECK (decision IN ('verified', 'rejected')),
  decision_note text,
  decided_by uuid,
  decided_by_label text,
  decided_at timestamptz,
  CONSTRAINT exclusions_decision_complete CHECK ((decision IS NULL) = (decided_at IS NULL)),
  CONSTRAINT exclusions_rejection_has_note CHECK (decision IS DISTINCT FROM 'rejected' OR decision_note IS NOT NULL)
);
/* At most one open request per item. */
CREATE UNIQUE INDEX IF NOT EXISTS idx_exclusions_open ON finance.exclusions (queue_item_id) WHERE decision IS NULL;

CREATE TABLE IF NOT EXISTS finance.queue_events (
  id bigserial PRIMARY KEY,
  queue_item_id uuid NOT NULL REFERENCES finance.queue_items(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'picked_up', 'released', 'query_raised', 'query_answered', 'put_on_hold', 'resumed',
    'exclusion_requested', 'exclusion_verified', 'exclusion_rejected', 'invoiced')),
  from_status text,
  to_status text,
  /* Not foreign keys: a user's deletion must not block, or erase, history. */
  actor_id uuid,
  actor_label text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_queue_events_item ON finance.queue_events (queue_item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_queue_events_type ON finance.queue_events (event_type, created_at);

-- ---------------------------------------------------------------------
-- Append-only: invoices and events (and lines, once made)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION finance.append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = finance, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'raise_exception';
END;
$$;

DROP TRIGGER IF EXISTS invoices_append_only ON finance.invoices;
CREATE TRIGGER invoices_append_only BEFORE UPDATE OR DELETE ON finance.invoices
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS invoices_append_only_truncate ON finance.invoices;
CREATE TRIGGER invoices_append_only_truncate BEFORE TRUNCATE ON finance.invoices
  FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS queue_events_append_only ON finance.queue_events;
CREATE TRIGGER queue_events_append_only BEFORE UPDATE OR DELETE ON finance.queue_events
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS queue_events_append_only_truncate ON finance.queue_events;
CREATE TRIGGER queue_events_append_only_truncate BEFORE TRUNCATE ON finance.queue_events
  FOR EACH STATEMENT EXECUTE FUNCTION finance.append_only();
DROP TRIGGER IF EXISTS queue_item_lines_append_only ON finance.queue_item_lines;
CREATE TRIGGER queue_item_lines_append_only BEFORE UPDATE OR DELETE ON finance.queue_item_lines
  FOR EACH ROW EXECUTE FUNCTION finance.append_only();

-- ---------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------

/* Make an item from completed, unclaimed lines of one work order. Returns
   the item; the same trigger_key again returns the item it already made. */
CREATE OR REPLACE FUNCTION finance.create_queue_item(
  p_trigger_key text, p_work_order_id text, p_line_ids text[], p_created_by text DEFAULT 'sync')
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_existing uuid;
  v_item uuid;
  v_estimate text;
  v_total numeric(14,2);
  v_value numeric(14,2);
  v_count integer;
  v_wanted integer;
BEGIN
  SELECT id INTO v_existing FROM finance.queue_items WHERE trigger_key = p_trigger_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  v_wanted := coalesce(array_length(p_line_ids, 1), 0);
  IF v_wanted = 0 THEN
    RAISE EXCEPTION 'create_queue_item: no lines' USING ERRCODE = 'check_violation';
  END IF;
  IF (SELECT count(DISTINCT x) FROM unnest(p_line_ids) AS x) <> v_wanted THEN
    RAISE EXCEPTION 'create_queue_item: a line is listed twice' USING ERRCODE = 'check_violation';
  END IF;

  /* Every line: on this work order, still there, Completed, and in no item. */
  SELECT count(*), coalesce(sum(l.amount), 0) INTO v_count, v_value
  FROM fsm.line_items l
  WHERE l.fsm_line_id = ANY (p_line_ids)
    AND l.fsm_work_order_id = p_work_order_id
    AND l.removed_at IS NULL
    AND l.status = 'Completed'
    AND l.amount IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM finance.queue_item_lines q WHERE q.fsm_line_id = l.fsm_line_id);
  IF v_count <> v_wanted THEN
    RAISE EXCEPTION 'create_queue_item: % of % lines are not completed, unclaimed lines of work order %',
      v_wanted - v_count, v_wanted, p_work_order_id USING ERRCODE = 'check_violation';
  END IF;

  SELECT w.fsm_estimate_id INTO v_estimate FROM fsm.work_orders w WHERE w.fsm_work_order_id = p_work_order_id;
  SELECT e.sub_total INTO v_total FROM fsm.estimates e WHERE e.fsm_estimate_id = v_estimate;

  INSERT INTO finance.queue_items (fsm_work_order_id, fsm_estimate_id, value, quotation_total, line_count,
                                   trigger_key, created_by)
  VALUES (p_work_order_id, v_estimate, v_value, v_total, v_count, p_trigger_key, p_created_by)
  RETURNING id INTO v_item;

  /* The UNIQUE (fsm_line_id) is the final word if two creations race. */
  INSERT INTO finance.queue_item_lines (queue_item_id, fsm_line_id, name, quantity, unit_price, line_amount, amount, sequence)
  SELECT v_item, l.fsm_line_id, l.name, l.quantity, l.unit_price, l.line_amount, l.amount, l.sequence
  FROM fsm.line_items l WHERE l.fsm_line_id = ANY (p_line_ids);

  INSERT INTO finance.queue_events (queue_item_id, event_type, to_status, actor_label, note)
  VALUES (v_item, 'created', 'pending', p_created_by, v_count || ' line(s)');
  RETURN v_item;
END;
$$;

/* Finance's actions (Step 4). p_expected is the status the user saw; if it
   has moved on, nothing changes and the caller is told. */
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
    hold_reason = CASE WHEN p_action = 'put_on_hold' THEN v_note
                       WHEN v_to = 'on_hold' THEN hold_reason ELSE NULL END
  WHERE id = p_item_id;

  INSERT INTO finance.queue_events (queue_item_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_item_id, v_event, v_item.status, v_to, p_actor, p_actor_label, v_note);
  RETURN v_to;
END;
$$;

/* The coordinator asks for an item not to be invoiced (Step 5). The item
   keeps its status until Behrouz decides. */
CREATE OR REPLACE FUNCTION finance.request_exclusion(
  p_item_id uuid, p_reason text, p_notes text, p_evidence text[], p_actor uuid, p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_status text;
  v_id uuid;
BEGIN
  SELECT status INTO v_status FROM finance.queue_items WHERE id = p_item_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'request_exclusion: no item %', p_item_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_status IN ('excluded', 'invoiced') THEN
    RAISE EXCEPTION 'request_exclusion: the item is already %', v_status USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO finance.exclusions (queue_item_id, reason, notes, evidence, requested_by, requested_by_label)
  VALUES (p_item_id, trim(p_reason), nullif(trim(coalesce(p_notes, '')), ''), coalesce(p_evidence, '{}'), p_actor, p_actor_label)
  RETURNING id INTO v_id;
  INSERT INTO finance.queue_events (queue_item_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_item_id, 'exclusion_requested', v_status, v_status, p_actor, p_actor_label, trim(p_reason));
  RETURN v_id;
END;
$$;

/* Behrouz decides (§6.8): verified -> Excluded; rejected -> back to Pending
   with a note. */
CREATE OR REPLACE FUNCTION finance.decide_exclusion(
  p_exclusion_id uuid, p_decision text, p_note text, p_actor uuid, p_actor_label text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_ex finance.exclusions%ROWTYPE;
  v_status text;
  v_to text;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
BEGIN
  IF p_decision NOT IN ('verified', 'rejected') THEN
    RAISE EXCEPTION 'decide_exclusion: unknown decision %', p_decision USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO v_ex FROM finance.exclusions WHERE id = p_exclusion_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'decide_exclusion: no request %', p_exclusion_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_ex.decision IS NOT NULL THEN
    RAISE EXCEPTION 'decide_exclusion: already %', v_ex.decision USING ERRCODE = 'serialization_failure';
  END IF;
  IF p_decision = 'rejected' AND v_note IS NULL THEN
    RAISE EXCEPTION 'decide_exclusion: a rejection needs a note' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO v_status FROM finance.queue_items WHERE id = v_ex.queue_item_id FOR UPDATE;
  IF v_status IN ('excluded', 'invoiced') THEN
    RAISE EXCEPTION 'decide_exclusion: the item is already %', v_status USING ERRCODE = 'check_violation';
  END IF;

  v_to := CASE p_decision WHEN 'verified' THEN 'excluded' ELSE 'pending' END;
  UPDATE finance.exclusions SET decision = p_decision, decision_note = v_note, decided_by = p_actor,
    decided_by_label = p_actor_label, decided_at = now()
  WHERE id = p_exclusion_id;
  UPDATE finance.queue_items SET status = v_to, status_changed_at = now(), updated_at = now(),
    assignee_id = CASE WHEN v_to = 'pending' THEN NULL ELSE assignee_id END,
    query_text = NULL, hold_reason = NULL, status_before_query = NULL
  WHERE id = v_ex.queue_item_id;
  INSERT INTO finance.queue_events (queue_item_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (v_ex.queue_item_id, 'exclusion_' || p_decision, v_status, v_to, p_actor, p_actor_label, v_note);
  RETURN v_to;
END;
$$;

/* Finance records the MAHER invoice (Step 7): invoice, status and event in
   one transaction. The same idempotency key returns the first result; a
   different key on an invoiced item is refused. */
CREATE OR REPLACE FUNCTION finance.record_invoice(
  p_item_id uuid, p_idempotency_key text, p_number text, p_date date, p_amount numeric,
  p_variance_reason text, p_actor uuid, p_actor_label text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = finance, pg_temp
AS $$
DECLARE
  v_existing finance.invoices%ROWTYPE;
  v_item finance.queue_items%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_existing FROM finance.invoices WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.queue_item_id <> p_item_id THEN
      RAISE EXCEPTION 'record_invoice: that key was used for another item' USING ERRCODE = 'check_violation';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_item FROM finance.queue_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'record_invoice: no item %', p_item_id USING ERRCODE = 'no_data_found'; END IF;
  IF v_item.status = 'invoiced' THEN
    RAISE EXCEPTION 'record_invoice: already invoiced' USING ERRCODE = 'serialization_failure';
  END IF;
  IF v_item.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'record_invoice: a % item cannot be invoiced', v_item.status USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM finance.exclusions WHERE queue_item_id = p_item_id AND decision IS NULL) THEN
    RAISE EXCEPTION 'record_invoice: an exclusion request is waiting for verification' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO finance.invoices (queue_item_id, maher_invoice_number, invoice_date, amount, queue_value,
                                variance_reason, idempotency_key, recorded_by, recorded_by_label)
  VALUES (p_item_id, trim(p_number), p_date, p_amount, v_item.value,
          nullif(trim(coalesce(p_variance_reason, '')), ''), p_idempotency_key, p_actor, p_actor_label)
  RETURNING id INTO v_id;
  UPDATE finance.queue_items SET status = 'invoiced', status_changed_at = now(), updated_at = now(),
    assignee_id = coalesce(assignee_id, p_actor), query_text = NULL, hold_reason = NULL, status_before_query = NULL
  WHERE id = p_item_id;
  INSERT INTO finance.queue_events (queue_item_id, event_type, from_status, to_status, actor_id, actor_label, note)
  VALUES (p_item_id, 'invoiced', v_item.status, 'invoiced', p_actor, p_actor_label, trim(p_number));
  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Progress per quotation (Step 2): computed, never typed
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW finance.estimate_progress AS
SELECT
  e.fsm_estimate_id,
  e.number AS quotation_number,
  e.sub_total AS quotation_total,
  coalesce(sum(l.amount) FILTER (WHERE i.status = 'invoiced'), 0)::numeric(14,2) AS invoiced_value,
  coalesce(sum(l.amount) FILTER (WHERE i.status IN ('pending', 'in_progress', 'query_raised', 'on_hold')), 0)::numeric(14,2) AS queued_value,
  coalesce(sum(l.amount) FILTER (WHERE i.status = 'excluded'), 0)::numeric(14,2) AS excluded_value,
  CASE WHEN e.sub_total > 0
       THEN round(100 * coalesce(sum(l.amount) FILTER (WHERE i.status = 'invoiced'), 0) / e.sub_total, 1)
  END AS completion_percent,
  (e.sub_total - coalesce(sum(l.amount) FILTER (WHERE i.status = 'invoiced'), 0))::numeric(14,2) AS remaining_value
FROM fsm.estimates e
LEFT JOIN finance.queue_items i ON i.fsm_estimate_id = e.fsm_estimate_id
LEFT JOIN finance.queue_item_lines l ON l.queue_item_id = i.id
GROUP BY e.fsm_estimate_id, e.number, e.sub_total;

-- ---------------------------------------------------------------------
-- Server-only
-- ---------------------------------------------------------------------
ALTER TABLE finance.queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.queue_item_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.exclusions ENABLE ROW LEVEL SECURITY;
ALTER TABLE finance.queue_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA finance FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA finance TO service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA finance FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA finance FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA finance FROM PUBLIC, anon, authenticated;
/* The server reads directly; every change goes through the functions,
   which run as their owner (SECURITY DEFINER, fixed search_path), so the
   server role itself holds no write grant on any finance table. */
GRANT SELECT ON ALL TABLES IN SCHEMA finance TO service_role;
GRANT EXECUTE ON FUNCTION
  finance.create_queue_item(text, text, text[], text),
  finance.apply_action(uuid, text, text, uuid, text, text),
  finance.request_exclusion(uuid, text, text, text[], uuid, text),
  finance.decide_exclusion(uuid, text, text, uuid, text),
  finance.record_invoice(uuid, text, text, date, numeric, text, uuid, text)
  TO service_role;
NOTIFY pgrst, 'reload schema';
