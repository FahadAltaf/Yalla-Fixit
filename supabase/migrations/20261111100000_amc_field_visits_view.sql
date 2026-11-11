-- =====================================================================
-- AMC field visits: one read model over every kind of AMC visit
--
-- NOT APPLIED until the user runs it (Supabase SQL editor). Live-safe:
-- one VIEW and three indexes. No table, column, row, grant on a table or
-- policy changes. Safe to run twice.
--
-- Why
-- ---
-- AMC field work lives in four tables, each with its own list and its own
-- statuses: planned (PPM) visits (amc_visits), call outs (amc_call_outs),
-- additional work (amc_additional_works) and site visits before a proposal
-- (amc_assessments). There was no single list of all visits across
-- contracts. AMC -> Visits reads this view: one row per visit, the same
-- columns for every kind, and a common STAGE so the list can be filtered
-- and counted the same way whatever the kind.
--
-- Nothing is copied: the view reads the tables as they are, so there is
-- nothing to keep in step. If the list ever outgrows a view (hundreds of
-- thousands of rows), it can be materialised without changing the API.
--
-- Stages (whatever the kind):
--   to_plan      not on the board yet (no slot)
--   planned      a slot and crew are set (or a site visit is booked)
--   confirmed    the client confirmed (planned visits)
--   in_progress  the crew is on it / attended
--   review       waiting for the supervisor (job sheet submitted) or closure
--   done         finished (any completion outcome)
--   cancelled
--
-- Additional work appears once the client approved it (before that it is a
-- quotation, on the Additional work page, not a visit).
--
-- Dates are Dubai days. `day` is the date the visit is planned for (the
-- slot, else the target date / report time / scheduled date / booking);
-- `due_on` is the last acceptable day (the PPM window end, the call-out
-- deadline, the date additional work is scheduled for).
--
-- Access: server only. security_invoker, and no grants to anon or
-- authenticated, so the public key cannot read it.
--
-- Rollback: DROP VIEW IF EXISTS public.amc_field_visits; and the three
-- DROP INDEX IF EXISTS lines at the end.
-- =====================================================================

CREATE OR REPLACE VIEW public.amc_field_visits
WITH (security_invoker = true) AS
-- Planned (PPM) visits
SELECT
  'ppm'::text AS kind,
  v.id,
  (coalesce(c.contract_number, c.proposal_number) || ' · V' || v.visit_no)::text AS ref,
  v.visit_no,
  v.contract_id,
  coalesce(c.contract_number, c.proposal_number) AS contract_number,
  c.customer_id,
  c.customer_name,
  c.property_id,
  c.property_label,
  s.owner_id,
  NULL::uuid AS assessor_id,
  v.status,
  CASE
    WHEN v.status = 'cancelled' THEN 'cancelled'
    WHEN v.status IN ('completed', 'completed_with_additional_work', 'partially_completed', 'not_completed') THEN 'done'
    WHEN v.status = 'submitted' THEN 'review'
    WHEN v.status = 'in_progress' THEN 'in_progress'
    WHEN v.status = 'confirmed' THEN 'confirmed'
    WHEN v.scheduled_start IS NOT NULL THEN 'planned'
    ELSE 'to_plan'
  END AS stage,
  coalesce((v.scheduled_start AT TIME ZONE 'Asia/Dubai')::date, v.target_date) AS day,
  v.window_end AS due_on,
  v.scheduled_start,
  v.scheduled_end,
  v.window_start,
  v.window_end,
  v.technician_ids,
  v.lead_technician_id,
  NULL::text AS priority,
  NULL::text AS coverage,
  NULL::text AS trade,
  NULL::text AS summary,
  v.client_confirmation,
  v.access_status,
  v.created_at
FROM public.amc_visits v
JOIN public.amc_contracts c ON c.id = v.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id

UNION ALL

