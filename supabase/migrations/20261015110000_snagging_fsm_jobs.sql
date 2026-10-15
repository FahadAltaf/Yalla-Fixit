-- The completed job in Zoho FSM (SNG-189), for databases that applied
-- 20261014100000_snagging_fsm_quotation_sync before its job columns were
-- added to it. Same columns, all "if not exists", so it is a no-op where
-- that migration already has them.
--
-- Without job_id on the sync log, every log row failed to write (the sync
-- names that column), so failures had no trace (SNG-191).
--
-- Live-safe: nullable columns and an index; nothing existing is rewritten.

alter table public.snagging_jobs
  add column if not exists fsm_work_order_id text,
  add column if not exists fsm_work_order_number text,
  add column if not exists fsm_status text,
  add column if not exists fsm_report_version integer,
  add column if not exists fsm_synced_at timestamptz,
  add column if not exists fsm_error text,
  add column if not exists fsm_lock_until timestamptz,
  add column if not exists fsm_dirty boolean not null default false;

alter table public.snagging_fsm_sync_log
  add column if not exists job_id uuid references public.snagging_jobs(id) on delete cascade;

create index if not exists snagging_fsm_sync_log_job_idx
  on public.snagging_fsm_sync_log (job_id, created_at desc);
