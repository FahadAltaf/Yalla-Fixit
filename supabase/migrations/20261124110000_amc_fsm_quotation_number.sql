-- DEV-508 (24 Nov 2026): the FSM quotation number on chargeable call outs and
-- additional work.
--
-- A small chargeable call out (no parts, under 2 hours) may go ahead once the
-- client confirms on WhatsApp, with no quotation before the visit. Finance
-- still cannot record the revenue or issue the tax invoice without a
-- quotation number, so the coordinator prepares the quotation in Zoho FSM
-- afterwards and records its number here. The portal requires it before a
-- chargeable call out is closed or additional work is completed.
--
-- Only a field: nothing is sent to or read from FSM.
--
-- Live-safe: two nullable columns, no data changed. Until it is applied the
-- portal neither shows nor requires the number.

alter table public.amc_call_outs
  add column if not exists fsm_quotation_no text,
  add column if not exists fsm_quotation_at timestamptz,
  add column if not exists fsm_quotation_by uuid references public.user_profile(id) on delete set null;

alter table public.amc_additional_works
  add column if not exists fsm_quotation_no text,
  add column if not exists fsm_quotation_at timestamptz,
  add column if not exists fsm_quotation_by uuid references public.user_profile(id) on delete set null;

comment on column public.amc_call_outs.fsm_quotation_no is
  'DEV-508: the Zoho FSM quotation number, recorded by the coordinator; required before a chargeable call out is closed.';
comment on column public.amc_additional_works.fsm_quotation_no is
  'DEV-508: the Zoho FSM quotation number, recorded by the coordinator; required before the work is completed.';

notify pgrst, 'reload schema';
