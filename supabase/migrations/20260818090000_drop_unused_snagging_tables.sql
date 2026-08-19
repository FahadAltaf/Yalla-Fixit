-- =====================================================
-- Migration: Trim the snagging schema to what is wired
-- File: 20260818090000_drop_unused_snagging_tables.sql
--
-- Three tables were created ahead of features that are not built and
-- are not on the path being tested now. They carry no data and nothing
-- reads or writes them, so they are removed to keep the schema lean.
-- Each maps to a BRD area that can re-add its own tables as one unit
-- when it is actually built.
--
--   snagging_projects              -> full-building B2B engagements
--                                     (grouping many unit-tasks under a
--                                     building). Single-unit and
--                                     de-snag flows never touch it.
--   snagging_report_tokens         -> tokenised report delivery
--   snagging_report_token_events      (FR-5.04-06), not implemented.
--
-- snagging_reports is kept: the approval flow already stages a row
-- there, and report generation (FR-5.01) builds directly on it.
-- =====================================================

-- -----------------------------------------------------
-- 1. Tokenised delivery tables (leaf tables, no dependants).
-- -----------------------------------------------------
DROP TABLE IF EXISTS public.snagging_report_token_events;
DROP TABLE IF EXISTS public.snagging_report_tokens;

-- -----------------------------------------------------
-- 2. Projects.
--
-- The task summary view joins projects for project_name, so it is
-- recreated without that join before the table and its foreign-key
-- columns are dropped. The definition is otherwise identical to the
-- one in 20260817090000; project_id / project_name simply fall away.
-- -----------------------------------------------------
DROP VIEW IF EXISTS public.snagging_task_summaries;

CREATE OR REPLACE VIEW public.snagging_task_summaries AS
SELECT
  t.id,
  t.code,
  t.status,
  t.task_type,
  t.round_number,
  t.parent_task_id,
  t.scheduled_date,
  t.scheduled_start_at,
  t.scheduled_end_at,
  t.package_name,
  t.service_tier,
  t.locked,
  t.rejection_category,
  t.rejection_reason,
  t.rejection_count,
  t.approval_due_at,
  t.submitted_at,
  t.approved_at,
  t.delivered_at,
  t.created_at,
  t.updated_at,
  t.supervisor_id,
  t.approval_manager_id,
  p.id  AS property_id,
  p.unit_label,
  p.building_name,
  p.community,
  p.property_type,
  p.client_name,
  p.developer_name,
  COALESCE(a.area_count, 0)      AS area_count,
  COALESCE(a.confirmed_count, 0) AS confirmed_area_count,
  COALESCE(s.snag_count, 0)      AS snag_count,
  COALESCE(s.high_count, 0)      AS high_severity_count,
  COALESCE(s.open_count, 0)      AS open_snag_count,
  COALESCE(ph.photo_count, 0)    AS photo_count
FROM public.snagging_tasks t
JOIN public.snagging_properties p ON p.id = t.property_id
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS area_count,
         COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL) AS confirmed_count
  FROM public.snagging_areas WHERE task_id = t.id
) a ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS snag_count,
         COUNT(*) FILTER (WHERE severity = 'high') AS high_count,
         COUNT(*) FILTER (WHERE status IN ('open', 'pending_verification',
                                           'verified_poor_quality', 'verified_not_done')) AS open_count
  FROM public.snagging_snags WHERE origin_task_id = t.id
) s ON TRUE
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS photo_count
  FROM public.snagging_snag_photos WHERE task_id = t.id
) ph ON TRUE;

ALTER VIEW public.snagging_task_summaries SET (security_invoker = true);

-- The foreign-key columns and the table itself.
ALTER TABLE public.snagging_tasks DROP COLUMN IF EXISTS project_id;
ALTER TABLE public.snagging_properties DROP COLUMN IF EXISTS project_id;
DROP TABLE IF EXISTS public.snagging_projects;

DO $$
BEGIN
  RAISE NOTICE 'Dropped snagging_projects, snagging_report_tokens, snagging_report_token_events.';
END $$;
