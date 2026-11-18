-- =====================================================================
-- Visit and site visit photos: a category, and a description that can
-- be changed
-- =====================================================================
-- The mobile app asks for each photo's category (Equipment, Work done,
-- Fault, ... or a name the technician types under "Other") and its
-- description when it is taken, and lets them change both while the job
-- sheet or site visit is still being filled in.
--
--   1. amc_visit_photos.category and amc_assessment_photos.category: new,
--      nullable text (older photos have none), up to 60 characters.
--      Additive. A planned visit photo keeps its kind (fault / other ...)
--      as before; the category is the name shown with it.
--   2. amc_assessment_photos_locked(): an UPDATE was refused outright, so a
--      site visit photo's description could never be changed. It now
--      allows a change to the caption or category only, and only while the
--      assessment is not completed; the file, its path, size and hash stay
--      fixed as before. Inserts and deletes are checked exactly as before.
--
-- Live-safe: two nullable columns, and a trigger function that refuses
-- less than it did. No data is changed. Safe to run twice.
-- =====================================================================

ALTER TABLE public.amc_visit_photos
  ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.amc_assessment_photos
  ADD COLUMN IF NOT EXISTS category text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'amc_visit_photos_category_check'
       AND conrelid = 'public.amc_visit_photos'::regclass
  ) THEN
    ALTER TABLE public.amc_visit_photos
      ADD CONSTRAINT amc_visit_photos_category_check
      CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'amc_assessment_photos_category_check'
       AND conrelid = 'public.amc_assessment_photos'::regclass
  ) THEN
    ALTER TABLE public.amc_assessment_photos
      ADD CONSTRAINT amc_assessment_photos_category_check
      CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.amc_assessment_photos_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  st text;
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.id IS DISTINCT FROM OLD.id
    OR NEW.assessment_id IS DISTINCT FROM OLD.assessment_id
    OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
    OR NEW.content_type IS DISTINCT FROM OLD.content_type
    OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
    OR NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'An assessment photo''s file cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  SELECT status INTO st FROM public.amc_assessments
   WHERE id = COALESCE(NEW.assessment_id, OLD.assessment_id);
  IF st = 'completed' THEN
    RAISE EXCEPTION 'A completed assessment''s photos cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
REVOKE ALL ON FUNCTION public.amc_assessment_photos_locked() FROM PUBLIC, anon, authenticated;
