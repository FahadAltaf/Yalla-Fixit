-- ---------------------------------------------------------------------
-- The foreign key the catalogue restructure left behind.
--
-- `snagging_snags.catalogue_entry_id` has pointed at
-- `snagging_catalogue_entries` since the module was created. On
-- 2026-09-10 the catalogue was restructured into three tables —
-- categories / subcategories / defects — and the old table was kept only
-- "for one release so a bad seed can be rolled back". The FK was never
-- moved with it.
--
-- The handset pulls its catalogue from the NEW tables, so the id it
-- sends on every capture is a `snagging_catalogue_defects.id`. The
-- insert is then checked against a table that id was never in, and the
-- server refuses it:
--
--   insert or update on table "snagging_snags" violates foreign key
--   constraint "snagging_snags_catalogue_entry_id_fkey"
--
-- Every snag classified from the restructured catalogue has been refused
-- on push since that day, permanently — a retry can never succeed,
-- because nothing about the row is going to change. The inspector sees
-- "Failed to send" on work that is already on their phone and correct.
--
-- Repointed rather than dropped: the id is worth constraining, it is
-- what ties a snag to the defect it was classified as. RESTRICT stays so
-- a hard delete of a defect cannot orphan an issued report; the ordinary
-- way to retire one is `active = false`, which this does not touch.
--
-- NOT VALID, then validated separately: the existing rows are a mix of
-- pre-restructure ids (which point at the old table and would fail) and
-- post-restructure ones. NOT VALID enforces the constraint on every new
-- insert and update from here — which is the thing that is broken —
-- without a full-table scan that would fail on history nobody can fix.
-- ---------------------------------------------------------------------

ALTER TABLE public.snagging_snags
  DROP CONSTRAINT IF EXISTS snagging_snags_catalogue_entry_id_fkey;

DO $$
BEGIN
  IF to_regclass('public.snagging_catalogue_defects') IS NULL THEN
    RAISE EXCEPTION
      'snagging_catalogue_defects is missing; run the catalogue v2 migration first';
  END IF;
END $$;

ALTER TABLE public.snagging_snags
  ADD CONSTRAINT snagging_snags_catalogue_entry_id_fkey
  FOREIGN KEY (catalogue_entry_id)
  REFERENCES public.snagging_catalogue_defects(id)
  ON DELETE RESTRICT
  NOT VALID;

COMMENT ON COLUMN public.snagging_snags.catalogue_entry_id IS
  'The defect this snag was classified as, in snagging_catalogue_defects. '
  'Repointed 2026-09-17: it referenced the superseded '
  'snagging_catalogue_entries table, which rejected every capture the '
  'handset made from the restructured catalogue.';
