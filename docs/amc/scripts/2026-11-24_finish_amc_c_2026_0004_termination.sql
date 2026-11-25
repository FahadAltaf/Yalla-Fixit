-- Finish the early termination of AMC-C-2026-0004 (24 Nov 2026).
--
-- The termination was applied before the portal did these two things on
-- applying (it does now, lib/server/amc/amendments.ts):
--
--   1. the visits after the last day (24 Dec 2026) come off the schedule;
--   2. the unpaid instalments due after it are waived, so the client is not
--      reminded or chased for money the contract no longer asks for;
--   3. the allowances are fitted to what is left: each service keeps the
--      visits still planned before 24 Dec 2026 (never below what is used).
--      Coverage then shows those, not the full three years.
--
-- The contract itself stays Active until 24 Dec 2026 and becomes
-- Terminated on that day (when it is next opened, or by the daily job).
-- Instalments with money already received, and anything due on or before
-- 24 Dec 2026, are left as they are.
--
-- Run PART 1, check the counts (62 visits and 34 instalments when written),
-- then PART 2.

-- PART 1: look -----------------------------------------------------------
select c.contract_number, c.status, c.termination_notice_on, c.termination_effective_on,
       (select count(*) from public.amc_visits v
         where v.contract_id = c.id and v.window_start >= c.termination_effective_on
           and v.status in ('not_scheduled', 'scheduled', 'rescheduled', 'confirmed', 'pending_access')) as visits_to_cancel,
       (select count(*) from public.amc_instalments i
         where i.contract_id = c.id and i.due_date > c.termination_effective_on
           and i.received_amount = 0 and i.status not in ('received', 'written_off', 'waived')) as instalments_to_waive
from public.amc_contracts c
where c.contract_number = 'AMC-C-2026-0004';

-- PART 2: change ---------------------------------------------------------
begin;

update public.amc_visits v
   set status = 'cancelled',
       status_reason = 'Contract ends 2026-12-24 (early termination)',
       updated_at = now()
  from public.amc_contracts c
 where c.contract_number = 'AMC-C-2026-0004'
   and v.contract_id = c.id
   and v.window_start >= c.termination_effective_on
   and v.status in ('not_scheduled', 'scheduled', 'rescheduled', 'confirmed', 'pending_access');

update public.amc_instalments i
   set status = 'waived',
       status_reason = 'Not owed: the contract ends 2026-12-24 (early termination)',
       status_changed_at = now()
  from public.amc_contracts c
 where c.contract_number = 'AMC-C-2026-0004'
   and i.contract_id = c.id
   and i.due_date > c.termination_effective_on
   and i.received_amount = 0
   and i.status not in ('received', 'written_off', 'waived');

-- 3. Allowances: the visits each service still has planned before the last day.
update public.amc_contract_entitlements e
   set included_quantity = greatest(e.used_quantity + e.reserved_quantity, k.kept)
  from (
    select l.entitlement_id,
           count(*) filter (where l.status <> 'cancelled' and v.status <> 'cancelled') as kept
      from public.amc_visit_lines l
      join public.amc_visits v on v.id = l.visit_id
      join public.amc_contracts c on c.id = l.contract_id
     where c.contract_number = 'AMC-C-2026-0004'
     group by l.entitlement_id
  ) k
 where e.id = k.entitlement_id
   and e.entitlement_type in ('visits', 'hours');

-- Expect 0 and 0 now.
select
  (select count(*) from public.amc_visits v join public.amc_contracts c on c.id = v.contract_id
    where c.contract_number = 'AMC-C-2026-0004' and v.window_start >= c.termination_effective_on
      and v.status in ('not_scheduled', 'scheduled', 'rescheduled', 'confirmed', 'pending_access')) as visits_left_after_end,
  (select count(*) from public.amc_instalments i join public.amc_contracts c on c.id = i.contract_id
    where c.contract_number = 'AMC-C-2026-0004' and i.due_date > c.termination_effective_on
      and i.received_amount = 0 and i.status not in ('received', 'written_off', 'waived')) as instalments_left_after_end;

commit;
