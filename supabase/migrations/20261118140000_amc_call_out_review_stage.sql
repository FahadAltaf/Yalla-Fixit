-- =====================================================================
-- A call out submitted from the phone is awaiting review (18 Nov 2026)
--
-- When the crew submits a call out's job sheet, the call out reads as in
-- review until the supervisor returns or closes it -- also when the sheet
-- lists pending works (its status is then pending works, which read as in
-- progress before). As additional work does (20261118100000).
--
-- Live-safe: the view replaced with the same columns in the same order.
-- Run after 20261118120000.
-- =====================================================================

CREATE OR REPLACE VIEW public.amc_field_visits
WITH (security_invoker = true) AS
-- Planned (PPM) visits: started by the office, in progress once the crew arrives
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
  v.created_at,
  v.started_at
FROM public.amc_visits v
JOIN public.amc_contracts c ON c.id = v.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id

UNION ALL

-- Call outs: started by the office, in progress once the crew is on site (attended)
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
    WHEN EXISTS (SELECT 1 FROM public.amc_visit_job_sheets j WHERE j.call_out_id = o.id AND j.status = 'submitted') THEN 'review'
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
  o.access_status,
  o.created_at,
  o.started_at
FROM public.amc_call_outs o
JOIN public.amc_contracts c ON c.id = o.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id

UNION ALL

-- Additional work, once approved: confirmed, started by the office, in progress once the crew arrives, reviewed, done
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
    WHEN w.status = 'scheduled' AND EXISTS (SELECT 1 FROM public.amc_visit_job_sheets j WHERE j.additional_work_id = w.id AND j.status = 'submitted') THEN 'review'
    WHEN w.status = 'scheduled' AND EXISTS (SELECT 1 FROM public.amc_visit_job_sheets j WHERE j.additional_work_id = w.id AND j.arrived_at IS NOT NULL) THEN 'in_progress'
    WHEN w.status = 'scheduled' AND w.client_confirmation = 'confirmed' THEN 'confirmed'
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
  w.client_confirmation,
  w.access_status,
  w.created_at,
  w.started_at
FROM public.amc_additional_works w
JOIN public.amc_contracts c ON c.id = w.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id
WHERE w.status IN ('approved', 'scheduled', 'completed', 'invoiced', 'paid')

UNION ALL

-- Site visits (before a proposal; no contract yet); no office start
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
  a.created_at,
  NULL::timestamptz
FROM public.amc_assessments a
LEFT JOIN public.snagging_clients cl ON cl.id = a.customer_id
LEFT JOIN public.snagging_properties p ON p.id = a.property_id;

COMMENT ON VIEW public.amc_field_visits IS
  'Every AMC visit (planned, call out, approved additional work, site visit) with a common stage; read by AMC -> Visits. Server only.';
COMMENT ON COLUMN public.amc_field_visits.started_at IS
  'A planned visit, call out or additional work: when the office pressed Start visit (the phone may open it from then; in progress once the crew arrives). Site visits: none.';

REVOKE ALL ON public.amc_field_visits FROM PUBLIC;
REVOKE ALL ON public.amc_field_visits FROM anon, authenticated;
GRANT SELECT ON public.amc_field_visits TO service_role;

NOTIFY pgrst, 'reload schema';

-- Check (read-only):
-- SELECT ref, status, stage FROM public.amc_field_visits WHERE kind = 'call_out' ORDER BY created_at DESC LIMIT 10;
