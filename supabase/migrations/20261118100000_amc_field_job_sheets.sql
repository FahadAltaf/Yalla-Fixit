-- =====================================================================
-- One job sheet for call outs and additional work (18 Nov 2026, phase 2)
--
-- A call out and an additional work are recorded on the planned visit's
-- job sheet: arrival and completion, the outcome, checklist, faults,
-- consumables, pending works, quality, the client's sign-off; filled on the
-- phone, reviewed on the portal (return / close), and a service report
-- goes to the client on close.
--
--   amc_visit_job_sheets   visit_id may be empty; call_out_id or
--                          additional_work_id instead (exactly one owner);
--                          work_outcome / _group / _reason hold the one
--                          outcome of a call out or additional work (a
--                          planned visit keeps one per trade on its lines)
--   amc_call_outs          report_document_id / report_sent_at / report_due_at
--   amc_additional_works   the same
--   amc_field_visits       additional work whose sheet is submitted reads
--                          as in review
--
-- Photos of a call out or additional work stay in amc_work_photos.
-- Live-safe: a NOT NULL dropped, nullable columns, a CHECK every existing
-- row meets (each has its visit_id), the view replaced with the same
-- columns. Run after 20261117130000.
--
-- Rollback: CREATE OR REPLACE VIEW from 20261117130000; delete the sheets
-- with no visit_id; drop the CHECK and the new columns; SET NOT NULL on
-- visit_id again.
-- =====================================================================

ALTER TABLE public.amc_visit_job_sheets ALTER COLUMN visit_id DROP NOT NULL;

ALTER TABLE public.amc_visit_job_sheets
  ADD COLUMN IF NOT EXISTS call_out_id uuid UNIQUE REFERENCES public.amc_call_outs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS additional_work_id uuid UNIQUE REFERENCES public.amc_additional_works(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS work_outcome text,
  ADD COLUMN IF NOT EXISTS work_outcome_group text,
  ADD COLUMN IF NOT EXISTS work_outcome_reason text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_visit_job_sheets_one_owner') THEN
    ALTER TABLE public.amc_visit_job_sheets ADD CONSTRAINT amc_visit_job_sheets_one_owner
      CHECK (num_nonnulls(visit_id, call_out_id, additional_work_id) = 1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'amc_visit_job_sheets_work_outcome_check') THEN
    ALTER TABLE public.amc_visit_job_sheets ADD CONSTRAINT amc_visit_job_sheets_work_outcome_check
      CHECK (work_outcome IS NULL OR work_outcome IN ('completed', 'partially_completed', 'not_completed'));
  END IF;
END $$;

ALTER TABLE public.amc_call_outs
  ADD COLUMN IF NOT EXISTS report_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_due_at timestamptz;

ALTER TABLE public.amc_additional_works
  ADD COLUMN IF NOT EXISTS report_document_id uuid REFERENCES public.amc_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS report_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS report_due_at timestamptz;

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

-- Call outs: started by the office (Start visit), then attended by the crew
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
    WHEN o.started_at IS NOT NULL THEN 'in_progress'
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
  o.created_at
FROM public.amc_call_outs o
JOIN public.amc_contracts c ON c.id = o.contract_id
LEFT JOIN public.amc_submissions s ON s.id = c.submission_id

UNION ALL

-- Additional work, once approved: confirmed with the client, started, its sheet reviewed, done
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
    WHEN w.status = 'scheduled' AND w.started_at IS NOT NULL THEN 'in_progress'
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

NOTIFY pgrst, 'reload schema';

-- Check (read-only):
-- SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'amc_visit_job_sheets' AND column_name IN ('visit_id', 'call_out_id', 'additional_work_id', 'work_outcome');
-- SELECT kind, stage, count(*) FROM public.amc_field_visits GROUP BY 1, 2 ORDER BY 1, 2;