-- Call outs
SELECT
  'call_out'::text,
  o.id,
  o.call_out_no,
  NULL::integer,
  o.contract_id,
  coalesce(c.contract_number, c.proposal_number),
  c.customer_id,
  c.customer_name,
  c.property_id,
  c.property_label,
  s.owner_id,
  NULL::uuid,
  o.status,
  CASE
    WHEN o.status = 'cancelled' THEN 'cancelled'
    WHEN o.status = 'closed' THEN 'done'
    WHEN o.status = 'resolved' THEN 'review'
    WHEN o.status IN ('attended', 'pending_works', 'quoted') THEN 'in_progress'
    WHEN o.scheduled_start IS NOT NULL THEN 'planned'
    ELSE 'to_plan'
  END,
  (coalesce(o.scheduled_start, o.reported_at) AT TIME ZONE 'Asia/Dubai')::date,
  (coalesce(o.sla_attend_due_at, o.sla_schedule_due_at) AT TIME ZONE 'Asia/Dubai')::date,
  o.scheduled_start,
  o.scheduled_end,
  NULL::date,
  NULL::date,
  o.technician_ids,
  o.lead_technician_id,
  o.priority,
  o.coverage,
  o.trade,
  o.issue,
  NULL::text,
  NULL::text,
  o.created_at
FROM public.amc_call_outs o
JOIN public.amc_contracts c ON c.id = o.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id

UNION ALL

-- Additional work, once approved
SELECT
  'additional_work'::text,
  w.id,
  w.work_no,
  NULL::integer,
  w.contract_id,
  coalesce(c.contract_number, c.proposal_number),
  c.customer_id,
  c.customer_name,
  c.property_id,
  c.property_label,
  s.owner_id,
  NULL::uuid,
  w.status,
  CASE
    WHEN w.status IN ('completed', 'invoiced', 'paid') THEN 'done'
    WHEN w.status = 'scheduled' THEN 'planned'
    ELSE 'to_plan'
  END,
  coalesce(w.scheduled_for, (w.created_at AT TIME ZONE 'Asia/Dubai')::date),
  w.scheduled_for,
  NULL::timestamptz,
  NULL::timestamptz,
  NULL::date,
  NULL::date,
  '{}'::text[],
  NULL::text,
  NULL::text,
  NULL::text,
  w.trade,
  w.finding,
  NULL::text,
  NULL::text,
  w.created_at
FROM public.amc_additional_works w
JOIN public.amc_contracts c ON c.id = w.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id
WHERE w.status IN ('approved', 'scheduled', 'completed', 'invoiced', 'paid')

UNION ALL

-- Site visits (before a proposal; no contract yet)
SELECT
  'site_visit'::text,
  a.id,
  a.assessment_number,
  NULL::integer,
  a.contract_id,
  NULL::text,
  a.customer_id,
  cl.name,
  a.property_id,
  coalesce(p.unit_label, ''),
  a.created_by,
  a.assessor_id,
  a.status,
  CASE
    WHEN a.status = 'completed' THEN 'done'
    WHEN a.attendance = 'cancelled' THEN 'cancelled'
    WHEN a.attendance = 'attended' THEN 'in_progress'
    WHEN a.scheduled_at IS NOT NULL THEN 'planned'
    ELSE 'to_plan'
  END,
  coalesce((a.scheduled_at AT TIME ZONE 'Asia/Dubai')::date, a.assessed_on, (a.created_at AT TIME ZONE 'Asia/Dubai')::date),
  NULL::date,
  a.scheduled_at,
  NULL::timestamptz,
  NULL::date,
  NULL::date,
  '{}'::text[],
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  NULL::text,
  a.created_at
FROM public.amc_assessments a
LEFT JOIN public.snagging_clients cl ON cl.id = a.customer_id
LEFT JOIN public.snagging_properties p ON p.id = a.property_id;

COMMENT ON VIEW public.amc_field_visits IS
  'Every AMC visit (planned, call out, approved additional work, site visit) with a common stage; read by AMC -> Visits. Server only.';

REVOKE ALL ON public.amc_field_visits FROM PUBLIC;
REVOKE ALL ON public.amc_field_visits FROM anon, authenticated;
GRANT SELECT ON public.amc_field_visits TO service_role;

-- The list filters by day and by technician; these keep both quick as the
-- tables grow (call outs and additional work already have contract and
-- status indexes).
CREATE INDEX IF NOT EXISTS idx_amc_visits_target_date ON public.amc_visits (target_date);
CREATE INDEX IF NOT EXISTS idx_amc_visits_technicians ON public.amc_visits USING gin (technician_ids);
CREATE INDEX IF NOT EXISTS idx_amc_call_outs_technicians ON public.amc_call_outs USING gin (technician_ids);

-- Check (read-only): the view answers, one row per visit.
-- SELECT kind, stage, count(*) FROM public.amc_field_visits GROUP BY 1, 2 ORDER BY 1, 2;
