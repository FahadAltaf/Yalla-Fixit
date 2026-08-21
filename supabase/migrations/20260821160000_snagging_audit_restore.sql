-- Restore the snagging audit trail (BR-5, §5.3).
--
-- The append-only audit table was defined in the original module migration
-- but the application-layer writer was later stubbed out, so nothing has
-- been recorded. This re-establishes the table (idempotently — it may
-- already exist) and the append-only guard, and the app-layer recordAudit
-- is wired to write to it.
--
-- No FK to snagging_jobs: the snagging_tasks -> snagging_jobs rename
-- happened out of band, so a hard FK here would be fragile. task_id simply
-- holds the job id.

create table if not exists public.snagging_audit_events (
  id bigserial primary key,
  entity_type text not null,
  entity_id uuid,
  task_id uuid,
  event_type text not null,
  actor_id uuid,
  actor_label text,
  origin text not null default 'portal',
  justification text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_snagging_audit_task
  on public.snagging_audit_events (task_id, created_at desc);
create index if not exists idx_snagging_audit_entity
  on public.snagging_audit_events (entity_type, entity_id, created_at desc);

-- Append-only: a recorded event can never be edited or removed, even by
-- the service role (rules apply below RLS). CREATE OR REPLACE is safe
-- whether or not the rules already exist.
create or replace rule snagging_audit_events_no_update as
  on update to public.snagging_audit_events do instead nothing;
create or replace rule snagging_audit_events_no_delete as
  on delete to public.snagging_audit_events do instead nothing;

alter table public.snagging_audit_events enable row level security;
