# AMC Security Model

**Date:** 6 October 2026. **Branch:** `amc-hardening`. Nothing here is deployed.
**Companion:** `docs/amc-security-hardening-report.md` (what changed, what remains, how to deploy it).

This is the reference for who may do what in the AMC system, where each decision is enforced, and what the database must refuse on its own.

## 1. Actors

| Actor | How it is recognised | Notes |
|---|---|---|
| Anonymous visitor | No session. Holds only the public anon key, which ships in every page | Must reach no AMC data except through a client link token |
| Client (proposal recipient) | A valid, unexpired client link token in `/amc/[token]` | Sees and acts on that one proposal only |
| Signed-in staff member without AMC | Session, but `canUseAmc` is false | No AMC route answers them (403) |
| AMC user (proposal owner / account manager) | `amc` View/Create/Edit, or `amc_operations` View/Edit | Sees and runs **their own** proposals and contracts |
| AMC operations | The new `amc_operations` resource: View, Create, Edit, Approve, each granted separately | See the matrix. No new role was created; an admin grants these to an existing role |
| AMC approver | `amc` Approve, or listed as an approver in AMC Settings (`canApproveAmc`) | Sees everything, decides, cancels, edits AMC settings |
| Admin | The admin role | Inherits every resource action. Only an admin may grant or change the admin role |
| Server jobs | `CRON_SECRET` (cron), the internal HMAC signature (`lib/internal-signature.ts`), the Zoho Edge signing key | Never a browser |

## 2. Permission matrix

Rules live in one pure module, `lib/amc/access.ts`, and are unit-tested in `tests/amc/security.test.ts`. "Owner" means the proposal's `owner_id`; for customers, properties and assessments, `created_by`.

| Operation | Owner | Ops View | Ops Create | Ops Edit | Ops Approve | Approver | Rule |
|---|---|---|---|---|---|---|---|
| List / read contracts | own | all | own | all | own | all | `seesAllContracts`, `canReadContract` |
| Activate a signed proposal | own | | yes | | | yes | `canActivateContract` |
| Operate a contract (links, quotes, FSM, reminders, renewal, signed copy) | own | | | yes | | yes | `canOperateContract` |
| Record usage | own | | | yes | | yes | `canRecordUsage` |
| Correct usage | own | | | | yes | yes | `canCorrectUsage`; `AMC_CORRECTIONS_APPROVER_ONLY` (false today, per the pending decision) removes the owner |
| Cancel a contract | | | | | | yes | `canCancelContract` |
| Renew | own | | | yes | | yes | as operate |
| Read customers / properties | own | all | own | all | own | all | visibility follows `seesAll` |
| Edit a customer / property | creator | | | yes | | yes | `canEditCustomer` (`lib/server/amc/customer-access.ts`) |
| Create a customer / property | any AMC user | | | | | | unchanged business rule |
| Read an assessment and its photos | creator | all | creator | all | creator | all | `canReadAssessment` |
| Edit / complete an assessment | creator | | | yes | | yes | |
| FSM work-order lookup | inside own contract | | | yes | | yes | `canLookUpFsmWorkOrder` |
| AMC reports, coverage, summary | own data | all | own | all | own | all | `seesAll` |
| AMC settings, checklist, discount, notification settings, FSM service mapping | read | read | read | read | read | edit | `gate.canApprove` |
| Proposal pricing settings (`/api/amc-settings` PUT) | | | | | | | admin only |
| Own notifications | own | own | own | own | own | own | filtered by the caller's id |

The proposal workflow (create, submit, approve, send) keeps its rules from before this phase; they are enforced in `/api/amc-submissions/*`.

## 3. Trust boundaries and write paths

1. **Browser to API.** The browser holds the anon key and a session cookie. After this phase it writes nothing to the database directly. Every AMC write goes through a Next.js route that:
   - checks the session (`requireContractAccess` / `getAuthenticatedUserAccess`);
   - checks the permission and the object (`requireManagedContract(gate, id, "read" | "write")` and the rules above);
   - validates the body with zod.
   Then it writes with the service role.
2. **API to database.** The service role bypasses RLS, so the route is the only gate. Every AMC table therefore has RLS on and **no** grant to `anon` or `authenticated`. A forgotten route check cannot be bypassed from the browser, because the browser has no path to the table.
3. **Cross-site requests.** `middleware.ts` refuses a state-changing `/api/*` request whose `Origin` names another site (`lib/server/request-origin.ts`). Snagging's mobile CORS routes are left as they were.
4. **Client links.** `/api/amc/[token]` is the only unauthenticated AMC route. The token is a random 256-bit value; it is looked up hashed, expires, and is rate-limited per IP (GET 120, POST 20 per 10 minutes).
5. **Server to Zoho.** The portal calls the Zoho Edge Functions with a per-request HMAC (`ZOHO_EDGE_SIGNING_KEY`, 5-minute window). The cron calls `token-refresher` with `CRON_SECRET`. The Zoho token never leaves the server.
6. **Files.** Signed contracts and assessment photos are in the private `amc-documents` bucket. It has no storage policy at all; files are served only as 5–10 minute signed URLs, after the object check.

## 4. AMC endpoint audit

AUTH: session required. PERM: resource permission checked. OBJ: ownership or visibility of the specific record checked. TOKEN: public token. All writes are zod-validated.

