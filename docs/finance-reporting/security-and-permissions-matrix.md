# Security and permissions matrix

Part of the [Finance & Reports plan](README.md). Jira: DEV-462 (and every screen that shows Finance or HR
data).

## The precondition: closing the role-escalation hole

On `main` (`f341a26`), and on production per the 6 Oct migration log:

- `roles` and `user_profile` carry an "Allow All … TO public" RLS policy; `role_access` has RLS **off**
  with full grants to `anon` and `authenticated`.
- The live app writes those tables **from the browser through pg_graphql with the public anon key**
  (Users, Roles and Permissions screens, profile settings, the auth callback).
- `app/api/role-access/route.ts` has **no authentication or permission check**.

So anyone holding the anon key, which ships in every page, can insert a `role_access` row or set their own
`role_id` to admin. Creating Finance, HR or compliance roles on that model would be pointless: they could
be self-granted.

**Fixed on this branch in P0** by porting the generic security layer from `amc-hardening` (`926cb24`),
path-limited:

- Writes move server-side: `app/api/users`, `app/api/roles`, `app/api/role-access` (now authenticated and
  permission-checked), via `lib/server/admin/users-roles.ts` with the service role after a check
  (`lib/server/require-access.ts`, `lib/server/action-guard.ts`).
- `app/api/graphql` forwards only allow-listed operations (`lib/server/graphql-allowlist.ts`).
- Client services (`modules/users`, `modules/roles`, `modules/auth`, `modules/settings`) call those routes
  instead of writing through GraphQL.
- Migration **`20261006160000_role_tables_server_only`** then removes the browser's write access: `anon`
  gets nothing on the three tables, `authenticated` gets `SELECT` only.

**Ordering is critical.** `20261006160000` must be applied **only after this code is deployed**; applied
earlier, the live Users, Roles and Permissions screens stop working. The hole stays open on production
until then (**B-02**). Shipping this port to `main` on its own, ahead of the rest of the project, would
close it sooner; that touches `main` and is the user's decision.

## Roles (BRD §6.7) — mapping pending D-18

Portal roles today: `admin`, `user`, `inspector`. Nothing in code branches on a role name except `admin`,
so new roles are rows in `roles`, given access through `role_access`, and assigned by an administrator.

## New resources

Following the per-page pattern (`20261008100000_per_page_permissions.sql`):

| Resource | Actions used |
|---|---|
| `finance_queue` | VIEW, EDIT (work items), APPROVE (record invoice), EXPORT |
| `finance_exclusions` | CREATE (request), APPROVE (verify) |
| `reports_quotations` | VIEW, EXPORT |
| `reports_utilization` | VIEW, EXPORT |
| `reports_capacity` | VIEW, EXPORT |
| `reports_attendance` | VIEW, EXPORT |
| `reports_revenue` | VIEW, EXPORT |
| `reports_exceptions` | VIEW, EXPORT |
| `compliance` | VIEW (all), EDIT (waive), APPROVE (decide disputes), EXPORT |
| `compliance_self` | VIEW (own only) |
| `reporting_settings` | VIEW, EDIT |

## Access matrix

✓ allowed · — no access · **own** restricted to the signed-in technician's records.

| Capability | Finance | Manager | Coordinator | Verifier (Behrouz) | Supervisor | HR | Technician | Admin |
|---|---|---|---|---|---|---|---|---|
| View queue | ✓ | ✓ (visibility, ageing) | ✓ (own jobs' items) | ✓ | — | **—** | — | ✓ |
| Pick up, hold, raise query | ✓ | — | — | — | — | — | — | — |
| Answer query | — | — | ✓ | — | — | — | — | — |
| Record invoice | ✓ | — | — | — | — | — | — | — * |
| Request exclusion | — | — | ✓ | — | — | — | — | — |
| Verify exclusion | — | — | — | ✓ | — | — | — | — * |
| Quotation, capacity, revenue, exception reports | — | ✓ | — | ✓ (quotation alerts) | — | — | — | ✓ |
| Utilization report | **—** | ✓ | — | — | — | — | — | ✓ |
| Attendance and compliance reports | — | ✓ | — | — | ✓ | ✓ | — | ✓ |
| Waive missed check-in | — | — | ✓ | — | ✓ | — | — | — * |
| Decide dispute | — | (D-10) | (D-10) | — | (D-10) | — | — | — * |
| Own compliance, statement, raise dispute | — | — | — | — | — | — | **own** | — |
| Reporting Settings | — | — | — | — | — | — | — | ✓ |

\* **Not inherited by admin.** These are named-person acts (recording an invoice against MAHER, verifying an
exclusion, waiving or deciding a technician's miss) and go in `NOT_INHERITED_BY_ADMIN` in
`lib/role-permissions.ts`, the same treatment as snagging approval. An administrator who should perform them
is given the permission like anyone else.

Explicit BRD rules: **Finance has no access to utilization. HR has no access to the queue. A technician
sees only their own data.** These are server-side denials, not hidden buttons.

## Enforcement

1. **Every route**: resolve the caller (`getRequestUserAccess`), 401 without a profile, `hasResourceAction`
   or 403. No permission check lives only in the UI.
2. **Record scoping on the server.** "Own" for technicians is resolved from the session to
   `technician_reference.user_profile_id`; the technician id is never taken from the request. Coordinators'
   "own jobs" are resolved the same way.
3. **Database**: new tables have RLS on and no `anon`/`authenticated` grants; only the service role, after
   the route's check, reads or writes them. A leaked anon key reaches nothing here.
4. **Named-person acts** use `NOT_INHERITED_BY_ADMIN`.
5. **Audit**: invoice recording, exclusions, waivers, dispute decisions and settings changes are written to
   append-only tables with actor and time; report views and exports go to `report_access_log` (BRD §6.9).
6. **Exports** are checked on the server (EXPORT action) before the data leaves. Snagging analytics checks
   export only in the browser; that pattern is not copied.

## Other findings (outside this project, reported)

- `ZOHO_FSM=read` is not enforced by any code; `SNAGGING_FSM_SYNC=on` enables production FSM writes (B-05).
- `bulk-download.tsx` puts the Zoho OAuth token in a query string.
- `app/api/test` calls FSM with no auth check and should be removed.
- `app/api/send-email` had no auth check on `main`; the ported layer adds one.
