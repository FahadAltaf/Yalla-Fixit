-- The inspector role, and the permissions the inspector app runs on.
--
-- Signing off an inspection is not something a role grants. Who reviews
-- a job and who approves it are named on the job itself, on its Setup
-- tab, and the review, approve, reject and deliver routes ask only that
-- (lib/server/snagging/workflow.ts). The admin role is no exception: an
-- administrator who should decide a job is named on it like anybody
-- else. Everything else an admin does is unchanged, including Snagging
-- View, which is what the inspector app's sign-in is checked against.
--
-- So nothing here needs a Snagging Approve grant, and nothing stops
-- working for want of one. What DOES need doing after this runs: open
-- the jobs in flight and check each has an approval manager named, since
-- that name is now the only thing that can sign it off.

-- ── The role ──────────────────────────────────────────────────────────
--
-- A fixed id so a re-run, or a second environment, lands on the same row
-- as the grants below. Named rather than numbered because `isAdminUser`
-- matches on name, and nothing in the code branches on "inspector" -- it
-- is an ordinary role whose permissions do the work.
insert into public.roles (id, name, description)
values (
  '3f7c1e52-9a4d-4b86-9d2e-5c8f1a6b7d90',
  'inspector',
  'Walks units and captures defects in the inspector app. Cannot sign off their own work.'
)
on conflict (name) do nothing;

-- ── What it may do ────────────────────────────────────────────────────
--
-- View  : sign in to the app (/api/snagging/sync/access), pull a job,
--         read alerts.
-- Edit  : push captured snags back (/api/snagging/sync/snag).
--
-- Deliberately absent:
--   Approve  an inspector does not sign off their own walk.
--   Create   jobs are raised from an approved quotation, in the portal.
--   Delete   nothing in snagging is deleted by the person who found it.
--
-- record_access is left at the column default. It reads as though it
-- scopes what an inspector can see, and for Todos it does, but nothing in
-- snagging consults it: the sync endpoints decide that themselves, from
-- who is on the job (/api/snagging/sync/job/[id]). Setting it here would
-- be a control that does not control anything.
--
-- Keyed off the role by name rather than the literal id above, so this
-- still does the right thing if the row already existed under a different
-- id from an earlier hand-made insert.
insert into public.role_access (role_id, resource, action, enabled)
select r.id, v.resource, v.action, true
from public.roles r
cross join (values
  ('snagging', 'view'),
  ('snagging', 'edit')
) as v(resource, action)
where r.name = 'inspector'
on conflict (role_id, resource, action) do nothing;