| Endpoint | Methods | AUTH | PERM | OBJ | TOKEN |
|---|---|---|---|---|---|
| `/api/amc-contracts` | GET, POST | yes | canUseAmc; activate: `canActivateContract` | list filtered by `seesAll`; activation checks the proposal owner | |
| `/api/amc-contracts/[id]` | GET | yes | canUseAmc | read mode | |
| `/api/amc-contracts/[id]/usage` | GET, POST | yes | `canRecordUsage` | read / write mode | |
| `/api/amc-contracts/[id]/usage/[usageId]/correction` | POST | yes | `canCorrectUsage` | read mode + rule | |
| `/api/amc-contracts/[id]/cancel` | POST | yes | approver | approver sees all | |
| `/api/amc-contracts/[id]/renewal` | GET, POST | yes | operate | read / write | |
| `/api/amc-contracts/[id]/reminders` | GET, POST | yes | operate | read / write | |
| `/api/amc-contracts/[id]/links`, `/quotes`, `/quotes/[quoteId]`, `/additional-services`, `/commercial` | various | yes | operate | read / write | |
| `/api/amc-contracts/[id]/fsm`, `/fsm/check`, `/fsm/customer`, `/fsm/links`, `/fsm/links/[linkId]`, `/fsm/appointments/[appointmentId]` | various | yes | operate | read / write | |
| `/api/amc-contracts/activation-preview` | GET | yes | `canActivateContract` | proposal owner | |
| `/api/amc-contracts/coverage`, `/summary`, `/reports` | GET | yes | canUseAmc | `seesAll` or own | |
| `/api/amc-contracts/customers`, `/customers/[customerId]`, `/customers/[customerId]/properties`, `/properties/[propertyId]` | GET, POST, PATCH | yes | canUseAmc; edit: `canEditCustomer` | creator / `seesAll` | |
| `/api/amc-contracts/assessments` and children (`complete`, `photos`, `photos/[photoId]`, `proposal`) | various | yes | canUseAmc; edit: creator, approver or ops edit | `canReadAssessment`; list filtered by creator | |
| `/api/amc-contracts/fsm/context` | GET | yes | canUseAmc | `seesAll` | |
| `/api/amc-contracts/fsm/work-order` | GET | yes | `canLookUpFsmWorkOrder` | contract owner when `contractId` given | |
| `/api/amc-contracts/fsm/services` | GET, PUT | yes | edit: approver | | |
| `/api/amc-contracts/settings/checklist`, `/discount`, `/notifications` | GET, PUT | yes | edit: approver | | |
| `/api/amc-contracts/reminders` | POST | internal signature | server only | | |
| `/api/amc-notifications` | GET, POST | yes | canUseAmc | the caller's own rows | |
| `/api/amc-settings` | GET, PUT | yes | read: AMC user; write: admin | | |
| `/api/amc-submissions`, `/approval`, `/history`, `/pending-approvals`, `/send` | various | yes | canUseAmc + AMC actions | owner / approver | |
| `/api/amc-submissions/signed-document` | GET, POST | yes | GET `canReadContract`, POST `canOperateContract` | yes | |
| `/api/amc/[token]` | GET, POST | no | | the one proposal | yes, hashed, expiring, rate-limited |

The full list of the 158 API routes and their gates was produced by a static scan during this phase. The 11 routes without a recognised session gate are: `/api/amc/[token]` and `/api/report/[token]` (public tokens); `/api/auth/check-email` (pre-login, now rate-limited); `/api/graphql` (one allowlisted read of public settings); two cron routes behind `CRON_SECRET`; the Snagging mobile sync routes (bearer-authenticated, outside AMC); and the scheduling attribute lists (their own factory gate).

## 5. RLS expectations per table

After every migration on this branch is applied:

| Table(s) | anon | authenticated | Written by |
|---|---|---|---|
| `amc_contracts`, `amc_contract_entitlements`, `amc_entitlement_usage`, `amc_renewal_reminders` | nothing | nothing | service role via API |
| `amc_fsm_service_mappings`, `amc_fsm_links`, `amc_fsm_sync_events` | nothing | nothing | service role |
| `customers`, `customer_properties` | nothing | nothing | service role |
| `amc_assessments`, `amc_assessment_items`, `amc_assessment_checklist`, `amc_assessment_photos` | nothing | nothing | service role |
| `amc_additional_service_discount`, `amc_additional_quotes` | nothing | nothing | service role |
| `amc_notifications`, `amc_notification_settings`, `amc_signed_documents` | nothing | nothing | service role |
| `amc_submissions` | nothing | read only (main still reads it with a session) | service role |
| `amc_settings`, `amc_audit_events` | nothing | nothing | service role; audit rows are insert-only (no-update rule) |
| `roles`, `role_access`, `user_profile` | nothing | read only | service role via `/api/users`, `/api/roles`, `/api/role-access` |
| `settings` | public branding columns only | public branding columns only | service role |
| `password_resets`, estimate tables, `todos`, scheduling, leave, lookup and todo child tables | nothing | nothing (`technician_reference`: read only) | service role |
| Storage `amc-documents` | nothing | nothing | service role; signed URLs only |
| Storage `uploads` | public read (other modules) | upload own files, update own files | portal avatars and logos |

**Immutability.** Usage is a ledger: a correction is a new row that points at the old one; nothing is updated or deleted. Audit events cannot be updated. Signed documents are stored once, with a hash. Contracts and the proposals they came from are `RESTRICT` on delete. After migration 15 the proposal owner FK is also `RESTRICT`, so deleting a user cannot remove AMC history. The `/api/users` DELETE then answers 409, "Deactivate the user instead".
