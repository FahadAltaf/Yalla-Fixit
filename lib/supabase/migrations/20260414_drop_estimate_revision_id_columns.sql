-- =====================================================
-- Migration: Drop redundant estimate id columns
-- File: 20260414_drop_estimate_revision_id_columns.sql
-- Description: Keep id+name only in quotation number fields
-- =====================================================

DROP INDEX IF EXISTS public.idx_estimate_revisions_root_estimate_id;
DROP INDEX IF EXISTS public.idx_estimate_revisions_parent_estimate_id;
DROP INDEX IF EXISTS public.idx_estimate_revisions_revision_estimate_id;

ALTER TABLE public.estimate_revisions
  DROP COLUMN IF EXISTS root_estimate_id,
  DROP COLUMN IF EXISTS parent_estimate_id,
  DROP COLUMN IF EXISTS revision_estimate_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_revisions_parent_quotation_number
  ON public.estimate_revisions (parent_quotation_number);

CREATE INDEX IF NOT EXISTS idx_estimate_revisions_root_quotation_number
  ON public.estimate_revisions (root_quotation_number);
