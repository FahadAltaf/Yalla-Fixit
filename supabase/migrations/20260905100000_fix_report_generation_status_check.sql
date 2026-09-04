-- Lets a report render actually start.
--
-- `generateReportPdf` claims a version row by setting generation_status to
-- 'generating' before it opens a browser, so a retry or a concurrent sweep
-- finds nothing to pick up and stops. The check constraint added with the
-- column only allowed ('pending', 'generated', 'failed'), so that claim
-- violated it every single time.
--
-- The effect was total and silent: the claim is the first write generation
-- makes, so it failed before any rendering began, the function returned an
-- error, and the row was left sitting at 'pending' with no recorded failure.
-- Approving an inspection issued Version 1 and then produced no PDF, with
-- nothing on the row to say why. Retrying hit the identical wall.
--
-- Recreated rather than patched: a check constraint cannot be widened in
-- place. Named explicitly so this stays idempotent against the corrected
-- 20260905090000, which now creates the constraint with the full set — on a
-- fresh database the drop finds the right constraint and re-adds the same one.

alter table public.snagging_report_versions
  drop constraint if exists snagging_report_versions_generation_status_check;

alter table public.snagging_report_versions
  add constraint snagging_report_versions_generation_status_check
    check (generation_status in ('pending', 'generating', 'generated', 'failed'));

-- A row that was claimed while the constraint was in place could never have
-- been written, so nothing is stranded in 'generating' and no data repair is
-- needed here. Rows left at 'pending' by the failure are already in the state
-- a retry picks up.
