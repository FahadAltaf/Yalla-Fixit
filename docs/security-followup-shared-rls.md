# Security follow-up: shared "Allow All" RLS policies

Branch `amc-hardening`, 5 Oct 2026. Nothing here is applied. The proposed
migration, `supabase/migrations/20261005150000_restrict_shared_allow_all_policies.sql`,
is marked "NOT APPLIED. Requires approval."

## Status update, 5 Oct 2026 (integration phase)

| Finding | Status on branch `amc-hardening` |
|---|---|
| `settings` exposes the Zoho token (§0) | **Fixed in code** (the browser no longer requests it; appearance is saved by `/api/settings/appearance`; zoho-file, estimate revision and the debug route read it server-side behind auth) **plus migration `20261005160000_settings_hide_zoho_token.sql`** (not applied). Rotation required after deploy (runbook §11). |
| `estimate_revisions`, `estimate_service_items` open | **Fixed in code** (dashboard estimate routes need a signed-in Extensions user and use the service role) **plus migration `20261005170000_estimate_tables_server_only.sql`** (not applied). The get-estimate edge function reads revisions with the service role, so it is unaffected. |
| `schedule_audit_events` open | Migration `20261005150000` (not applied), verified locally. |
| `password_resets` open (**account takeover**) | Found 5 Oct 2026. **Fixed in code** (reset actions use the service role, which also repairs a reset flow that could not set a password) **plus migration `20261005180000_password_resets_server_only.sql`** (not applied). |
| `role_access` (RLS off), `roles`, `user_profile` open (**privilege escalation to admin**) | Found 5 Oct 2026. **Not fixed: security blocker.** User and role management write these from the browser through `/api/graphql` as anon; they must move to authenticated server routes before the tables can be closed. |
| Edge functions are public Zoho FSM proxies (`verify_jwt = false`); `zoho-fsm-estimate-transitions` logs the token | Found 5 Oct 2026 by reading the deployed source (read-only). **Not fixed** (deployed outside the repo). Each should require a valid user JWT or a server secret and stop logging `settings`. |

All the migrations above were applied twice to a local Postgres 15 rebuilt with production's policies and grants for these tables, with role-by-role checks (hardening report §16).

## 0. Added after the analysis below: `public.settings` exposes the Zoho FSM token (CRITICAL)

Found on 5 Oct 2026 while checking the `revision/route.ts` lead in §3, with
read-only queries against production. Not fixed; nothing in production was
changed.

- `public.settings` has RLS on and a single policy **"Allow All on Settings"**
  (FOR ALL TO public USING true), and `anon` and `authenticated` hold
  SELECT, INSERT, UPDATE and DELETE on it.
- Its columns include **`oauth_access_token`** and `oauth_token_refreshed_at`
  (the Zoho FSM OAuth token the portal uses to call FSM), as well as the
  portal's branding (`logo_url`, `favicon_url`, `site_image`), contact email
  and shift times.
- The anon key is public (it ships in the inspector app bundle). So anyone
  can call `GET /rest/v1/settings?select=oauth_access_token` and act on Zoho
  FSM as the company until the token next refreshes, and keep doing so by
  polling. Anyone can also rewrite the branding URLs or shift times.

**Recommended, as its own urgent change (not part of AMC hardening):**
1. Move every read of `oauth_access_token` server-side behind the service role
   (`app/api/estimates/revision/route.ts` `getAccessToken()` and any edge
   function or cron that reads it), or move the token to a table with no
   browser grants.
2. Then drop "Allow All on Settings", revoke INSERT/UPDATE/DELETE from
   `anon` and `authenticated`, and keep only the SELECT the public pages
   genuinely need, on the non-secret columns (column grants or a view).
3. Rotate the Zoho FSM OAuth client secret / refresh token afterwards, since
   the access token has been readable.

This needs a check of every `settings` reader (including the edge functions
whose source is not in the repo) before any revoke, which is why it is not
in this phase's migrations.

