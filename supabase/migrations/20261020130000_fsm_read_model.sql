-- =====================================================================
-- Finance & Reports P2: the FSM read model.
--
-- A local copy of what the queue and the reports need from Zoho FSM, kept
-- fresh by a read-only sync (lib/server/finance/fsm-sync). Reports read
-- these tables; nothing calls FSM on page load.
--
--   fsm.sync_state              one row per resource: watermark, lease,
--                               last success / error, backfill progress
--   fsm.sync_runs               one row per run (the freshness indicator
--                               and the audit of FSM calls spent)
--   fsm.estimates               quotations
--   fsm.estimate_status_events  status history, observed by the sync (FSM
--                               exposes no history the token can read)
--   fsm.work_orders             work orders
--   fsm.line_items              work-order lines, keyed by FSM's own line id
--   fsm.line_status_events      line status history (the queue trigger)
--   fsm.appointments            appointments with scheduled and actual times
--   fsm.appointment_resources   the crew of each appointment
--
-- Everything lives in its own schema, `fsm`, apart from the portal's own
-- tables in `public` (decided 20 Oct). The API reaches the schema only once
-- it is listed under Project Settings > API > Exposed schemas, and even then
-- only the service role is granted anything in it: the browser's keys get
-- "permission denied".
--
-- Writes go through the fsm.* functions below, never straight into the
-- tables, so one rule holds everywhere: an FSM record older than the copy
-- already stored never overwrites it (a late page, a retried run, two runs
-- overlapping). Status events are appended at most once per change.
--
-- What discovery found (docs/finance-reporting/zoho-fsm-integration-plan.md):
-- line items and an appointment's crew come only on a record's detail
-- call; a line can change without its work order's Modified_Time moving.
--
-- Live-safe: a new schema; live main reads nothing in it. Server-only: no
-- USAGE on the schema for anon or authenticated, RLS on every table as a
-- second lock. Idempotent: safe to run twice.
--
-- After applying: add `fsm` to Exposed schemas (Project Settings > API).
-- The NOTIFY at the end makes the API pick the new objects up.
--
-- Checks: docs/finance-reporting/migrations/20261020130000.md.
-- Rollback (never automatic): docs/finance-reporting/migrations/20261020130000_rollback.sql.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS fsm;
COMMENT ON SCHEMA fsm IS
  'Read-only copy of Zoho FSM for Finance & Reports (P2). Written only by the sync, through the fsm.* functions.';

-- ---------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fsm.sync_state (
  resource text PRIMARY KEY CHECK (resource IN ('estimates', 'work_orders', 'appointments')),
  /* Newest FSM Modified_Time fully processed. Null until the backfill ends. */
  watermark timestamptz,
  /* A run holds the resource until lease_until; a crashed run's lease simply
     expires. (Not an advisory lock: those belong to a database session, and
     the API's pooled connections are shared between requests.) */
  lease_owner uuid,
  lease_until timestamptz,
  backfill_page integer NOT NULL DEFAULT 0 CHECK (backfill_page >= 0),
  backfill_started_at timestamptz,
  backfill_done boolean NOT NULL DEFAULT false,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO fsm.sync_state (resource)
VALUES ('estimates'), ('work_orders'), ('appointments')
ON CONFLICT (resource) DO NOTHING;

CREATE TABLE IF NOT EXISTS fsm.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL CHECK (resource IN ('estimates', 'work_orders', 'appointments')),
  kind text NOT NULL CHECK (kind IN ('incremental', 'reconcile', 'backfill')),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'budget_exhausted', 'skipped_busy')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  pages integer NOT NULL DEFAULT 0,
  records_seen integer NOT NULL DEFAULT 0,
  records_written integer NOT NULL DEFAULT 0,
  detail_calls integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  watermark_before timestamptz,
  watermark_after timestamptz,
  error text
);
CREATE INDEX IF NOT EXISTS idx_fsm_sync_runs_resource
  ON fsm.sync_runs (resource, started_at DESC);

