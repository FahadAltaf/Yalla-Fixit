-- =====================================================================
-- Call out and additional work photos: a category
-- =====================================================================
-- The mobile app now fills in call outs and additional work, and asks
-- each photo's category (Equipment, Fault, Work done ... or a name typed
-- under "Other") when it is taken, as it does for planned and site visits
-- (20261113100000 added the same column to those photo tables).
--
--   amc_work_photos.category: new, nullable text (older photos have none),
--   up to 60 characters. Additive; the photo keeps its kind as before.
--
-- Live-safe: one nullable column and its check. No data is changed. Safe
-- to run twice. Until it is applied, the app's photos still upload (the
-- server writes them without the category).
-- =====================================================================

ALTER TABLE public.amc_work_photos
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'amc_work_photos_category_check'
       AND conrelid = 'public.amc_work_photos'::regclass
  ) THEN
    ALTER TABLE public.amc_work_photos
      ADD CONSTRAINT amc_work_photos_category_check
      CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60);
  END IF;
END $$;
