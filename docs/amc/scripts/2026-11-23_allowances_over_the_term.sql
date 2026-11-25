-- Visit and hour allowances over the whole contract term (23 Nov 2026).
--
-- An allowance used to be the service's frequency a year, whatever the
-- term: a three-year contract at 4 visits a year allowed 4, while its PPM
-- schedule planned 12. AMC-C-2026-0004 (36 months) read "21 of 22 visits
-- left" beside a schedule of 66. New contracts now get the allowance over
-- the term (lib/amc/contracts.ts includedQuantityFor); this puts the
-- existing ones right.
--
--   visits: frequency x years, rounded, at least 1 (as the schedule counts)
--   hours:  frequency x years, to 2 decimals
--
-- Only allowances still at their old per-year value (included = frequency)
-- on contracts longer or shorter than 12 months are changed, so an
-- allowance someone set by hand is left alone. Used and booked amounts are
-- not touched.
--
-- Run PART 1, check the "new" column, then PART 2.

-- PART 1: look -----------------------------------------------------------
select c.contract_number, c.status, c.term_months, e.service_label, e.entitlement_type,
       e.frequency, e.included_quantity as now,
       case when e.entitlement_type = 'visits'
            then greatest(1, round(e.frequency * c.term_months / 12.0))
            else round(e.frequency * c.term_months / 12.0, 2) end as new,
       e.used_quantity
from public.amc_contract_entitlements e
join public.amc_contracts c on c.id = e.contract_id
where e.entitlement_type in ('visits', 'hours')
  and c.term_months is not null
  and c.term_months <> 12
  and e.included_quantity = e.frequency
  and c.termination_effective_on is null  -- an ending contract is fitted by its termination instead
order by c.contract_number, e.sort_order;

-- PART 2: change ---------------------------------------------------------
begin;

update public.amc_contract_entitlements e
   set included_quantity = case when e.entitlement_type = 'visits'
                                then greatest(1, round(e.frequency * c.term_months / 12.0))
                                else round(e.frequency * c.term_months / 12.0, 2) end
  from public.amc_contracts c
 where c.id = e.contract_id
   and e.entitlement_type in ('visits', 'hours')
   and c.term_months is not null
   and c.term_months <> 12
   and e.included_quantity = e.frequency
   and c.termination_effective_on is null;

-- Each contract's visits over its term. (AMC-C-2026-0004 is skipped here: it
-- ends early on 24 Dec 2026, and 2026-11-24_finish_amc_c_2026_0004_termination.sql
-- fits its allowances to the visits left before then.)
select c.contract_number, sum(e.included_quantity) as included, sum(e.used_quantity) as used
from public.amc_contract_entitlements e
join public.amc_contracts c on c.id = e.contract_id
where e.entitlement_type = 'visits'
group by c.contract_number;

commit;
