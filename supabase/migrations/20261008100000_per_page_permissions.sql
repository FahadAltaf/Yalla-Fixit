-- Per-page permissions for Snagging, and a permission for the app itself.
--
-- Snagging was one permission. Every page under it declared the same
-- resource, so a role could be given the whole module or none of it --
-- there was no way to grant Jobs without also granting Quotations,
-- Clients and Analytics. Each page carries its own resource now.
--
-- Mobile app is new and separate. The inspector app's sign-in used to be
-- checked against Snagging View, which is the portal's permission: every
-- office account that could read a job in a browser could also sign in on
-- a phone, and every inspector who needed the phone had to be handed the
-- portal with it. They are different jobs, so they are different grants.
--
-- ── RUN THIS BEFORE THE CODE DEPLOYS ─────────────────────────────────
--
-- Not "either order". Each page is gated on its own grant and nothing
-- else, so between the code landing and this running, nobody can open
-- any Snagging page and no inspector can sign in to the app.
--
-- It briefly did accept the module-wide grant as a fallback, which would
-- have made the order free. That had to go: turning a page off in the
-- Permissions screen deletes its rows, so "no grant" is how a page is
-- denied -- and a fallback would have handed back every page an
-- administrator had just taken away.
--
-- ── What this does to existing roles: nothing ────────────────────────
--
-- Every grant in the table predates these resources. If the new code
-- simply stopped reading `snagging`, the module would shut to everyone
-- the moment it deployed -- and an inspector halfway through a unit would
-- be signed out of the app.
--
-- So two things hold at once. The code accepts the module-wide grant
-- alongside each page's own (see lib/server/snagging/page-access.ts and
-- app/api/snagging/sync/access/route.ts), and this grants every role the
-- new resources to match what it already has. Either alone is enough, so
-- the deploy and this migration may run in either order, and no role
-- loses a page it can open today.
--
-- Narrowing a role is then a deliberate act in the Permissions screen:
-- turn off the pages it should not have, and take Mobile app away from
-- office roles that should not carry a phone. That is the point of the
-- change; it is not something this migration does for you.
--
-- Additive only -- no updates, no deletes -- and keyed on the table's
-- unique (role_id, resource, action), so it is safe to run twice.

-- ── The pages ────────────────────────────────────────────────────────
--
-- Each role's own actions are mirrored onto each page, not just View: a
-- role with snagging view+edit ends up with view+edit on every page, so
-- what it can DO is identical to yesterday.
insert into public.role_access (role_id, resource, action, enabled)
select ra.role_id, page.resource, ra.action, true
from public.role_access ra
cross join (values
  ('snagging_overview'),
  ('snagging_quotations'),
  ('snagging_jobs'),
  ('snagging_clients'),
  ('snagging_analytics')
) as page(resource)
where ra.resource = 'snagging'
  -- A row with `enabled` unset counts as granted, as it does in the code.
  and ra.enabled is distinct from false
on conflict (role_id, resource, action) do nothing;

-- ── The checklist library ────────────────────────────────────────────
--
-- Split out of the catalogue, which held both. Anyone with the catalogue
-- keeps the checklist.
insert into public.role_access (role_id, resource, action, enabled)
select ra.role_id, 'snagging_checklist', ra.action, true
from public.role_access ra
where ra.resource = 'snagging_catalogue'
  and ra.enabled is distinct from false
on conflict (role_id, resource, action) do nothing;

-- ── The app ──────────────────────────────────────────────────────────
--
-- View only: it is a yes or no about signing in, and what an inspector
-- may then do is decided by the job they are named on, not by an action
-- on this resource.
insert into public.role_access (role_id, resource, action, enabled)
select distinct ra.role_id, 'mobile_app', 'view', true
from public.role_access ra
where ra.resource = 'snagging'
  and ra.action = 'view'
  and ra.enabled is distinct from false
on conflict (role_id, resource, action) do nothing;

-- ── Extensions ───────────────────────────────────────────────────────
--
-- Same split, same reasoning: Bulk download and Quotation templates
-- shared one resource with the group above them, so neither could be
-- granted without the other.
insert into public.role_access (role_id, resource, action, enabled)
select ra.role_id, page.resource, ra.action, true
from public.role_access ra
cross join (values
  ('extensions_bulk_download'),
  ('extensions_quotation_templates')
) as page(resource)
where ra.resource = 'extensions'
  and ra.enabled is distinct from false
on conflict (role_id, resource, action) do nothing;
