-- The inspector's comment on a de-snag verdict ("fixed, but the grout is a
-- shade darker"), kept on the round's snag beside the verdict it explains.
--
-- It could not go in `note`: a round's snag is a copy of the defect and
-- carries the original note the client report quotes, and a verdict
-- comment is a different sentence by a different visit. Until now the
-- phone sent it and the server only wrote it into the audit trail.
--
-- The app checks for this column and simply stores and shows nothing until
-- it exists, so the code can deploy first.

alter table public.snagging_snags
  add column if not exists verdict_note text;

comment on column public.snagging_snags.verdict_note is
  'Inspector comment on the de-snag verdict for this round''s copy of the defect. Editable from the portal.';