## 1. Summary

| Table | Rows | Who can read/write today | Severity | Fixed by this branch? |
|---|---|---|---|---|
| `schedule_audit_events` | 455 | Anyone with the public anon key: read, insert, update, delete | **High**. The audit trail can be forged or wiped, and it leaks actor ids plus appointment and technician payloads. | **Yes**, proposed migration (service role only) |
| `estimate_revisions` | 95 | Anyone with the anon key: read, insert, update, delete | **High**. Anyone can corrupt the revision chain, which drives `canCreateRevision` and revision numbering. | No. Needs a separate change (section 6) |
| `estimate_service_items` | 38 | Anyone with the anon key: read, insert, update, delete | **Medium-High**. Anyone can attach, swap or remove image URLs that appear on client quotations, and can list every quotation's images. | No. Needs a separate change (section 6) |

There is a related, larger risk: `/api/graphql` forwards any query to pg_graphql
using the anon key and checks for no portal session (a product-owner decision,
recorded in `app/api/graphql/route.ts:3-13`). That makes it a public anon
gateway. Nothing in the portal sends queries about these three tables through
it, but an attacker can. While anon has grants on a table, mutations such as
`deleteFromestimate_revisionsCollection` work through either the gateway or
Supabase directly.

## 2. Live production facts (read-only queries, 5 Oct 2026, project `sxzpigyphjotuubxpooj`)

- **`estimate_revisions`**: RLS is on. It has one policy, `"Allow All on estimate_revisions"`, defined `FOR ALL TO public USING (true) WITH CHECK (true)`. anon and authenticated both hold SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER.
- **`estimate_service_items`**: RLS is on. It has one policy, `"Allow All on quotation_service_item_images"` (same definition), and the same full grants. The live policy name does not match the repo, which creates `"Allow All on estimate_service_items"` (`20260415_create_quotation_service_item_images.sql:24-31`). The table was probably created as `quotation_service_item_images` and renamed by hand. Any future migration must drop **both** policy names.
- **`schedule_audit_events`**: RLS is on. It has one policy, `"Allow All on schedule_audit_events"` (same definition), and the same full grants.
- **The anon key is public.** It ships in the inspector app bundle as `EXPO_PUBLIC_SUPABASE_ANON_KEY` for the same project. So anyone can call `/rest/v1/<table>` and `/graphql/v1`. PostgREST does not expose TRUNCATE, but a filtered DELETE (for example `?id=not.is.null`) empties a table just as well.

### Where the open policies come from

| Table | Migration | Lines |
|---|---|---|
| `estimate_revisions` | `supabase/migrations/20260413_create_estimate_revisions.sql` (duplicate in `lib/supabase/migrations/`) | 24-32 |
| `estimate_service_items` | `supabase/migrations/20260415_create_quotation_service_item_images.sql` (duplicate in `lib/supabase/migrations/`) | 22-31 |
| `schedule_audit_events` | `supabase/migrations/20260721090000_add_scheduling_settings_and_approver.sql` | 64, 67-73 |

None of these migrations grants or revokes anything explicitly. The anon and
authenticated grants are Supabase's default privileges on `public`. Later
migrations that touch the tables are:

- `20260414_drop_estimate_revision_id_columns.sql`: columns and indexes only.
- `20260721092000_create_schedule_core_module.sql:177-179`: adds the `schedule_version_id` foreign key, `ON DELETE SET NULL`.
- `20260827090000_scheduling_consolidate_tables.sql:128-141`: adds `schedule_entry_id` (foreign key, `ON DELETE SET NULL`), `status`, `error_message` and `correlation_id`.

None of them change the policies.

## 3. Every caller, and the role it runs as

Client factories:

