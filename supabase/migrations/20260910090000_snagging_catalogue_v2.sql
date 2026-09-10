-- The snag catalogue, restructured (Action Points P1–P6).
--
-- It moves from AREA > ELEMENT > DEFECT to CATEGORY > SUB-CATEGORY > DEFECT.
-- Three things follow from that, and this migration does all three.
--
-- 1. Areas stop narrowing the defect list. Every category applies in every
--    area, so the area-to-element applicability matrix has nothing left to
--    say (P2). It is marked retired here rather than emptied: the capture
--    screens still read it until the new pickers ship, and clearing it now
--    would leave an inspector with no defect list in between. Areas
--    themselves, the templates and the four area states are untouched (P4)
--    — they remain the navigation and the reporting structure.
--
-- 2. The snag code stops carrying the area. `LIV-WL-CRK` becomes
--    `CIV-PNT-DRP`: category, sub-category, defect. The area is recorded
--    against the snag, in `area_id`, where it already was (P3).
--
-- 3. Every level is a row, not a constant. Categories, sub-categories and
--    defects are all editable from the admin screens without a release
--    (P6) — which is also why the six categories are seeded rather than
--    enumerated in a CHECK constraint.
--
-- The old catalogue is REPLACED, not migrated (P5). The previous tables are
-- left in place but emptied of meaning: nothing reads them after this, and
-- keeping them for one release means a bad seed can be rolled back without
-- restoring from a backup.

-- ---------------------------------------------------------------------
-- 1. The three levels
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.snagging_catalogue_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The leading segment of a snag code, e.g. 'CIV'. Short, and stable:
  -- changing it rewrites how every existing snag reads.
  code        text NOT NULL UNIQUE,
  label       text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT TRUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.snagging_catalogue_subcategories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL
    REFERENCES public.snagging_catalogue_categories(id) ON DELETE CASCADE,
  code         text NOT NULL,
  label        text NOT NULL,
  sort_order   integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT TRUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Unique within its category, not globally: 'PNT' may reasonably mean
  -- paint under Civil and painted conduit under Electrical.
  UNIQUE (category_id, code)
);

CREATE TABLE IF NOT EXISTS public.snagging_catalogue_defects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcategory_id  uuid NOT NULL
    REFERENCES public.snagging_catalogue_subcategories(id) ON DELETE CASCADE,
  code            text NOT NULL,
  label           text NOT NULL,
  default_severity text NOT NULL DEFAULT 'medium'
    CHECK (default_severity IN ('high', 'medium', 'low')),
  guidance        text,
  sort_order      integer NOT NULL DEFAULT 0,
  active          boolean NOT NULL DEFAULT TRUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subcategory_id, code)
);

CREATE INDEX IF NOT EXISTS snagging_catalogue_subcategories_category_idx
  ON public.snagging_catalogue_subcategories (category_id, sort_order);
CREATE INDEX IF NOT EXISTS snagging_catalogue_defects_subcategory_idx
  ON public.snagging_catalogue_defects (subcategory_id, sort_order);

-- ---------------------------------------------------------------------
-- 2. One flat read of the whole tree
-- ---------------------------------------------------------------------

-- The pickers and the mobile pull both want the three levels resolved with
-- the composed code already built. Doing it here means the code is derived
-- in exactly one place; a defect that moves to another sub-category gets a
-- new code without anything having to remember to rebuild it.
CREATE OR REPLACE VIEW public.snagging_catalogue_v2 AS
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

-- ---------------------------------------------------------------------
-- 3. What a snag records
-- ---------------------------------------------------------------------

-- `element_label` already holds the middle level of the hierarchy — it is
-- the same level under its previous name — so it carries the sub-category
-- from here on and needs no rename. Only the top level is genuinely new.
ALTER TABLE public.snagging_snags
  ADD COLUMN IF NOT EXISTS category_label text;

-- ---------------------------------------------------------------------
-- 4. Row level security, matching the tables these replace
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_catalogue_categories     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_catalogue_subcategories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.snagging_catalogue_defects        ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in user, exactly as the old catalogue was: an
-- inspector cannot capture a snag without it. Writes go through the API on
-- the service role, which is where the admin permission is actually checked.
DROP POLICY IF EXISTS "snagging catalogue categories readable"
  ON public.snagging_catalogue_categories;
CREATE POLICY "snagging catalogue categories readable"
  ON public.snagging_catalogue_categories FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging catalogue subcategories readable"
  ON public.snagging_catalogue_subcategories;
CREATE POLICY "snagging catalogue subcategories readable"
  ON public.snagging_catalogue_subcategories FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS "snagging catalogue defects readable"
  ON public.snagging_catalogue_defects;
CREATE POLICY "snagging catalogue defects readable"
  ON public.snagging_catalogue_defects FOR SELECT TO authenticated USING (TRUE);

-- ---------------------------------------------------------------------
-- 5. The applicability matrix, marked retired
-- ---------------------------------------------------------------------

-- P2: every category applies in every area, so nothing narrows a defect
-- list by area any more.
--
-- The matrix is NOT cleared here, deliberately. It lives as the
-- `element_codes` array on snagging_catalogue_areas, and the capture
-- screens still read it until the new pickers ship — emptying it now would
-- leave inspectors with no defect list at all between this migration and
-- that release. It stops being read when the pickers change; the column
-- goes in a later migration once nothing references it.
--
-- Guarded on existence because these legacy objects differ per
-- environment: the join table this originally targeted was already dropped
-- in the lean-schema refactor, and an unguarded statement fails the whole
-- migration on any database that has moved on.

DO $$
BEGIN
  IF to_regclass('public.snagging_catalogue_areas') IS NOT NULL THEN
    COMMENT ON TABLE public.snagging_catalogue_areas IS
      'Areas kept (Action Points P4). The element_codes column is retired '
      'as of 2026-09-10 (P2): every category now applies in every area. '
      'The column is dropped once the capture screens stop reading it.';
  END IF;

  IF to_regclass('public.snagging_catalogue_entries') IS NOT NULL THEN
    COMMENT ON TABLE public.snagging_catalogue_entries IS
      'Superseded 2026-09-10 by snagging_catalogue_categories / '
      '_subcategories / _defects (Action Points P1). Kept for one release '
      'so a bad seed can be rolled back without a restore.';
  END IF;

  IF to_regclass('public.snagging_catalogue_area_elements') IS NOT NULL THEN
    EXECUTE 'TRUNCATE TABLE public.snagging_catalogue_area_elements';
  END IF;
END $$;
