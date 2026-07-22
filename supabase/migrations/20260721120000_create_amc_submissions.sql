-- =====================================================
-- Migration: Create AMC submissions table
-- Description: Persists AMC proposal/contract wizard submissions per user.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.amc_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES public.user_profile(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated')),
  property JSONB NOT NULL DEFAULT '{}',
  customer JSONB NOT NULL DEFAULT '{}',
  package JSONB NOT NULL DEFAULT '{}',
  services JSONB NOT NULL DEFAULT '[]',
  discount_percent NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  final_price NUMERIC NOT NULL DEFAULT 0,
  generated_documents TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amc_submissions_owner_updated
  ON public.amc_submissions (owner_id, updated_at DESC);

ALTER TABLE public.amc_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on amc_submissions" ON public.amc_submissions;
CREATE POLICY "Allow All on amc_submissions"
ON public.amc_submissions
FOR ALL
TO public
USING (true)
WITH CHECK (true);
