-- Keeps the defect library's own identifier alongside ours.
--
-- The library ships a stable code per defect — SN-01-01-01 — and its Read
-- Me is explicit that this is the key to import against: "Use the Defect
-- Code as the database key, while displaying the text fields to
-- inspectors." Re-issues of the library keep those codes stable even when
-- wording changes, so it is the only reliable way to match a revised row
-- to the one already seeded.
--
-- It is stored rather than used as the primary code because the platform
-- composes a snag code from all three levels (Action Points P3), and the
-- library's code is already a whole path in one string. Both are kept: the
-- composed one is what a client reads on a report, and this one is what a
-- re-import matches on.

ALTER TABLE public.snagging_catalogue_defects
  ADD COLUMN IF NOT EXISTS source_code text;

COMMENT ON COLUMN public.snagging_catalogue_defects.source_code IS
  'The defect library''s own stable identifier, e.g. SN-01-01-01. Used to '
  'match a row when the library is re-issued; not shown to inspectors.';

-- Unique where present, so a re-import cannot silently create a second row
-- for a defect that already exists. Partial, because rows added by hand in
-- the admin screens have no library code and must not collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS snagging_catalogue_defects_source_code_idx
  ON public.snagging_catalogue_defects (source_code)
  WHERE source_code IS NOT NULL;

-- The flat read gains it too, so an importer can diff without a join.
--
-- Dropped and recreated rather than replaced: CREATE OR REPLACE can only
-- append columns, and adding source_code in its natural place beside the
-- other codes reads as renaming full_code to source_code, which Postgres
-- refuses (42P16).
DROP VIEW IF EXISTS public.snagging_catalogue_v2;

CREATE VIEW public.snagging_catalogue_v2 AS
SELECT
  d.id                AS defect_id,
  c.id                AS category_id,
  s.id                AS subcategory_id,
  c.code              AS category_code,
  c.label             AS category_label,
  s.code              AS subcategory_code,
  s.label             AS subcategory_label,
  d.code              AS defect_code,
  d.label             AS defect_label,
  d.source_code,
  c.code || '-' || s.code || '-' || d.code AS full_code,
  d.default_severity,
  d.guidance,
  (c.active AND s.active AND d.active) AS active,
  c.sort_order        AS category_sort,
  s.sort_order        AS subcategory_sort,
  d.sort_order        AS defect_sort
FROM public.snagging_catalogue_defects d
JOIN public.snagging_catalogue_subcategories s ON s.id = d.subcategory_id
JOIN public.snagging_catalogue_categories c    ON c.id = s.category_id;
