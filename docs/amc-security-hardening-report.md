# AMC Security Hardening Report

**Date:** 6 October 2026. **Branch:** `amc-hardening`. **Not deployed. No production migration applied. No credential rotated.**
**Reference model:** `docs/amc-security-model.md` (actors, permission matrix, endpoint table, RLS expectations).

## 1. Executive summary

Before this phase, AMC permissions were enforced by the portal's API, but the tables those permissions are read from were open:
- With the public anon key, which ships in every page, anyone could write `roles`, `role_access` and `user_profile`. They could grant themselves AMC approval or admin.
- `/api/graphql` passed any query through, so the same writes were possible through the portal itself.
- The Zoho Edge Functions answered anyone, and one of them logged the Zoho token.

This phase closes those holes in code and in four new migrations:
- **Role tables:** the browser can no longer write them. All user, role and permission changes go through new server routes (`/api/users`, `/api/roles`, `/api/role-access`). Those routes refuse self-escalation, and only an admin can grant or change the admin role.
- **GraphQL:** it answers one allowlisted read of public branding settings and nothing else.
- **Zoho Edge Functions:**
  - every function now requires a per-request signature from the portal (or `CRON_SECRET` for the token refresher);
  - none logs tokens or payloads;
  - the estimate transition function accepts named actions only.
- **AMC objects:** every contract, usage, correction, customer, property, assessment, FSM lookup and signed document request is checked against the record itself. That logic now sits in one tested module (`lib/amc/access.ts`).
- **AMC Operations:** a separate `amc_operations` permission (View, Create, Edit, Approve) lets operations staff work without becoming approvers. No new role was created.
- **Public endpoints:**
  - the generic email relay is limited and rate-limited;
  - password reset tokens are stored hashed and claimed atomically;
  - quotation review links are signed;
  - client links and the pre-login email check are rate-limited;
  - cross-site writes are refused.
- **User deletion:** deleting a user can no longer remove their AMC proposals.

**Status: PARTIAL in production terms.** The code and migrations are complete on the branch. But the protection only exists once three things happen:
- the code is deployed;
- the migrations are applied in the order in §12;
- the Edge Functions are redeployed with their secrets set.

The credentials in §9 must also be rotated, because they were readable before.

## 2. Threat model

| Attacker | Had before this phase | Has after deployment |
|---|---|---|
| Anyone on the internet (anon key from page source) | Read/write roles, permissions, all profiles, todos, scheduling tables; read the Zoho token (settings); call Zoho Edge Functions; send email via `/api/send-email`; upload any file to `uploads` | Read public branding settings; open a client link they hold; upload nothing |
| Any signed-in staff member | All of the above, plus every pg_graphql mutation via `/api/graphql` | Read colleagues' directory fields; act only within their granted resources |
| An AMC user (owner) | Every other owner's contracts, usage, customers, assessments, FSM work orders | Their own records; others only with AMC Operations or approver rights |
| Holder of a leaked client link | That proposal; unlimited guessing of others | That proposal only; guessing rate-limited and 256-bit tokens |
| Someone who reads Edge Function logs | The Zoho OAuth token | Nothing sensitive |

## 3. Authorization model

See `docs/amc-security-model.md` §1–§2. Summary:
- The **gate** is `requireContractAccess`. It checks the session and `canUseAmc`, works out the approver flag (AMC Approve permission or an approver listed in AMC Settings), and builds the AMC Operations actions.
- **Object checks:**
  - `requireManagedContract(gate, id, "read" | "write")` covers contracts;
  - `canEditCustomer` / `refuseCustomerEdit` covers customers and properties;
  - `canReadAssessment` covers assessments;
  - `canLookUpFsmWorkOrder` covers FSM lookups.
- **List endpoints** filter by `seesAll`: approvers and AMC Operations View/Edit see everything; everyone else sees only what they own.
- **Business rules kept as they were:**
  - customers and properties are created by any AMC user;
  - proposal owners correct their own usage (`AMC_CORRECTIONS_APPROVER_ONLY = false`, awaiting decision);
  - self-approval follows the AMC Settings flag. See §11: BRD v0.3 now says nobody may approve their own proposal, which is a business-rule change for a later goal.
- **Users and roles** (`lib/server/admin/users-roles.ts`):
  - you may edit your own name and photo only;
  - role, active flag and approval-email flag need Users: Edit, and never apply to yourself;
  - only an admin grants or changes the admin role or edits an admin;
  - permission rows must name a real resource and action;
  - new self-registered profiles always get the basic "user" role, whatever the client sends.

## 4. Endpoint audit

