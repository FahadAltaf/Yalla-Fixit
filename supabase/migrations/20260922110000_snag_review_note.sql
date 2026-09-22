-- A note from the reviewer or approver to the inspector, on one snag.
--
-- The office could only rewrite the inspector's own note, which then went
-- into the client's report. A note meant for the inspector ("re-shoot this
-- from further back", "check the other door too") has nowhere to go but
-- here: it is shown on the inspector's phone and never printed on the
-- report.

ALTER TABLE public.snagging_snags
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS review_note_by uuid REFERENCES public.user_profile(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note_at timestamptz;

COMMENT ON COLUMN public.snagging_snags.review_note IS
  'Reviewer/approver note to the inspector. Shown on the phone, not on the client report.';
