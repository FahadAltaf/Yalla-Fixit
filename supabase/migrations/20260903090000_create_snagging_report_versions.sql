-- Report versioning for additional snagging visits (Module 9).
--
-- The client gets ONE report per inspection, reissued as a new version
-- each time an additional visit adds snags to it — not a second document
-- per visit. Nothing in the schema recorded that today: a report was
-- generated on demand from whatever the job currently held, so the
-- version a client was sent last month could not be reproduced, and
-- "which snags were in V1" had no answer.
--
-- One row per issued version. Append-only by intent: a superseded version
-- is never deleted or edited, because it is what a client actually
-- received and may be holding a printout of.

create table if not exists public.snagging_report_versions (
  id uuid primary key default gen_random_uuid(),

  -- Always the ORIGINAL inspection, never a visit or a round. Versions
  -- belong to the inspection's report, which is the thing the client has.
  job_id uuid not null references public.snagging_jobs (id) on delete cascade,

  -- 1, 2, 3 … in issue order. Unique per inspection so two coordinators
  -- cannot mint the same version number concurrently.
  version integer not null,

  -- The additional visit whose snags caused this reissue. Null for V1,
  -- which is the original inspection's own report.
  source_visit_id uuid references public.snagging_jobs (id) on delete set null,

  -- What the version contained, so an old version can be explained
  -- without re-deriving it from rows that have since changed.
  snag_count integer not null default 0,
  snag_ids uuid[] not null default '{}',

  generated_at timestamptz not null default now(),
  generated_by uuid references public.user_profile (id) on delete set null,

  -- Why it was reissued, in the words shown in the version history.
  reason text,

  created_at timestamptz not null default now()
);

create unique index if not exists idx_snagging_report_versions_job_version
  on public.snagging_report_versions (job_id, version);

-- The version list is always read for one inspection, newest first.
create index if not exists idx_snagging_report_versions_job
  on public.snagging_report_versions (job_id, version desc);

alter table public.snagging_report_versions enable row level security;

-- Matches the rest of the snagging tables: the application reaches these
-- through the service role, which bypasses RLS, and no anon/authenticated
-- policy is granted. Enabling RLS with no policy is the deny-by-default
-- posture the other snagging tables already use.