- `createAdminServerClient()` (`lib/supabase/supabase-helpers.ts:53-68`) uses `SUPABASE_SERVICE_ROLE_KEY`, so it runs as **service_role** and bypasses RLS and grants.
- `createServerClientForApi()` (`lib/supabase/supabase-server-client.ts:44-47`) uses `@supabase/ssr` with the anon key and the request cookies. It runs as **authenticated** when the browser has a portal session, and as **anon** when it does not.
- `/api/graphql` (`app/api/graphql/route.ts`) and `executeGraphQLBackend` (`lib/graphql-server.ts:9-52`) always run as **anon**. The proxy does not forward a user JWT, and the server-side path sends only `apikey`.

### schedule_audit_events: every caller is service_role

The audit route checks the session and permissions before reading. The other
scheduling routes have their own checks. Whatever those checks do, every query
runs through the admin client.

| File:line | Op | Role |
|---|---|---|
| `app/api/scheduling/audit/route.ts:32` | SELECT (history panel) | service_role |
| `lib/server/zoho/import-appointments.ts:232` | SELECT (unplaced note) | service_role |
| `lib/server/zoho/import-appointments.ts:252, 342, 510` | INSERT | service_role |
| `lib/server/zoho/reconcile.ts:166, 210` | INSERT | service_role |
| `lib/server/publish-schedule.ts:84` | INSERT | service_role (admin passed in) |
| `lib/server/schedule-sync.ts:144, 200` | INSERT | service_role (admin passed in) |
| `app/api/scheduling/config/route.ts:74` | INSERT | service_role |
| `app/api/scheduling/leave/route.ts:136, 210` | INSERT | service_role |
| `app/api/scheduling/schedule/route.ts:93` | INSERT | service_role |
| `app/api/scheduling/schedule/approve/route.ts:54` | INSERT | service_role |
| `app/api/scheduling/schedule/clear/route.ts:65` | INSERT | service_role |
| `app/api/scheduling/schedule/entries/route.ts:246, 401, 504` | INSERT | service_role |
| `app/api/scheduling/schedule/publish-edit/route.ts:118` | INSERT | service_role |
| `app/api/scheduling/schedule/reject/route.ts:71` | INSERT | service_role |
| `app/api/scheduling/schedule/reopen/route.ts:54` | INSERT | service_role |
| `app/api/scheduling/schedule/retry/route.ts:111` | INSERT | service_role |
| `app/api/scheduling/schedule/revise/route.ts:108` | INSERT | service_role |
| `app/api/scheduling/schedule/submit/route.ts:58, 85` | INSERT | service_role |
| `app/api/scheduling/tag-assignments/route.ts:76, 116` | INSERT | service_role |
| `app/api/scheduling/tags/route.ts:110, 170, 225` | INSERT | service_role |
| `app/api/scheduling/technicians/order/route.ts:51` | INSERT | service_role |
| `app/api/scheduling/technicians/route.ts:64` | INSERT | service_role |

That is 2 readers and 31 inserts. Nothing in the code updates or deletes audit
rows, nothing references `schedule_audit_eventsCollection` in GraphQL, and no
SQL view, function, trigger or realtime publication refers to the table.

The database does update the table indirectly. Its three foreign keys
(`actor_id`, `schedule_version_id`, `schedule_entry_id`) are all
`ON DELETE SET NULL`, and the portal deletes `schedule_entries` in two places:
`app/api/scheduling/schedule/entries/route.ts:474` and
`app/api/scheduling/schedule/clear/route.ts:59-62`.

### estimate_revisions and estimate_service_items: cookie session, no auth check

None of these routes checks for a user, and none uses the service role. With a
portal session they run as authenticated. Without one, for example a direct
`curl`, they run as anon.