A static scan of all 158 API routes found every AMC route behind `requireContractAccess` or `getAuthenticatedUserAccess`, apart from the public client link. The per-endpoint table is in `docs/amc-security-model.md` §4. Changes in this phase:

| Endpoint | Before | After |
|---|---|---|
| `/api/graphql` | Any query or mutation, with the anon key | One allowlisted read, exact variables only; 400 otherwise |
| `/api/role-access` | Any signed-in user could add or delete permission rows | Permissions: View / Create / Delete+Edit; zod-validated resource and action |
| `/api/users`, `/api/roles` | (new; replaced browser GraphQL) | See §3 |
| `/api/send-email` | Anyone could send any HTML to anyone | Server calls (signed); signed-in users with Extensions: View, 30 per 10 min; anonymous callers 10 per 10 min per IP, one company mailbox, no attachments |
| `/api/estimates/transition` | Anyone could approve, reject or send any estimate | Signed review link (approve/reject that estimate only) or a signed-in user with the matching permission |
| `/api/estimates` review mode | Any estimate ID | Requires the review signature for that estimate |
| `/api/appointments`, `/api/estimates`, `/api/estimates/revision`, `/api/work-orders` | Called Edge Functions with the anon key | Signed Edge calls (`zohoEdgeHeaders`) |
| `/api/amc/[token]` | No limit | GET 120, POST 20 per 10 min per IP |
| `/api/auth/check-email` | No limit (account enumeration) | 30 per 10 min per IP |
| AMC contract, usage, correction, customer, property, assessment, FSM lookup, signed document routes | Any AMC user, any record | Object-level checks (§3) |
| Server actions (`modules/auth/*`) | `deleteAuthUser`, `createAuthUser`, `updateUserPassword`, `sendInvites` callable by anyone; `signUp` accepted a role id | Caller checked first (`lib/server/action-guard.ts`); `signUp` ignores the role; `acceptInvite` disabled |
| All `/api/*` writes | No origin check | Cross-site `Origin` refused in `middleware.ts` (Snagging mobile routes unchanged) |

## 5. RLS audit

Read-only checks on production (6 Oct 2026) found "Allow All" policies for `public` on these tables:
- `roles`, `user_profile`, `todos`, `settings`, `password_resets`;
- the estimate tables, every `schedule_*` table, `leave_records`, `lookup_options`;
- `technician_reference`, `technician_lookup_assignments`, `fsm_appointment_snapshots`;
- the four todo child tables.

`role_access` had RLS off and full anon grants. The fixes:

| Migration | Tables | Result |
|---|---|---|
| 4 `20261005160000_settings_hide_zoho_token` | `settings` | Branding columns only; the Zoho token columns are server-only |
| 5 `20261005170000_estimate_tables_server_only` | estimate tables | Server-only |
| 6 `20261005180000_password_resets_server_only` | `password_resets` | Server-only |
| 13 `20261006160000_role_tables_server_only` | `roles`, `role_access`, `user_profile` | RLS on, open policies dropped, anon nothing, authenticated read only |
| 14 `20261006161000_todos_and_uploads_tightened` | `todos`; `uploads` storage policies | `todos` server-only; uploads by signed-in users only; update own files only |
| 15 `20261006162000_amc_history_survives_user_deletion` | `amc_submissions.owner_id` | `ON DELETE RESTRICT` (was `CASCADE`) |
| 16 `20261006163000_shared_tables_server_only` | 12 scheduling, lookup, FSM snapshot and todo child tables | Open policies dropped, RLS on, anon revoked; authenticated revoked except read on `technician_reference` |

Every AMC table created on this branch already had RLS on and nothing granted to `anon` or `authenticated`, and a unit test pins that (`tests/amc/database-review.test.ts`). The local harness checks the result of all four new migrations as each role (`scripts/amc-db-harness/97c_verify_security.sql`).

## 6. Service-role audit

The service role bypasses RLS, so every route that uses it must check the caller first. Inventory:
- **AMC routes:** they use `gate.admin` from `requireContractAccess`. The admin client exists only after the session, AMC and object checks have passed.
- **`/api/amc-submissions/*`:** these routes create the admin client after `getAuthenticatedUserAccess` and `canUseAmc`.
- **New in this phase:** `/api/users`, `/api/roles`, `/api/role-access`, `/api/auth/callback`, `modules/auth/*`. Each checks the caller or is limited to provisioning the caller's own basic profile.
- **Scheduling (22 files), Snagging (54), Todos (4):** outside AMC and unchanged. They use their own gates (`requireResourceAccess`, the scheduling route factory, mobile bearer tokens, `CRON_SECRET`).
- **Internal HMAC** (`lib/internal-signature.ts`) is keyed with the service role key. Only server-to-server calls carry it.

