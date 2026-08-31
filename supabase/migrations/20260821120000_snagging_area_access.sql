-- Area access states (R1-R6 / J3).
--
-- An inspector can record that a room could not be entered at all
-- (not_accessible) or could only be partly inspected (limited_access),
-- each with a reason. A not-accessible room is a valid terminal state:
-- it is signed off on the day (its reason standing in for a walkthrough)
-- and must not block submission. The reason is what the report shows in
-- place of, or alongside, the inspection notes.

alter table public.snagging_areas
  add column if not exists access_state text not null default 'accessible',
  add column if not exists access_reason text;

-- Guard the vocabulary. Added separately so re-running the migration on a
-- table that already has the column is safe.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'snagging_areas_access_state_check'
  ) then
    alter table public.snagging_areas
      add constraint snagging_areas_access_state_check
      check (access_state in ('accessible', 'not_accessible', 'limited_access'));
  end if;
end $$;