| File:line | Op | Role | Called from |
|---|---|---|---|
| `app/api/estimates/route.ts:312` | SELECT `estimate_revisions` (dashboard mode only) | authenticated / anon | `components/dashboard/extensions/quotation-templates/index.tsx:108` |
| `app/api/estimates/route.ts:334` | SELECT `estimate_service_items` (dashboard mode only) | authenticated / anon | same |
| `app/api/estimates/revision/route.ts:473` | SELECT `estimate_revisions` | authenticated / anon | `quotation-templates/index.tsx:297` |
| `app/api/estimates/revision/route.ts:602` | INSERT `estimate_revisions` | authenticated / anon | same |
| `app/api/estimates/revision/route.ts:620` | SELECT `estimate_service_items` | authenticated / anon | same |
| `app/api/estimates/revision/route.ts:649` | INSERT `estimate_service_items` (copy images to the revision) | authenticated / anon | same |
| `app/api/estimates/service-item-images/route.ts:53` | SELECT (GET; no UI caller found) | authenticated / anon | none in repo |
| `app/api/estimates/service-item-images/route.ts:127, 188` | SELECT + INSERT (upload) | authenticated / anon | `quotation-templates/use-service-item-images.ts:154` |
| `app/api/estimates/service-item-images/route.ts:225` | DELETE | authenticated / anon | `quotation-templates/use-service-item-images.ts:206` |

`/api/estimates` is also called from the **public** client review page,
`app/quotations/review/page.tsx:40`, with `fetchMode: "review"`. In that mode
the route does not query either table, but the edge function behind it does
return revisions (see below).

### Edge functions (source not in this repo; role unknown)

- **`get-estimate`** is called with the anon key as Bearer from `app/api/estimates/route.ts:237` (with `includes: [..., "revisions"]`, line 219) and from `app/api/estimates/revision/route.ts:410, 564`. It returns `payload.revisions`, so it almost certainly reads `estimate_revisions`. Whether it uses its own service-role client or the caller's JWT (anon) is unknown. If it uses anon, revoking anon SELECT would break both the dashboard and the public review page.
- **`zoho-fsm-estimate-transitions`** is called with the anon key from `app/api/estimates/transition/route.ts:3-4, 38`, which also has no auth check and is used by the public review page (`app/quotations/review/ActionSection.tsx:104`). It may or may not write these tables.

### GraphQL (`/api/graphql`)

No GraphQL document in the repo references any of the three tables. The
modules that use GraphQL (`modules/auth`, `modules/roles`, `modules/users`,
`modules/settings`, `components/auth/login`, `app/api/auth/check-email`) touch
`user_profile`, `roles`, `role_access` and `settings` only. Revoking anon on
`schedule_audit_events` therefore cannot break a GraphQL caller.

## 4. Analysis and decision

**`schedule_audit_events` qualifies for an isolated fix.** Every legitimate
reader and writer uses the service role. Dropping the open policy and revoking
all privileges from anon and authenticated changes nothing for the
application, and it closes public read, forge, rewrite and delete.

**Append-only rules are left out on purpose.** `amc_audit_events` uses
`DO INSTEAD NOTHING` rules, but that is unsafe on this table. Postgres
implements `ON DELETE SET NULL` as an UPDATE on the child table, and rules
rewrite those updates too. With a no-update rule, deleting a schedule entry
(which the portal does) would silently leave a dangling `schedule_entry_id`.
The revoke already stops browser roles from updating or deleting rows. RI
actions run as the table owner, so the revoke does not affect them.

**The estimate tables do not qualify.** They are written as authenticated, or
as anon when there is no session, by routes that check nothing. One reader
(`get-estimate`) has an unknown role, and the public review page depends on
it. Revoking anon could break revision creation, image upload and the client
review page. Restricting authenticated would break the dashboard. The task
rules therefore leave them for a separate change.

## 5. What the migration does and does not do

`supabase/migrations/20261005150000_restrict_shared_allow_all_policies.sql`:

- **Does:**
  - `DROP POLICY IF EXISTS "Allow All on schedule_audit_events"`.
  - Re-asserts `ENABLE ROW LEVEL SECURITY`.
  - `REVOKE ALL ON public.schedule_audit_events FROM anon, authenticated`.
  - It is idempotent, documents the exact rollback statements, and ends with a commented, read-only verification block.
