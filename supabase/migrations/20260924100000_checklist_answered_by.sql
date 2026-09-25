-- Who answered each checklist item (2026-09-24).
--
-- Several inspectors share a job now, and the checklist is shared between
-- them: one inspector ticking an item "Checked" or "Not checked" answers it
-- for the job. Nothing recorded who, so the phone could not say "Checked by
-- Test User", and a reviewer could not tell whose answer they were reading.
--
-- Additive and nullable: answers given before this carry no answerer and
-- read as unattributed; everything answered from the app after it is
-- stamped by the sync push. No backfill -- the audit trail only ever
-- recorded skipped items, so there is nothing reliable to fill from.

alter table public.snagging_job_checklist
  add column if not exists answered_by uuid
    references public.user_profile (id) on delete set null,
  add column if not exists answered_at timestamptz;

-- The item's history of answers is not kept; this is the latest answerer.
comment on column public.snagging_job_checklist.answered_by is
  'The inspector whose answer the item currently holds (set by the app sync).';
