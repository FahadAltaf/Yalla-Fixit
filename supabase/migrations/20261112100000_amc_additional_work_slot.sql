-- =====================================================================
-- AMC additional work: a slot and a crew when it is scheduled (11 Nov 2026)
-- =====================================================================
-- Approved additional work was scheduled for a day only (scheduled_for),
-- and nobody was assigned to do it: technician_id is who FOUND it. So the
-- work had no time, no crew, and was invisible to the double-booking check
-- when the same technicians were put on a planned visit or a call out.
--
-- Scheduling additional work now sets, as a call out does:
--   scheduled_start / scheduled_end   the slot (Dubai time on screen)
--   technician_ids                    the crew (FSM ids), first = lead
--   lead_technician_id                the lead
--   assignment_note                   why this crew, when it is not the
--                                     suggested one
-- scheduled_for stays (the day), so everything that reads it still works.
--
-- The visits view (AMC -> Visits) shows the slot and crew of additional
-- work; it is the same view with only that branch changed.
--
-- Live-safe: new nullable / defaulted columns, an index and a view with
-- the same columns. The code on the live site does not read the new
-- columns; the new code reads them apart from the rest, so the Additional
-- work pages keep working before this is applied.
--
-- Rollback: CREATE OR REPLACE VIEW from 20261111100000 (the additional
-- work branch as it was), then
--   DROP INDEX IF EXISTS public.idx_amc_additional_works_technicians;
--   ALTER TABLE public.amc_additional_works
--     DROP CONSTRAINT IF EXISTS amc_additional_works_slot_order,
--     DROP COLUMN IF EXISTS assignment_note,
--     DROP COLUMN IF EXISTS lead_technician_id,
--     DROP COLUMN IF EXISTS technician_ids,
--     DROP COLUMN IF EXISTS scheduled_end,
--     DROP COLUMN IF EXISTS scheduled_start;
-- =====================================================================

ALTER TABLE public.amc_additional_works
  ADD COLUMN IF NOT EXISTS scheduled_start timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_end timestamptz,
  ADD COLUMN IF NOT EXISTS technician_ids text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lead_technician_id text,
  ADD COLUMN IF NOT EXISTS assignment_note text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_additional_works_slot_order') THEN
    ALTER TABLE public.amc_additional_works
      ADD CONSTRAINT amc_additional_works_slot_order
      CHECK (scheduled_start IS NULL OR (scheduled_end IS NOT NULL AND scheduled_end > scheduled_start));
  END IF;
END $$;

COMMENT ON COLUMN public.amc_additional_works.technician_ids IS 'The crew doing the work (FSM technician ids, first = lead). technician_id is who found it.';
COMMENT ON COLUMN public.amc_additional_works.scheduled_start IS 'The slot the work is scheduled for (with scheduled_end); scheduled_for is its day.';

-- Busy checks read the crew of a day's work.
CREATE INDEX IF NOT EXISTS idx_amc_additional_works_technicians ON public.amc_additional_works USING gin (technician_ids);

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
  coalesce((w.scheduled_start AT TIME ZONE 'Asia/Dubai')::date, w.scheduled_for, (w.created_at AT TIME ZONE 'Asia/Dubai')::date),
  w.scheduled_for,
  w.scheduled_start,
  w.scheduled_end,
  NULL::date,
  NULL::date,
  w.technician_ids,
  w.lead_technician_id,
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
LEFT JOIN public.snagging_properties p ON p.id = a.property_id;;

COMMENT ON VIEW public.amc_field_visits IS
  'Every AMC visit (planned, call out, approved additional work, site visit) with a common stage; read by AMC -> Visits. Server only.';

REVOKE ALL ON public.amc_field_visits FROM PUBLIC;
REVOKE ALL ON public.amc_field_visits FROM anon, authenticated;
GRANT SELECT ON public.amc_field_visits TO service_role;

-- Check (read-only): the new columns exist and the view still answers.
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'amc_additional_works' AND column_name IN ('scheduled_start', 'scheduled_end', 'technician_ids', 'lead_technician_id', 'assignment_note');
-- SELECT kind, stage, count(*) FROM public.amc_field_visits GROUP BY 1, 2 ORDER BY 1, 2;