- **Does not:**
  - Touch `estimate_revisions` or `estimate_service_items`.
  - Add append-only rules.
  - Change `/api/graphql`.
  - Touch storage.
  - Change any application code.
  - Get applied. No CLI command or `db push` was run.

## 6. Recommended separate security phase

1. **Put the estimate routes behind auth.** Add a session and permission check (`getAuthenticatedUserAccess` + `hasResourceAction`, the same pattern as `app/api/scheduling/audit/route.ts:12-18`) to these handlers:
   - `app/api/estimates/revision/route.ts` POST
   - `app/api/estimates/service-item-images/route.ts` GET/POST/DELETE
   - the dashboard branch of `app/api/estimates/route.ts`

   Keep `fetchMode: "review"` and `/api/estimates/transition` reachable by the client review link. Ideally gate them on a signed per-quotation token, as the AMC client links do. Then switch the table queries in those routes to `createAdminServerClient()`.
2. **Read the `get-estimate` and `zoho-fsm-estimate-transitions` sources** from the Supabase dashboard (Edge Functions). Confirm which client and role they use for `estimate_revisions` and `estimate_service_items`. If they use the caller's JWT, switch them to the service role inside the function.
3. **Only then revoke the estimate tables.** Drop `"Allow All on estimate_revisions"`, `"Allow All on quotation_service_item_images"` and `"Allow All on estimate_service_items"`, and run `REVOKE ALL ... FROM anon, authenticated` on both tables.
4. **Fix `getAccessToken()` in `app/api/estimates/revision/route.ts:49-62`.** It reads `settings.oauth_access_token` with the cookie-session client from an unauthenticated route. If that works without a session, the Zoho OAuth token can be read by anyone with the anon key. Check the grants and policies on `settings`, move the read to the service role, and revoke anon on that column or table.
5. **Uploads bucket.** Service-item images are uploaded with the session client to the `uploads` bucket (`NEXT_PUBLIC_SUPABASE_BUCKET_NAME`) and stored as public URLs (`service-item-images/route.ts:166-183`). Review that bucket's storage policies (anon upload/delete?) and whether the images need to be public at all. Signed URLs would avoid listing and enumeration.
6. **`/api/graphql`.** It currently has no authentication. Allow-list the operations needed before sign-in (the email check) and require a session for the rest, or forward the user's JWT instead of the bare anon key. After that, sweep every remaining `"Allow All on ..."` policy in `supabase/migrations` (for example `technician_reference`, `20260721090000:75-81`) and apply the same caller analysis to each.
7. **Reconcile live drift.** The live policy name on `estimate_service_items` differs from the repo. Write a migration that matches production.

## 7. Manual verification checklist

Before applying:

- [ ] Re-run the live grant and policy query for `schedule_audit_events` and confirm it still matches section 2.
- [ ] Grep the inspector app (`yfi-mobile-app`) and any other client of this project for `schedule_audit_events`. Expect no hits. The app uses only the public anon key, so any hit would break.
- [ ] Check the Supabase dashboard for edge functions, database webhooks or cron jobs that use `schedule_audit_events` as a non-service role.
- [ ] Get approval for the migration.

After applying:

- [ ] Run the verification block at the end of the migration. Expect no policy, RLS enabled, and no anon or authenticated grants.
- [ ] `curl "$SUPABASE_URL/rest/v1/schedule_audit_events?select=id&limit=1" -H "apikey: $ANON"` returns permission denied (42501).
- [ ] Portal, as an approver:
  - [ ] Open the scheduling board and the audit history panel. Events load.
  - [ ] Create, move and delete an entry. Submit, approve or reject, and publish. Each action adds an audit event, and history shows it.
  - [ ] Delete an entry and confirm the audit rows that pointed at it now have `schedule_entry_id = NULL`. This confirms the foreign-key action still works.
- [ ] Run an FSM import or reconcile for a day. The unplaced-appointments note and the sync events still appear.
- [ ] Rollback, if ever needed: the exact GRANT and CREATE POLICY statements are in the migration header.
