-- Report generation lifecycle and version snapshots (FR-7.01 → FR-7.08).
--
-- `snagging_report_versions` already records that a version was issued and
-- which snags it contained. Generation itself was never modelled: there was
-- no way to say whether a PDF exists, where it is, whether generation failed,
-- or what the document actually said at the time it was sent.
--
-- Everything here is additive and nullable. Existing version rows were
-- issued by a working flow and stay valid; they are backfilled as
-- 'generated' with no file, which is exactly what they are.

alter table public.snagging_report_versions
  -- FR-7.07 / FR-7.08 — what kind of document this version is. An
  -- inspection's own report, a single de-snag round's findings, or the
  -- cumulative state across the whole family.
  add column if not exists report_type text not null default 'inspection'
    check (report_type in ('inspection', 'round', 'cumulative')),

  -- The de-snag round this version reports on. Null for everything else.
  -- `source_visit_id` already carries the additional-visit case, and the two
  -- are deliberately separate columns: a round and a visit are different
  -- things and conflating them is the mistake the BRD warns about.
  add column if not exists source_round_id uuid
    references public.snagging_jobs (id) on delete set null,

  -- FR-7.01 — the generation lifecycle. A version row is created the moment
  -- approval lands, so it must be able to say "not rendered yet" and
  -- "rendering failed" rather than implying a PDF exists.
  add column if not exists generation_status text not null default 'generated'
    -- 'generating' is the claim a renderer takes before it starts work, so a
    -- retry or a concurrent sweep finds nothing to pick up. Leaving it out of
    -- this list made the claim itself violate the constraint, which meant no
    -- report could ever be rendered: every attempt failed before it began.
    check (generation_status in ('pending', 'generating', 'generated', 'failed')),
  add column if not exists generation_error text,
  add column if not exists generated_ms integer,

  -- Where the rendered PDF lives in the `snagging` bucket. Null while
  -- pending, and for historical rows that were only ever rendered on demand.
  add column if not exists pdf_path text,

  /*
    FR-7.02 / immutability — what the document said when it was issued.

    A report version has to stay reproducible: re-deriving a six-month-old
    report from live rows would show today's catalogue wording, today's
    severities and today's property record against a document the client is
    holding a printout of. The snapshot is the answer to "what did we
    actually send", and the renderers read it in preference to live data.
  */
  add column if not exists snapshot jsonb;

-- One live document per (job, type, round). Two coordinators approving at
-- once cannot mint two version 2s; the existing (job_id, version) unique
-- index already covers the numbering itself.
create index if not exists idx_snagging_report_versions_type
  on public.snagging_report_versions (job_id, report_type, version desc);

-- FR-7.05 — a link belongs to a version, not just to a job, so revoking or
-- expiring one version's link cannot silently take another version with it.
alter table public.snagging_report_tokens
  add column if not exists version_id uuid
    references public.snagging_report_versions (id) on delete cascade;

create index if not exists idx_snagging_report_tokens_version
  on public.snagging_report_tokens (version_id);

-- The public route looks a token up by hash on every open; it was relying on
-- the unique constraint's index, which is correct but leaves the open-count
-- update doing a second lookup.
create index if not exists idx_snagging_report_tokens_hash
  on public.snagging_report_tokens (token_hash);

-- FR-10.01 / FR-10.02 — the analytics aggregations all filter on a status
-- and group by one of these timestamps. Without these each dashboard card
-- is a sequential scan of the jobs table.
create index if not exists idx_snagging_jobs_delivered
  on public.snagging_jobs (delivered_at)
  where delivered_at is not null;

create index if not exists idx_snagging_jobs_approved
  on public.snagging_jobs (approved_at)
  where approved_at is not null;

create index if not exists idx_snagging_jobs_developer
  on public.snagging_jobs (developer_name, status);

create index if not exists idx_snagging_jobs_inspector_status
  on public.snagging_jobs (inspector_id, status);
