-- DEV-489 / DEV-392 (25 Nov 2026): AMC work on the one Scheduling board.
--
-- An AMC PPM visit, call out or additional work that has a crew and a time
-- appears on the Scheduling board as an entry tagged AMC, with its contract
-- and visit type, so the board shows every technician's real day and a
-- technician placed by AMC no longer looks free there.
--
-- The entry is a free_text entry (no FSM work order or appointment), so
-- publishing a day never sends it to Zoho FSM: AMC jobs are done in the YFI
-- app (the user's decision, 25 Nov 2026). The AMC record stays the source
-- of truth; the portal writes, moves and removes the entry when the AMC
-- record's crew, time or status changes.
--
-- Live-safe: six nullable columns and two indexes, no data changed. Until it
-- is applied the portal writes no AMC entries and the board is as before.

alter table public.schedule_entries
  add column if not exists amc_kind text
    check (amc_kind is null or amc_kind in ('ppm', 'call_out', 'additional_work')),
  add column if not exists amc_record_id uuid,
  add column if not exists amc_contract_id uuid,
  add column if not exists amc_visit_type text,
  add column if not exists amc_ref text;

comment on column public.schedule_entries.amc_kind is
  'DEV-489: the AMC record this entry shows (ppm visit, call out, additional work). Null: an ordinary entry.';
comment on column public.schedule_entries.amc_record_id is
  'DEV-489: the AMC record''s id (amc_visits, amc_call_outs or amc_additional_works).';
comment on column public.schedule_entries.amc_visit_type is
  'DEV-489: what the board shows as the job type: PPM visit, Emergency call out, Handyman job, Additional work.';
comment on column public.schedule_entries.amc_ref is
  'DEV-489: the AMC reference shown on the board (visit, call out or work number).';

-- One entry per AMC record in a day's version.
create unique index if not exists idx_schedule_entries_amc_record_per_version
  on public.schedule_entries (schedule_version_id, amc_kind, amc_record_id)
  where amc_kind is not null;

create index if not exists idx_schedule_entries_amc_record
  on public.schedule_entries (amc_kind, amc_record_id)
  where amc_kind is not null;

-- DEV-393 (25 Nov 2026): an entry moved to another day on the Scheduling
-- board keeps the day it was first planned for, so the board can say "moved
-- from" and adherence can be judged against it. Null: never moved.
alter table public.schedule_entries
  add column if not exists original_operating_date date;

comment on column public.schedule_entries.original_operating_date is
  'DEV-393: the day the entry was first planned for, set when it is first moved to another day. Null: not moved.';

notify pgrst, 'reload schema';
