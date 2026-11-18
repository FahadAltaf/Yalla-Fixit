-- =====================================================================
-- Planned visit checklist: a category for each check
-- =====================================================================
-- The crew's checks on a planned visit's job sheet get a category the
-- technician types (optional), as a site visit's own checks have
-- (17 Nov 2026). The phone shows it over the check's name; the portal's
-- job sheet keeps it when the office saves the sheet.
--
-- Live-safe: one new nullable column with a length check. No data is
-- changed; existing checks have no category. Safe to run twice.
-- =====================================================================

ALTER TABLE public.amc_visit_checklist_items
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'amc_visit_checklist_items_category_length'
  ) THEN
    ALTER TABLE public.amc_visit_checklist_items
      ADD CONSTRAINT amc_visit_checklist_items_category_length CHECK (category IS NULL OR length(category) <= 100);
  END IF;
END $$;
