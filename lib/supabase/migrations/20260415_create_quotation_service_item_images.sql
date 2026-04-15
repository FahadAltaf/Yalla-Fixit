-- =====================================================
-- Migration: Create estimate service items table
-- File: 20260415_create_quotation_service_item_images.sql
-- Description: Stores image URLs against estimate service items
-- =====================================================

CREATE TABLE IF NOT EXISTS public.estimate_service_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  quotation_id TEXT NOT NULL,
  quotation_name TEXT NOT NULL,
  service_item_id TEXT NOT NULL,
  supabase_url TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_qsii_quotation_id_name
  ON public.estimate_service_items (quotation_id, quotation_name);

CREATE INDEX IF NOT EXISTS idx_qsii_quotation_service_item
  ON public.estimate_service_items (quotation_id, quotation_name, service_item_id);

ALTER TABLE public.estimate_service_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow All on estimate_service_items" ON public.estimate_service_items;
CREATE POLICY "Allow All on estimate_service_items"
ON public.estimate_service_items
FOR ALL
TO public
USING (true)
WITH CHECK (true);
