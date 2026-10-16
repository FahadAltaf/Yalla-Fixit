-- Snagging quotations and completed jobs in Zoho FSM (YFI Snagging - Zoho FSM
-- APIs for Quotations; UAT SNG-187 to 191).
--
-- A snagging quotation is mirrored into FSM as an Estimate: the client is
-- found or created as an FSM Contact (and Company, for a business), the
-- quotation is created with one service line per portal line, and its
-- sent / approved / rejected status follows the portal's. Every call is
-- logged, and a failed one can be retried from the quotation page. An
-- approved job is created as an FSM Work Order, completed, and given the
-- client report as an attachment, so finance can invoice from FSM.
--
-- Live-safe: nullable columns, one jsonb column with a default, and one
-- new table. Nothing existing is rewritten, and the portal checks for
-- these columns before it uses them, so the code can deploy first. The
-- sync itself stays off until SNAGGING_FSM_SYNC=on is set.

-- The FSM records a portal client is linked to.
alter table public.snagging_clients
  add column if not exists fsm_contact_id text,
  add column if not exists fsm_company_id text;

-- The FSM estimate a quotation is mirrored as, and where its sync stands.
alter table public.snagging_quotations
  add column if not exists fsm_estimate_id text,
  add column if not exists fsm_estimate_number text,
  -- "<id>_<number>" of the first estimate, for the revision fields.
  add column if not exists fsm_root_ref text,
  -- FSM's own Status for the estimate, as last read.
  add column if not exists fsm_status text,
  -- A fingerprint of the lines and total last sent, to tell an edit apart.
  add column if not exists fsm_synced_hash text,
  add column if not exists fsm_synced_at timestamptz,
  add column if not exists fsm_error text,
  -- One sync at a time per quotation; a request during one is re-run after.
  add column if not exists fsm_lock_until timestamptz,
  add column if not exists fsm_dirty boolean not null default false;

-- The FSM work order an approved job is completed as, with its report
-- attached for invoicing (SNG-189), and where that sync stands.
alter table public.snagging_jobs
  add column if not exists fsm_work_order_id text,
  add column if not exists fsm_work_order_number text,
  add column if not exists fsm_status text,
  -- The report version last attached to the work order.
  add column if not exists fsm_report_version integer,
  add column if not exists fsm_synced_at timestamptz,
  add column if not exists fsm_error text,
  add column if not exists fsm_lock_until timestamptz,
  add column if not exists fsm_dirty boolean not null default false;

-- Which FSM service each kind of quotation line is sent as: found by name in
-- FSM's Services and Parts on the first sync, and the ids kept here.
alter table public.snagging_pricing_config
  add column if not exists fsm_services jsonb not null default '{}'::jsonb;

-- Every FSM call the quotation sync makes, success or failure (SNG-191).
create table if not exists public.snagging_fsm_sync_log (
  id bigserial primary key,
  quotation_id uuid references public.snagging_quotations(id) on delete cascade,
  client_id uuid references public.snagging_clients(id) on delete set null,
  job_id uuid references public.snagging_jobs(id) on delete cascade,
  action text not null,
  status text not null check (status in ('success', 'failed', 'skipped')),
  fsm_record_id text,
  message text,
  detail jsonb,
  actor_id uuid references public.user_profile(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_snagging_fsm_sync_log_quotation
  on public.snagging_fsm_sync_log (quotation_id, created_at desc);
create index if not exists idx_snagging_fsm_sync_log_job
  on public.snagging_fsm_sync_log (job_id, created_at desc);

-- Written and read through the service-role API only, like the rest of
-- the snagging tables.
alter table public.snagging_fsm_sync_log enable row level security;

comment on table public.snagging_fsm_sync_log is
  'Each Zoho FSM call made by the snagging quotation sync, with its outcome.';
