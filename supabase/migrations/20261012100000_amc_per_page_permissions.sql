-- Per-page permissions for AMC, as Snagging and Extensions have
-- (20261008100000_per_page_permissions.sql).
--
-- NOT APPLIED. Row 24 in docs/production-migration-log.md, checks §16.
--
-- AMC's pages all opened on "can use AMC" (any AMC permission), so a role
-- could be given the module or none of it -- no way to grant Contracts
-- without Reports. Each page carries its own permission now:
--
--   amc_proposals, amc_contracts, amc_clients, amc_site_visits,
--   amc_technicians, amc_reports, amc_fsm_mapping, amc_operations_settings
--
-- Enquiries, Payments, the Visit board, Rate card and Configuration open
-- on the permission they already had (amc_enquiries, amc_payments,
-- amc_visits, amc_rate_card, amc_config). What can be DONE on a page is
-- unchanged: still AMC Approve, AMC Operations, Payments, Visits...
--
-- ── RUN THIS BEFORE THE AMC CODE IS USED ─────────────────────────────
--
-- As with Snagging, each page is gated on its own grant and nothing else
-- (lib/server/amc/page-access.ts): turning a page off in the Permissions
-- screen deletes its rows, so "no grant" is how a page is denied, and a
-- module-wide fallback would hand back what an administrator took away.
-- So this backfill runs first, or AMC pages close to everyone but admins
-- in between. (Admins inherit every permission; nothing changes for them.)
--
-- ── What this does to existing roles: nothing they can notice ────────
--
-- Every role that can use AMC today -- AMC View or Approve, AMC
-- Operations View or Edit, or View on any AMC area -- gets View on each
-- new page, so it opens exactly the pages it opens now. Narrowing a role
-- is then a deliberate act in the Permissions screen.
--
-- Additive only -- no updates, no deletes -- keyed on the table's unique
-- (role_id, resource, action), so it is safe to run twice. It touches
-- role_access (live), the same way the Snagging backfill did.

insert into public.role_access (role_id, resource, action, enabled)
select distinct ra.role_id, page.resource, 'view', true
from public.role_access ra
cross join (values
  ('amc_proposals'),
  ('amc_contracts'),
  ('amc_clients'),
  ('amc_site_visits'),
  ('amc_technicians'),
  ('amc_reports'),
  ('amc_fsm_mapping'),
  ('amc_operations_settings')
) as page(resource)
where ra.enabled is distinct from false
  and (
    (ra.resource = 'amc' and ra.action in ('view', 'approve'))
    or (ra.resource = 'amc_operations' and ra.action in ('view', 'edit'))
    or (ra.resource in ('amc_enquiries', 'amc_rate_card', 'amc_config', 'amc_payments', 'amc_visits', 'amc_allowances') and ra.action = 'view')
  )
on conflict (role_id, resource, action) do nothing;
