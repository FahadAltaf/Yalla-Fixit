-- =====================================================
-- Migration: Create estimate revisions tracking table
-- File: 20260413_create_estimate_revisions.sql
-- Description: Stores revision chain metadata for estimates
-- =====================================================

CREATE TABLE IF NOT EXISTS public.estimate_revisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  root_quotation_number TEXT NOT NULL,
  parent_quotation_number TEXT NOT NULL,
  revision_quotation_number TEXT NOT NULL UNIQUE,
  revision_type TEXT NOT NULL CHECK (revision_type IN ('Internal', 'External')),
  reason TEXT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_estimate_revisions_parent_quotation_number
  ON public.estimate_revisions (parent_quotation_number);

CREATE INDEX IF NOT EXISTS idx_estimate_revisions_root_quotation_number
  ON public.estimate_revisions (root_quotation_number);

ALTER TABLE public.estimate_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on estimate_revisions" ON public.estimate_revisions;
CREATE POLICY "Allow All on estimate_revisions"
ON public.estimate_revisions
FOR ALL
TO public
USING (true)
WITH CHECK (true);