-- ---------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fsm.estimates (
  fsm_estimate_id text PRIMARY KEY,
  number text,
  status text,
  /* "To Be Invoiced" is the likely Ready-to-Invoice flag (D-02). */
  post_to_maher text,
  maher_invoice_number text,
  grand_total numeric(14,2),
  sub_total numeric(14,2),
  tax_amount numeric(14,2),
  owner_name text,
  owner_email text,
  fsm_company_id text,
  company_name text,
  fsm_contact_id text,
  contact_name text,
  expiry_date date,
  created_in_fsm_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  quotation_type text,
  root_number text,
  fsm_work_order_id text,
  /* When the current status was first seen; for a record first read in the
     backfill this is its Modified_Time, an upper bound (status_since_estimated). */
  status_changed_at timestamptz,
  status_since_estimated boolean NOT NULL DEFAULT false,
  modified_time timestamptz NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsm_estimates_status ON fsm.estimates (status, status_changed_at);
CREATE INDEX IF NOT EXISTS idx_fsm_estimates_post_to_maher ON fsm.estimates (post_to_maher) WHERE post_to_maher IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_estimates_work_order ON fsm.estimates (fsm_work_order_id) WHERE fsm_work_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_estimates_modified ON fsm.estimates (modified_time);

CREATE TABLE IF NOT EXISTS fsm.estimate_status_events (
  id bigserial PRIMARY KEY,
  fsm_estimate_id text NOT NULL,
  from_status text,
  to_status text,
  /* The record's Modified_Time when the change was seen: the change happened
     at or before it. Also the replay key. */
  fsm_modified_time timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fsm_estimate_id, fsm_modified_time, to_status)
);
CREATE INDEX IF NOT EXISTS idx_fsm_estimate_status_events_estimate
  ON fsm.estimate_status_events (fsm_estimate_id, fsm_modified_time);

