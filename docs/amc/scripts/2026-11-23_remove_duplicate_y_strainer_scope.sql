-- Remove the duplicate AC Y-Strainer Cleaning scope row (23 Nov 2026).
--
-- The property of AMC-C-2026-0004 has two active scope rows for
-- ac-y-strainer. The schedule took the second one, so the first one is the
-- one to remove:
--
--   REMOVE f3821131-54bc-4b3a-9ade-c4aa4c030ef0  added 16 Nov, 5 a year, no asset, 1 unit, 90 min,
--          months Jan/Feb/May/Jun, Mon-Wed
--   KEEP   c65f5ab2-4268-4aad-9aa6-2d898628415e  added 23 Nov, 4 a year, on the AC asset, 3 units, 30 min,
--          months Jan/Apr/Jul/Oct, Mon-Tue (matches the contract's 4 a year; the schedule uses it)
--
-- Removed the way the app removes a scope row: active = false, plus a
-- "scope_item_removed" audit event. Nothing is deleted; setting active back
-- to true undoes it. The contract's schedule does not change (it already
-- followed the row that is kept).
--
-- Run PART 1, check it shows the two rows, then run PART 2.

-- PART 1: look ------------------------------------------------------------
select id, service_id, asset_id, quantity, frequency_per_year, duration_minutes,
       preferred_months, preferred_days, active, created_at
from public.amc_scope_items
where property_id = 'f8fdd03e-30df-4ba0-b2b9-43e4296a0c1a'
  and service_id = 'ac-y-strainer'
order by created_at;

-- PART 2: remove ----------------------------------------------------------
begin;

with off as (
  update public.amc_scope_items
     set active = false,
         updated_at = now()
   where id = 'f3821131-54bc-4b3a-9ade-c4aa4c030ef0'
     and property_id = 'f8fdd03e-30df-4ba0-b2b9-43e4296a0c1a'
     and active = true
  returning id
)
insert into public.amc_audit_events (entity_type, entity_id, event_type, actor_id, actor_label, origin, justification, payload)
select 'property',
       'f8fdd03e-30df-4ba0-b2b9-43e4296a0c1a',
       'scope_item_removed',
       null,
       'Data fix',
       'portal',
       'Duplicate AC Y-Strainer Cleaning scope row; the 23 Nov row is kept',
       jsonb_build_object('scopeItemId', off.id, 'keptScopeItemId', 'c65f5ab2-4268-4aad-9aa6-2d898628415e')
from off;

-- Expect one active row: c65f5ab2-...
select id, active from public.amc_scope_items
where property_id = 'f8fdd03e-30df-4ba0-b2b9-43e4296a0c1a'
  and service_id = 'ac-y-strainer'
order by created_at;

commit;
