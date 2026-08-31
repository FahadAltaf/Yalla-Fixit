-- Tokenised client report links (FR-5.04 to FR-5.06).
--
-- A coordinator can hand a client a link that opens the snagging report
-- without a login. The token is random and stored only as a SHA-256 hash,
-- so a leak of this table cannot reconstruct a working link. The report
-- data itself is fetched fresh each time the link is opened (with
-- short-lived signed photo URLs), so nothing sensitive is baked into the
-- link — matching the private-media stance elsewhere in the module.
--
-- The table is service-role only: RLS is on with no policies, so the anon
-- and authenticated keys cannot read it. Only the server (service role,
-- which bypasses RLS) validates a presented token against the hash.

create table if not exists public.snagging_report_tokens (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.snagging_jobs(id) on delete cascade,
  token_hash text not null unique,
  token_hint text,
  channel text not null default 'email',
  recipient text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  opened_at timestamptz,
  last_opened_at timestamptz,
  open_count integer not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists idx_snagging_report_tokens_job
  on public.snagging_report_tokens (job_id);

alter table public.snagging_report_tokens enable row level security;