The service role key is never sent to the browser. Nothing in `components/` imports the admin client, and the production build's client chunks contain neither the service key nor a Resend key (checked after `next build`).

## 7. Storage security

- **`amc-documents`** (private; created by migration 12) holds signed contracts and assessment photos.
  - It has no storage policy at all, so neither `anon` nor `authenticated` can list, read or write it.
  - The API serves files as signed URLs: 5 minutes for contracts, 10 minutes for photos. It issues them only after `canReadContract` or `canReadAssessment`.
  - The harness checks that a signed-in user cannot write it.
- **`uploads`** (public, existing) is still used by:
  - the organisation logo (`organization-settings.tsx`);
  - profile photos (`profile-settings.tsx`, `user-avatar.tsx`, via `lib/supabase/actions/save-file.ts`);
  - estimate service-item images (`/api/estimates/service-item-images`).

  Making it private would break those public image URLs, so it stays public-read. In this phase:
  - `save-file` now requires an active signed-in user and accepts images only;
  - migration 14 limits inserts to signed-in users and updates to the file's owner.

  **Migration strategy for later:** move avatars and logos to a bucket that is meant to be public. Move anything sensitive to private buckets with signed URLs. Then remove public read from `uploads`. AMC stores nothing in `uploads`.

## 8. Integration security (Zoho)

- **Credentials out of the browser:** the Zoho OAuth token columns are no longer in any browser query (`GET_SETTINGS_BY_ID` lists branding columns only). Migration 4 removes the grant.
- **Edge Functions in the repo:** all six functions are now in `supabase/functions/`. Each checks `isPortalRequest(req, slug)`, an HMAC of the function slug and timestamp keyed with `ZOHO_EDGE_SIGNING_KEY`, within 5 minutes. A signature for one function does not work for another. Each fails closed when the key is missing.
- **Token refresher:** `token-refresher` also accepts `x-cron-secret: CRON_SECRET` for the 15-minute cron.
- **Logging and CORS:** no function logs settings, tokens or request bodies, and the wildcard CORS headers are gone.
- **Estimate transitions:** `zoho-fsm-estimate-transitions` takes `approve` / `reject` / `mark_as_sent` only. It no longer accepts a raw transition ID or extra data.
- **Legacy function:** `refresh-token` duplicates `token-refresher` and should be deleted after deployment (§12).

## 9. Credentials that must be rotated at deployment

These were readable or logged before this phase. Rotate them **after** the new code and migrations are live, or the new values leak the same way.

| Credential | How it was exposed | Action |
|---|---|---|
| Zoho OAuth refresh token, client ID and client secret | `settings` readable with the anon key; the token logged by `zoho-fsm-estimate-transitions` | Revoke and reissue in Zoho; update `settings` and the Edge secrets |
| Zoho access token | Same | Refreshed automatically once the refresh token is rotated |
| Outstanding password reset tokens | `password_resets` readable with the anon key, stored raw | After deployment, lookups use the hash, so old raw rows stop working. Delete unused rows |
| `NEXT_PUBLIC_RESEND_API_KEY` | `NEXT_PUBLIC_` names can be inlined into browser code; none is in today's client chunks, but the name invites it | Create `RESEND_API_KEY` (server-only) with a new key, remove the old variable, revoke the old key |
| Supabase anon key | Public by design | No rotation needed. Its power is what the migrations remove |

Also check `roles`, `role_access` and `user_profile.role_id` for unexpected rows or grants before go-live. Anyone could have changed them.

## 10. Public link and email security

- **AMC client links:**
  - tokens are 256-bit random values (`crypto.randomBytes(32)`), stored as SHA-256;
  - they expire, and a closed link shows only the outcome;
  - requests are rate-limited per IP.
- **Snagging report links** (`/api/report/[token]`) are unchanged: hashed and expiring.
- **Quotation review links** carry an HMAC of the estimate ID (`lib/server/quotation-review-token.ts`). Links sent before deployment stop working, so pending quotations must be re-sent.
- **Password reset:**
  - the response is the same whether or not the email exists;
  - requests are limited to 3 per 15 minutes per email;
  - the token is 64 hex characters, stored hashed;
  - claiming it is a single atomic update (unused, unexpired);
  - the password needs at least 8 characters;
  - the token is no longer logged in the browser.
- **Email relay:** as in §4. Signed-in staff with Extensions: View can still send arbitrary HTML to any recipient (rate-limited). A narrower domain endpoint per use case is recommended (§11).

