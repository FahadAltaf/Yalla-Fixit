-- =====================================================================
-- Site visit approval: an approver, and property changes held until then
-- =====================================================================
-- A site visit is booked with an approver (someone with AMC approval
-- rights). The inspector records the visit and completes it on the mobile
-- app; the scope and asset changes they make there no longer go straight
-- onto the property but wait here until the approver approves the visit.
-- The approver can instead send it back, with a reason, to the inspector.
--
--   1. amc_assessments: approver_id / approver_name (who approves),
--      approved_at / approved_by (when it was approved), sent_back_at /
--      sent_back_reason (the last time it was sent back, and why).
--      Additive, all nullable: existing site visits are unaffected.
--   2. amc_site_visit_changes: one row per asset or scope item a site visit
--      adds, changes or removes, holding its net change (an add then an
--      edit is one add; an add then a removal is nothing). Applied to the
--      property on approval (applied_at). Server only: no grants to anon or
--      authenticated, RLS on with no policies.
--   3. amc_assessments_locked(): a completed visit may now go back to draft
--      (sent back) while it is not approved, and an approval, once given,
--      cannot be undone. Everything it refused before it still refuses.
--
-- Live-safe: new nullable columns, a new empty table, and a trigger that
-- refuses one thing less (sending back) and one thing more (undoing an
-- approval). No data is changed. Safe to run twice.
-- =====================================================================

ALTER TABLE public.amc_assessments
  ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approver_name text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_back_reason text;

CREATE INDEX IF NOT EXISTS idx_amc_assessments_approver
  ON public.amc_assessments (approver_id)
  WHERE approver_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.amc_site_visit_changes (
  assessment_id uuid NOT NULL REFERENCES public.amc_assessments(id) ON DELETE CASCADE,
  entity text NOT NULL CHECK (entity IN ('asset', 'scope')),
  -- The asset's or scope item's id (a new one keeps the id the phone gave it).
  target_id uuid NOT NULL,
  op text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  -- The asset or scope item as the inspector left it (empty for a removal).
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  applied_at timestamptz,
  PRIMARY KEY (assessment_id, entity, target_id)
);

ALTER TABLE public.amc_site_visit_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.amc_site_visit_changes FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.amc_assessments_locked()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'completed' THEN
      RAISE EXCEPTION 'A completed assessment cannot be deleted' USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  /* An approval stands: it is never taken back or changed. */
  IF OLD.approved_at IS NOT NULL AND (
       NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'An approved site visit cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  /* Sent back by its approver: a completed visit not yet approved goes back to draft. */
  IF OLD.status = 'completed' AND NEW.status = 'draft' AND OLD.approved_at IS NULL AND NEW.completed_at IS NULL THEN
    RETURN NEW;
  END IF;
  /* Once completed, only the link to the proposal created from it (and the approval) may be set. */
  IF OLD.status = 'completed' AND (
       NEW.status IS DISTINCT FROM OLD.status
    OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
    OR NEW.property_id IS DISTINCT FROM OLD.property_id
    OR NEW.assessed_on IS DISTINCT FROM OLD.assessed_on
    OR NEW.recommended_service_ids IS DISTINCT FROM OLD.recommended_service_ids
    OR NEW.summary IS DISTINCT FROM OLD.summary
    OR NEW.findings IS DISTINCT FROM OLD.findings
    OR NEW.notes IS DISTINCT FROM OLD.notes
    OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'A completed assessment cannot be changed' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.amc_assessments_locked() FROM PUBLIC, anon, authenticated;

-- Check:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'amc_assessments' AND column_name IN ('approver_id', 'approved_at', 'sent_back_reason');
--   SELECT count(*) FROM public.amc_site_visit_changes;  -- 0
--
-- Undo:
--   DROP TABLE IF EXISTS public.amc_site_visit_changes;
--   ALTER TABLE public.amc_assessments
--     DROP COLUMN IF EXISTS approver_id, DROP COLUMN IF EXISTS approver_name,
--     DROP COLUMN IF EXISTS approved_at, DROP COLUMN IF EXISTS approved_by,
--     DROP COLUMN IF EXISTS sent_back_at, DROP COLUMN IF EXISTS sent_back_reason;
--   (and re-run the amc_assessments_locked() body from 20261006130000)
