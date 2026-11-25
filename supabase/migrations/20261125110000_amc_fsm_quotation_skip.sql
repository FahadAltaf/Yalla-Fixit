-- 25 Nov 2026 (the user, on DEV-508): a chargeable call out or additional
-- work can be closed without its FSM quotation number, with a reason:
--
--   not_chargeable  the client is not charged after all: no quotation needed
--   later           the client is charged, the quotation number follows and
--                   is added on the job when it is ready
--
-- The choice, the reason, who and when are kept with the job (and in its
-- history). Nothing goes to Zoho FSM.
--
-- Live-safe: four nullable columns on each table, no data changed. Until it
-- is applied, closing this way still works and the reason is kept in the
-- job's history only.

alter table public.amc_call_outs
  add column if not exists fsm_quotation_skip text
    check (fsm_quotation_skip is null or fsm_quotation_skip in ('not_chargeable', 'later')),
  add column if not exists fsm_quotation_skip_reason text,
  add column if not exists fsm_quotation_skip_at timestamptz,
  add column if not exists fsm_quotation_skip_by uuid references public.user_profile(id) on delete set null;

alter table public.amc_additional_works
  add column if not exists fsm_quotation_skip text
    check (fsm_quotation_skip is null or fsm_quotation_skip in ('not_chargeable', 'later')),
  add column if not exists fsm_quotation_skip_reason text,
  add column if not exists fsm_quotation_skip_at timestamptz,
  add column if not exists fsm_quotation_skip_by uuid references public.user_profile(id) on delete set null;

comment on column public.amc_call_outs.fsm_quotation_skip is
  'Closed without the FSM quotation number: not_chargeable (no charge after all) or later (the number follows). Null: closed with the number, or none was needed.';
comment on column public.amc_additional_works.fsm_quotation_skip is
  'Completed without the FSM quotation number: not_chargeable (no charge after all) or later (the number follows). Null: completed with the number, or none was needed.';

notify pgrst, 'reload schema';