## 11. Remaining risks

| # | Risk | Severity | Note |
|---|---|---|---|
| 1 | Nothing in this report protects production until the code is deployed, the migrations applied, the Edge Functions redeployed and the credentials rotated | **CRITICAL until deployed** | §12 |
| 2 | Open self-registration: Supabase sign-ups are enabled and `signUp` creates a "user" profile | HIGH | The "user" role should hold no data permissions; or disable sign-ups in Supabase Auth |
| 3 | Rate limits are per server instance (in memory) | MEDIUM | A shared store (Redis/Upstash) for a global limit |
| 4 | `uploads` stays public-read for other modules | MEDIUM | §7 strategy |
| 5 | `/api/send-email` still relays arbitrary HTML for signed-in Extensions users | MEDIUM | Replace with purpose-specific endpoints |
| 6 | Any signed-in staff member can read all `user_profile` rows | LOW | Needed by today's pickers; a directory view could narrow it |
| 7 | Deleting a user who owns AMC history is refused with a database error that the API maps to 409. A `snagging_job_signoffs` / `todos` user FK still cascades | LOW | Deactivate users instead of deleting them |
| 8 | Self-approval follows the AMC Settings flag (on). **BRD v0.3 §5.5/§6.7 forbids it** | HIGH (business rule) | Not changed here (security-only goal); next AMC goal |
| 9 | Snagging mobile routes and scheduling routes were not re-audited in depth (outside AMC) | — | Their gates were confirmed present |

**Critical remaining in code: 0. High remaining: 2** (open self-registration, and self-approval against the BRD).

## 12. Deployment dependencies

**Migration classification** (all 16 on this branch; none applied):

| # | Migration | Classification |
|---|---|---|
| 1–3 | `20261005100000`, `110000`, `150000` | SAFE BEFORE CODE DEPLOY |
| 4–6 | `20261005160000` settings, `170000` estimates, `180000` password resets | **REQUIRES NEW CODE FIRST** |
| 7–12 | `20261006100000` … `150000` (AMC feature tables) | SAFE BEFORE CODE DEPLOY |
| 13 | `20261006160000_role_tables_server_only` | **REQUIRES NEW CODE FIRST**: today's `main` reads and writes users, roles and permissions through GraphQL with the anon key |
| 14 | `20261006161000_todos_and_uploads_tightened` | SAFE BEFORE CODE DEPLOY |
| 15 | `20261006162000_amc_history_survives_user_deletion` | SAFE BEFORE CODE DEPLOY |
| 16 | `20261006163000_shared_tables_server_only` | SAFE BEFORE CODE DEPLOY |

Each classification was checked with the main compatibility harness: main's schema, each migration in turn, and main's queries replayed after every step. Migration 16 was also checked by reading main's and the branch's code, because the harness shim has no scheduling tables. Only `technician_reference` is read with a session, and it keeps a read grant.

**Manual production actions, in order:**
1. Set `ZOHO_EDGE_SIGNING_KEY` (new random value) in the portal environment **and** the Supabase Edge Function secrets. Set `CRON_SECRET` in the Edge secrets. Set `QUOTATION_REVIEW_SIGNING_KEY` and `RESEND_API_KEY` in the portal environment.
2. Deploy the six Edge Functions from `supabase/functions/`. Delete `refresh-token`.
3. Change the `zoho-token-refresh` cron job's `net.http_post` headers to include `x-cron-secret`.
4. Apply the SAFE migrations in order (they may go before the code).
5. Deploy the portal code.
6. Apply migrations 4–6 and 13.
7. Rotate the credentials in §9.
8. Re-send pending quotation review links.
9. Smoke test: sign in; users and roles screens; AMC proposal, contract and usage screens; estimate approve link; password reset; cron refresh.

## Verification (this phase)

| Check | Result |
|---|---|
| Security unit tests (`tests/amc/security.test.ts`) | 25 / 25 |
| All unit tests (`npm test`) | 179 / 179 |
| Full typecheck (`tsc --noEmit`) | PASS |
| Lint (changed files) | 0 errors (1 pre-existing warning) |
| Production build (`next build --webpack`) | PASS |
| Local migration harness, incl. `97c_verify_security.sql` | PASS |
| Main compatibility harness (39 main queries, 23 of them AMC) | All 23 AMC queries pass after every migration. 28/39 pass after all 16: the 11 failures are the expected non-AMC breaks from migrations 4–6 (settings, estimates, password resets: 8) and 13 (users, roles, permissions via GraphQL: 3), hence REQUIRES NEW CODE FIRST; 14–16 add none |