-- ---------------------------------------------------------------------
-- Work orders and their lines
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fsm.work_orders (
  fsm_work_order_id text PRIMARY KEY,
  number text,
  status text,
  type text,
  work_type text,
  completed_at timestamptz,
  fsm_estimate_id text,
  grand_total numeric(14,2),
  sub_total numeric(14,2),
  tax_amount numeric(14,2),
  billing_status text,
  amc_contract_ref text,
  parent_fsm_work_order_id text,
  fsm_company_id text,
  company_name text,
  fsm_contact_id text,
  contact_name text,
  created_in_fsm_at timestamptz,
  modified_time timestamptz NOT NULL,
  /* When the lines were last read from the detail call; a detail older than
     this is ignored. */
  lines_seen_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsm_work_orders_estimate ON fsm.work_orders (fsm_estimate_id) WHERE fsm_estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fsm_work_orders_status ON fsm.work_orders (status, completed_at);
CREATE INDEX IF NOT EXISTS idx_fsm_work_orders_modified ON fsm.work_orders (modified_time);

CREATE TABLE IF NOT EXISTS fsm.line_items (
  fsm_line_id text PRIMARY KEY,
  fsm_work_order_id text NOT NULL,
  fsm_estimate_id text,
  fsm_service_id text,
  name text,
  description text,
  quantity numeric(12,3),
  unit text,
  unit_price numeric(14,2),
  discount numeric(14,2),
  /* Line_Item_Amount (quantity x list price) and Amount, both as FSM gives
     them; which one invoicing uses is fixed in P3 with D-05. */
  line_amount numeric(14,2),
  amount numeric(14,2),
  tax_percent numeric(6,3),
  status text,
  sequence integer,
  is_optional boolean,
  billing_status text,
  actual_start timestamptz,
  actual_end timestamptz,
  modified_time timestamptz NOT NULL,
  /* Gone from the work order's detail. Never deleted: a queue item may
     already reference the line. */
  removed_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fsm_line_items_work_order ON fsm.line_items (fsm_work_order_id);
CREATE INDEX IF NOT EXISTS idx_fsm_line_items_estimate ON fsm.line_items (fsm_estimate_id) WHERE fsm_estimate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS fsm.line_status_events (
  id bigserial PRIMARY KEY,
  fsm_line_id text NOT NULL,
  fsm_work_order_id text NOT NULL,
  from_status text,
  to_status text,
  fsm_modified_time timestamptz NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fsm_line_id, fsm_modified_time, to_status)
);
CREATE INDEX IF NOT EXISTS idx_fsm_line_status_events_line ON fsm.line_status_events (fsm_line_id, fsm_modified_time);
CREATE INDEX IF NOT EXISTS idx_fsm_line_status_events_to ON fsm.line_status_events (to_status, observed_at);

-- ---------------------------------------------------------------------
-- Appointments and crews
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fsm.appointments (
  fsm_appointment_id text PRIMARY KEY,
  number text,
  fsm_work_order_id text,
  status text,
  type text,
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  lead_technician_fsm_id text,
  cancelled_at timestamptz,
  cancellation_reason text,
  modified_time timestamptz NOT NULL,
  /* When the crew was last read from the detail call. */
  crew_seen_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fsm_appointments_actual_order CHECK (actual_end IS NULL OR actual_start IS NULL OR actual_end >= actual_start)
);
CREATE INDEX IF NOT EXISTS idx_fsm_appointments_scheduled ON fsm.appointments (scheduled_start);
CREATE INDEX IF NOT EXISTS idx_fsm_appointments_work_order ON fsm.appointments (fsm_work_order_id);
CREATE INDEX IF NOT EXISTS idx_fsm_appointments_status ON fsm.appointments (status, actual_start);
CREATE INDEX IF NOT EXISTS idx_fsm_appointments_modified ON fsm.appointments (modified_time);

CREATE TABLE IF NOT EXISTS fsm.appointment_resources (
  fsm_appointment_id text NOT NULL REFERENCES fsm.appointments(fsm_appointment_id) ON DELETE CASCADE,
  /* Service resource id, the same id as technician_reference.fsm_resource_id.
     Not a foreign key: the roster sync removes technicians, history stays. */
  technician_fsm_id text NOT NULL,
  is_lead boolean NOT NULL DEFAULT false,
  PRIMARY KEY (fsm_appointment_id, technician_fsm_id)
);
CREATE INDEX IF NOT EXISTS idx_fsm_appointment_resources_technician
  ON fsm.appointment_resources (technician_fsm_id);

-- ---------------------------------------------------------------------
-- Writers
-- ---------------------------------------------------------------------

/* Quotations. A row older than the stored copy is skipped; a status change
   appends one event (replays hit the unique key). */
CREATE OR REPLACE FUNCTION fsm.upsert_estimates(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE
  r record;
  v_exists boolean;
  v_old_status text;
  v_old_modified timestamptz;
  v_written integer := 0;
  v_skipped integer := 0;
  v_events integer := 0;
  v_n integer;
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      fsm_estimate_id text, number text, status text, post_to_maher text, maher_invoice_number text,
      grand_total numeric, sub_total numeric, tax_amount numeric, owner_name text, owner_email text,
      fsm_company_id text, company_name text, fsm_contact_id text, contact_name text, expiry_date date,
      created_in_fsm_at timestamptz, approved_at timestamptz, rejected_at timestamptz, expired_at timestamptz,
      cancelled_at timestamptz, closed_at timestamptz, quotation_type text, root_number text,
      fsm_work_order_id text, modified_time timestamptz)
  LOOP
    IF r.fsm_estimate_id IS NULL OR r.modified_time IS NULL THEN
      RAISE EXCEPTION 'fsm.upsert_estimates: id and modified_time are required';
    END IF;

    SELECT true, status, modified_time INTO v_exists, v_old_status, v_old_modified
    FROM fsm.estimates WHERE fsm_estimate_id = r.fsm_estimate_id FOR UPDATE;
    v_exists := coalesce(v_exists, false);

    IF v_exists AND v_old_modified > r.modified_time THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO fsm.estimates AS t (
      fsm_estimate_id, number, status, post_to_maher, maher_invoice_number, grand_total, sub_total, tax_amount,
      owner_name, owner_email, fsm_company_id, company_name, fsm_contact_id, contact_name, expiry_date,
      created_in_fsm_at, approved_at, rejected_at, expired_at, cancelled_at, closed_at, quotation_type,
      root_number, fsm_work_order_id, status_changed_at, status_since_estimated, modified_time, synced_at)
    VALUES (
      r.fsm_estimate_id, r.number, r.status, r.post_to_maher, r.maher_invoice_number, r.grand_total, r.sub_total,
      r.tax_amount, r.owner_name, r.owner_email, r.fsm_company_id, r.company_name, r.fsm_contact_id, r.contact_name,
      r.expiry_date, r.created_in_fsm_at, r.approved_at, r.rejected_at, r.expired_at, r.cancelled_at, r.closed_at,
      r.quotation_type, r.root_number, r.fsm_work_order_id, r.modified_time, true, r.modified_time, now())
    ON CONFLICT (fsm_estimate_id) DO UPDATE SET
      number = excluded.number, status = excluded.status, post_to_maher = excluded.post_to_maher,
      maher_invoice_number = excluded.maher_invoice_number, grand_total = excluded.grand_total,
      sub_total = excluded.sub_total, tax_amount = excluded.tax_amount, owner_name = excluded.owner_name,
      owner_email = excluded.owner_email, fsm_company_id = excluded.fsm_company_id,
      company_name = excluded.company_name, fsm_contact_id = excluded.fsm_contact_id,
      contact_name = excluded.contact_name, expiry_date = excluded.expiry_date,
      created_in_fsm_at = excluded.created_in_fsm_at, approved_at = excluded.approved_at,
      rejected_at = excluded.rejected_at, expired_at = excluded.expired_at, cancelled_at = excluded.cancelled_at,
      closed_at = excluded.closed_at, quotation_type = excluded.quotation_type, root_number = excluded.root_number,
      fsm_work_order_id = excluded.fsm_work_order_id,
      status_changed_at = CASE WHEN t.status IS DISTINCT FROM excluded.status THEN excluded.modified_time ELSE t.status_changed_at END,
      status_since_estimated = CASE WHEN t.status IS DISTINCT FROM excluded.status THEN false ELSE t.status_since_estimated END,
      modified_time = excluded.modified_time, synced_at = now();
    v_written := v_written + 1;

    IF NOT v_exists OR v_old_status IS DISTINCT FROM r.status THEN
      INSERT INTO fsm.estimate_status_events (fsm_estimate_id, from_status, to_status, fsm_modified_time)
      VALUES (r.fsm_estimate_id, CASE WHEN v_exists THEN v_old_status END, r.status, r.modified_time)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_events := v_events + v_n;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('written', v_written, 'skipped', v_skipped, 'events', v_events);
END;
$$;

/* Work orders (header fields only; lines come from fsm.sync_line_items). */
CREATE OR REPLACE FUNCTION fsm.upsert_work_orders(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE
  r record;
  v_old_modified timestamptz;
  v_written integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      fsm_work_order_id text, number text, status text, type text, work_type text, completed_at timestamptz,
      fsm_estimate_id text, grand_total numeric, sub_total numeric, tax_amount numeric, billing_status text,
      amc_contract_ref text, parent_fsm_work_order_id text, fsm_company_id text, company_name text,
      fsm_contact_id text, contact_name text, created_in_fsm_at timestamptz, modified_time timestamptz)
  LOOP
    IF r.fsm_work_order_id IS NULL OR r.modified_time IS NULL THEN
      RAISE EXCEPTION 'fsm.upsert_work_orders: id and modified_time are required';
    END IF;
    v_old_modified := NULL;
    SELECT modified_time INTO v_old_modified FROM fsm.work_orders
    WHERE fsm_work_order_id = r.fsm_work_order_id FOR UPDATE;
    IF v_old_modified IS NOT NULL AND v_old_modified > r.modified_time THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO fsm.work_orders AS t (
      fsm_work_order_id, number, status, type, work_type, completed_at, fsm_estimate_id, grand_total, sub_total,
      tax_amount, billing_status, amc_contract_ref, parent_fsm_work_order_id, fsm_company_id, company_name,
      fsm_contact_id, contact_name, created_in_fsm_at, modified_time, synced_at)
    VALUES (
      r.fsm_work_order_id, r.number, r.status, r.type, r.work_type, r.completed_at, r.fsm_estimate_id,
      r.grand_total, r.sub_total, r.tax_amount, r.billing_status, r.amc_contract_ref, r.parent_fsm_work_order_id,
      r.fsm_company_id, r.company_name, r.fsm_contact_id, r.contact_name, r.created_in_fsm_at, r.modified_time, now())
    ON CONFLICT (fsm_work_order_id) DO UPDATE SET
      number = excluded.number, status = excluded.status, type = excluded.type, work_type = excluded.work_type,
      completed_at = excluded.completed_at, fsm_estimate_id = excluded.fsm_estimate_id,
      grand_total = excluded.grand_total, sub_total = excluded.sub_total, tax_amount = excluded.tax_amount,
      billing_status = excluded.billing_status, amc_contract_ref = excluded.amc_contract_ref,
      parent_fsm_work_order_id = excluded.parent_fsm_work_order_id, fsm_company_id = excluded.fsm_company_id,
      company_name = excluded.company_name, fsm_contact_id = excluded.fsm_contact_id,
      contact_name = excluded.contact_name, created_in_fsm_at = excluded.created_in_fsm_at,
      modified_time = excluded.modified_time, synced_at = now();
    v_written := v_written + 1;
  END LOOP;
  RETURN jsonb_build_object('written', v_written, 'skipped', v_skipped);
END;
$$;

/* A work order's lines, as read from its detail call at p_seen_at. A detail
   older than the last one applied is ignored as a whole. Lines are upserted
   by their own Modified_Time; a status change appends one event; a line no
   longer on the work order is marked removed, never deleted. The work order
   must already be stored (its header comes first). */
CREATE OR REPLACE FUNCTION fsm.sync_line_items(p_work_order_id text, p_seen_at timestamptz, p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE
  r record;
  v_lines_seen timestamptz;
  v_found boolean;
  v_exists boolean;
  v_old_status text;
  v_old_modified timestamptz;
  v_written integer := 0;
  v_skipped integer := 0;
  v_events integer := 0;
  v_removed integer := 0;
  v_n integer;
BEGIN
  SELECT true, lines_seen_at INTO v_found, v_lines_seen FROM fsm.work_orders
  WHERE fsm_work_order_id = p_work_order_id FOR UPDATE;
  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'fsm.sync_line_items: work order % is not stored', p_work_order_id;
  END IF;
  IF v_lines_seen IS NOT NULL AND v_lines_seen > p_seen_at THEN
    RETURN jsonb_build_object('written', 0, 'skipped', 0, 'events', 0, 'removed', 0, 'stale', true);
  END IF;

  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      fsm_line_id text, fsm_estimate_id text, fsm_service_id text, name text, description text,
      quantity numeric, unit text, unit_price numeric, discount numeric, line_amount numeric, amount numeric,
      tax_percent numeric, status text, sequence integer, is_optional boolean, billing_status text,
      actual_start timestamptz, actual_end timestamptz, modified_time timestamptz)
  LOOP
    IF r.fsm_line_id IS NULL OR r.modified_time IS NULL THEN
      RAISE EXCEPTION 'fsm.sync_line_items: line id and modified_time are required';
    END IF;
    v_exists := NULL; v_old_status := NULL; v_old_modified := NULL;
    SELECT true, status, modified_time INTO v_exists, v_old_status, v_old_modified
    FROM fsm.line_items WHERE fsm_line_id = r.fsm_line_id FOR UPDATE;
    v_exists := coalesce(v_exists, false);

    IF v_exists AND v_old_modified > r.modified_time THEN
      v_skipped := v_skipped + 1;
      -- Still on the work order, whatever its age.
      UPDATE fsm.line_items SET removed_at = NULL WHERE fsm_line_id = r.fsm_line_id AND removed_at IS NOT NULL;
      CONTINUE;
    END IF;

    INSERT INTO fsm.line_items AS t (
      fsm_line_id, fsm_work_order_id, fsm_estimate_id, fsm_service_id, name, description, quantity, unit,
      unit_price, discount, line_amount, amount, tax_percent, status, sequence, is_optional, billing_status,
      actual_start, actual_end, modified_time, removed_at, synced_at)
    VALUES (
      r.fsm_line_id, p_work_order_id, r.fsm_estimate_id, r.fsm_service_id, r.name, r.description, r.quantity,
      r.unit, r.unit_price, r.discount, r.line_amount, r.amount, r.tax_percent, r.status, r.sequence,
      r.is_optional, r.billing_status, r.actual_start, r.actual_end, r.modified_time, NULL, now())
    ON CONFLICT (fsm_line_id) DO UPDATE SET
      fsm_work_order_id = excluded.fsm_work_order_id, fsm_estimate_id = excluded.fsm_estimate_id,
      fsm_service_id = excluded.fsm_service_id, name = excluded.name, description = excluded.description,
      quantity = excluded.quantity, unit = excluded.unit, unit_price = excluded.unit_price,
      discount = excluded.discount, line_amount = excluded.line_amount, amount = excluded.amount,
      tax_percent = excluded.tax_percent, status = excluded.status, sequence = excluded.sequence,
      is_optional = excluded.is_optional, billing_status = excluded.billing_status,
      actual_start = excluded.actual_start, actual_end = excluded.actual_end,
      modified_time = excluded.modified_time, removed_at = NULL, synced_at = now();
    v_written := v_written + 1;

    IF NOT v_exists OR v_old_status IS DISTINCT FROM r.status THEN
      INSERT INTO fsm.line_status_events (fsm_line_id, fsm_work_order_id, from_status, to_status, fsm_modified_time)
      VALUES (r.fsm_line_id, p_work_order_id, CASE WHEN v_exists THEN v_old_status END, r.status, r.modified_time)
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_events := v_events + v_n;
    END IF;
  END LOOP;

  UPDATE fsm.line_items SET removed_at = p_seen_at
  WHERE fsm_work_order_id = p_work_order_id
    AND removed_at IS NULL
    AND fsm_line_id NOT IN (SELECT x->>'fsm_line_id' FROM jsonb_array_elements(p_rows) AS x);
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE fsm.work_orders SET lines_seen_at = p_seen_at WHERE fsm_work_order_id = p_work_order_id;

  RETURN jsonb_build_object('written', v_written, 'skipped', v_skipped, 'events', v_events,
                            'removed', v_removed, 'stale', false);
END;
$$;

/* Appointments (without crews; see fsm.set_appointment_crew). */
CREATE OR REPLACE FUNCTION fsm.upsert_appointments(p_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE
  r record;
  v_old_modified timestamptz;
  v_written integer := 0;
  v_skipped integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM jsonb_to_recordset(p_rows) AS x(
      fsm_appointment_id text, number text, fsm_work_order_id text, status text, type text,
      scheduled_start timestamptz, scheduled_end timestamptz, actual_start timestamptz, actual_end timestamptz,
      lead_technician_fsm_id text, cancelled_at timestamptz, cancellation_reason text, modified_time timestamptz)
  LOOP
    IF r.fsm_appointment_id IS NULL OR r.modified_time IS NULL THEN
      RAISE EXCEPTION 'fsm.upsert_appointments: id and modified_time are required';
    END IF;
    v_old_modified := NULL;
    SELECT modified_time INTO v_old_modified FROM fsm.appointments
    WHERE fsm_appointment_id = r.fsm_appointment_id FOR UPDATE;
    IF v_old_modified IS NOT NULL AND v_old_modified > r.modified_time THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    INSERT INTO fsm.appointments AS t (
      fsm_appointment_id, number, fsm_work_order_id, status, type, scheduled_start, scheduled_end, actual_start,
      actual_end, lead_technician_fsm_id, cancelled_at, cancellation_reason, modified_time, synced_at)
    VALUES (
      r.fsm_appointment_id, r.number, r.fsm_work_order_id, r.status, r.type, r.scheduled_start, r.scheduled_end,
      r.actual_start, r.actual_end, r.lead_technician_fsm_id, r.cancelled_at, r.cancellation_reason,
      r.modified_time, now())
    ON CONFLICT (fsm_appointment_id) DO UPDATE SET
      number = excluded.number, fsm_work_order_id = excluded.fsm_work_order_id, status = excluded.status,
      type = excluded.type, scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
      actual_start = excluded.actual_start, actual_end = excluded.actual_end,
      lead_technician_fsm_id = excluded.lead_technician_fsm_id, cancelled_at = excluded.cancelled_at,
      cancellation_reason = excluded.cancellation_reason, modified_time = excluded.modified_time, synced_at = now();
    v_written := v_written + 1;
  END LOOP;
  RETURN jsonb_build_object('written', v_written, 'skipped', v_skipped);
END;
$$;

/* An appointment's crew, as read from its detail call at p_seen_at. Replaces
   the stored crew unless a newer read was already applied. */
CREATE OR REPLACE FUNCTION fsm.set_appointment_crew(p_appointment_id text, p_seen_at timestamptz, p_crew jsonb)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE
  v_found boolean;
  v_seen timestamptz;
BEGIN
  SELECT true, crew_seen_at INTO v_found, v_seen FROM fsm.appointments
  WHERE fsm_appointment_id = p_appointment_id FOR UPDATE;
  IF NOT coalesce(v_found, false) THEN
    RAISE EXCEPTION 'fsm.set_appointment_crew: appointment % is not stored', p_appointment_id;
  END IF;
  IF v_seen IS NOT NULL AND v_seen > p_seen_at THEN
    RETURN false;
  END IF;
  DELETE FROM fsm.appointment_resources WHERE fsm_appointment_id = p_appointment_id;
  INSERT INTO fsm.appointment_resources (fsm_appointment_id, technician_fsm_id, is_lead)
  SELECT p_appointment_id, x.technician_fsm_id, bool_or(coalesce(x.is_lead, false))
  FROM jsonb_to_recordset(p_crew) AS x(technician_fsm_id text, is_lead boolean)
  WHERE x.technician_fsm_id IS NOT NULL
  GROUP BY x.technician_fsm_id;
  UPDATE fsm.appointments SET crew_seen_at = p_seen_at WHERE fsm_appointment_id = p_appointment_id;
  RETURN true;
END;
$$;

/* Claim a resource for one run. True when this owner now holds it. */
CREATE OR REPLACE FUNCTION fsm.sync_claim(p_resource text, p_owner uuid, p_seconds integer)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE fsm.sync_state
  SET lease_owner = p_owner,
      lease_until = now() + make_interval(secs => greatest(p_seconds, 1)),
      last_run_at = now(),
      updated_at = now()
  WHERE resource = p_resource
    AND (lease_until IS NULL OR lease_until < now() OR lease_owner = p_owner);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;

/* Release a claim and record the outcome. The watermark only ever moves
   forward, and only for the owner that holds the claim. */
CREATE OR REPLACE FUNCTION fsm.sync_release(
  p_resource text, p_owner uuid, p_success boolean, p_error text, p_watermark timestamptz,
  p_backfill_page integer DEFAULT NULL, p_backfill_done boolean DEFAULT NULL, p_backfill_started_at timestamptz DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SET search_path = fsm, pg_temp
AS $$
DECLARE v_n integer;
BEGIN
  UPDATE fsm.sync_state SET
    watermark = CASE WHEN p_watermark IS NULL THEN watermark ELSE greatest(coalesce(watermark, p_watermark), p_watermark) END,
    backfill_page = coalesce(p_backfill_page, backfill_page),
    backfill_done = coalesce(p_backfill_done, backfill_done),
    backfill_started_at = coalesce(backfill_started_at, p_backfill_started_at),
    last_success_at = CASE WHEN p_success THEN now() ELSE last_success_at END,
    last_error = CASE WHEN p_success THEN NULL ELSE left(p_error, 1000) END,
    consecutive_failures = CASE WHEN p_success THEN 0 ELSE consecutive_failures + 1 END,
    lease_owner = NULL,
    lease_until = NULL,
    updated_at = now()
  WHERE resource = p_resource AND lease_owner = p_owner;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n = 1;
END;
$$;

-- ---------------------------------------------------------------------
-- Server-only
-- ---------------------------------------------------------------------
ALTER TABLE fsm.sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.estimate_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.line_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fsm.appointment_resources ENABLE ROW LEVEL SECURITY;

/* A new schema gets none of Supabase's default grants on public, so the
   server role is granted exactly what the sync and the reports need, and
   the browser's roles nothing. Functions are executable by PUBLIC by
   default in Postgres, hence the explicit revokes. */
REVOKE ALL ON SCHEMA fsm FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA fsm TO service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA fsm FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fsm FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fsm TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA fsm TO service_role;

REVOKE ALL ON FUNCTION fsm.upsert_estimates(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.upsert_work_orders(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.sync_line_items(text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.upsert_appointments(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.set_appointment_crew(text, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.sync_claim(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fsm.sync_release(text, uuid, boolean, text, timestamptz, integer, boolean, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  fsm.upsert_estimates(jsonb),
  fsm.upsert_work_orders(jsonb),
  fsm.sync_line_items(text, timestamptz, jsonb),
  fsm.upsert_appointments(jsonb),
  fsm.set_appointment_crew(text, timestamptz, jsonb),
  fsm.sync_claim(text, uuid, integer),
  fsm.sync_release(text, uuid, boolean, text, timestamptz, integer, boolean, timestamptz)
  TO service_role;

/* The API caches the database's shape; tell it to look again. */
NOTIFY pgrst, 'reload schema';
