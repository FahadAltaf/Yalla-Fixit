-- The gate pass for a job: the permit building security asks for before the
-- inspector is let on site. Uploaded by the office from the job, opened by
-- the inspector on the phone, the same way the NOC is.
--
-- On the job rather than the property (where the NOC lives): a gate pass is
-- issued for one trip, so the next job on the same unit needs its own.
alter table public.snagging_jobs
  add column if not exists gatepass_path text;

comment on column public.snagging_jobs.gatepass_path is
  'Storage key of the job''s gate pass in the private snagging bucket; null when none is on file.';
