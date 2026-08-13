-- =====================================================
-- Migration: Allow multiple appointments per work order
-- Description: A work order with several service lines legitimately needs
--              more than one appointment (e.g. one per line, created across
--              revisions). The old partial unique index blocked a second
--              "new_appointment" entry for the same work order, producing
--              "this appointment or work order is already on the schedule".
--              Uniqueness is instead enforced per service line in the API
--              (a given line can't be scheduled twice).
-- =====================================================

DROP INDEX IF EXISTS public.idx_schedule_entries_unique_pending_work_order_per_version;

-- The existing appointment-level uniqueness (one FSM appointment per version)
-- stays in place -- that one is still correct.
