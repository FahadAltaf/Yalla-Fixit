# AMC Implementation Plan: BRD v0.3 / Jira DEV-346

**Date:** 6 October 2026. **Branch:** `amc-hardening`.
**Scope:** *AMC Generation and Tracking BRD* v0.3 (23 Sep 2026), broken down in Jira as DEV-347 to DEV-430 (84 subtasks under DEV-346).
**Starting point:**
- `docs/amc-brd-v0.3-gap-analysis.md`: 78 of 524 requirements implemented.
- `docs/amc-dev-346-subtask-status.md`: 31 subtasks partial, 53 not started.

**Goal of this plan:** every non-blocked subtask built, working end to end, and demonstrable to the client, one subtask at a time. The 8 subtasks that need an outside answer are built last (Phase 15).

---

## 1. Ground rules for every task

1. **`main` is live production and stays read-only.** All work is on `amc-hardening`. No merge to `main` and no production deployment inside this plan. Release is Phase 15, and only with your approval.
2. **One subtask at a time.** Each task follows the same steps:
   1. code;
   2. migration (if any);
   3. tests: unit tests, the local database harness, typecheck, lint, build;
   4. a check in the browser against the demo database;
   5. a commit.

   You then get the migration file to apply, the SQL to verify it, and what to click to see the feature.
3. **Migrations are additive and never edited once applied.** Fixes go in a new migration. Each new table:
   - has RLS on, with nothing granted to `anon` or `authenticated`;
   - is reached only through the portal API.
4. **Every migration is classified** `SAFE BEFORE CODE DEPLOY` or `REQUIRES NEW CODE FIRST` (against today's live `main`). It is tested twice on a local PostgreSQL (the harness) before you apply it.
5. **Never run `supabase db push` against production.** Its migration history does not match the repo. Old files would be replayed, and some of them recreate open policies, duplicate rows or drop tables (`docs/amc-hardening-production-runbook.md` §3–§5). Apply files one at a time, by name, as each task tells you.
6. **Configurable, not hard-coded.** Every BRD value marked "to confirm" is a setting with a sensible default (§5), so open questions never block a task.
7. **Every status change is recorded** with user, time and reason. This feeds BRD 6.9.
8. **The demo runs on the live database, so it must not disturb live users** (decision of 6 Oct 2026, §3):
   - every migration must be harmless to today's `main`, or it is held until release;
   - AMC emails go to a test inbox while the redirect is on;
   - AMC to-dos go only to the users on the AMC records;
   - AMC visits are not written into the live scheduling tables until they are published (Phase 15);
   - AMC never writes to Zoho FSM before Phase 15.

---

## 2. What the client demo will show (the end-to-end story)

1. **Enquiry:** an enquiry is logged (source, contacts, need), followed up, and moves through the stages. An idle one gets flagged.
2. **Prospect:** the prospect's property is captured once, with its assets and access rules. A commercial prospect gets a site visit.
3. **Proposal:** a proposal opens from the prospect, priced from the governed rate card (packages, promotions, floor rates).
4. **Approval:** the discount crosses a threshold, so the proposal goes up the approval ladder, level 1 then level 2. Nobody can approve their own.
5. **Sharing:** the approved version is shared by email (Email 1) and by a prepared WhatsApp text to two contacts. The send log records each one.
6. **Decision:** the client asks for a revision through the link, so V2 is created with a reason. V1 stays locked with its PDF. The client approves V2.
7. **Contract:** the contract is created with its own number and entitlements. The client and internal signatories sign in order, and an unsigned reminder goes out (Email 2).
8. **Payments:** the payment plan comes from the value band. The contract waits in Pending Initial Payment until the first instalment (or a cheque) is recorded, or someone overrides with a reason.
9. **PPM schedule:** a tentative schedule is generated with service windows and holidays skipped. It is adjusted, clubbed and confirmed.
10. **Confirmation and assignment:**
    - a confirmation to-do and client request go out, and attempts are logged;
    - the access status (gate pass) is tracked;
    - the visit is placed on the scheduling board with a competent technician suggested.
11. **Visit closure:**
    - the job sheet is recorded and submitted;
    - the supervisor reviews and closes it, or returns it;
    - a partial visit reschedules the remaining trade;
    - the service report goes out within 48 h (Email 3).
12. **Call out:** an emergency call out is logged. The coverage check says covered or chargeable, the SLA clock runs, and additional work is raised with its parties and quoted.
13. **Allowances:** units are reserved, consumed and released, with an audit trail and a near-zero warning.
14. **Reporting:** the client report, operational and commercial reports, and the management dashboard.
15. **Renewal:** a reminder fires, the renewal draft applies the escalation % with last year's history beside it, and the outcome is recorded. A hold or termination request needs approval.
16. **Throughout:** portal notifications on the home page, to-dos, and roles that show different screens to different people.

Not in the demo (Phase 15, blocked):
- Zoho Sign;
- PayTabs/NomuPay links;
- Zoho Finance invoices;
- pushing AMC visits and contracts into FSM;
- FSM job-sheet fields and offline;
- profitability.

---

## 3. Environment and migrations: what you apply, where, in what order

**Decision (6 Oct 2026): the demo runs on the production database.**
- Apply only migrations that cannot disturb the live system.
- Hold the ones that would until the new code is released.
- The AMC demo data already in production is used; no separate demo data is loaded.
- The three AMC tables already live (`amc_submissions`, `amc_settings`, `amc_audit_events`) are kept, and only extended.

### How "safe for live" was checked

Every one of the 16 branch migrations was compared with what today's live `main` does, in two ways:
- **Test replay:** main's 39 queries (23 AMC) were replayed on a local copy after each migration.
- **Code check:** every place `main` reads these tables was traced.

The results:
- `main` writes AMC rows, to-dos, scheduling and lookup tables only through the service role, which the new rules don't affect.
- It reads one table with a user session (`technician_reference`), and the migration keeps that read open.
- It uploads files with the signed-in user's session to new paths, which the new upload rule allows.
- It uses no realtime subscriptions.
- The AMC migrations only **add** tables, nullable columns and allowed values to live tables. No existing row is changed or removed.

### Group A: apply to production now (no effect on live screens)

| Order | File | What it changes in production | Effect on live users |
|---|---|---|---|
| 1 | `20261005100000_amc_close_direct_writes.sql` | Removes browser write permissions on `amc_submissions`, `amc_settings`, `amc_audit_events` | None: live `main` writes through the server |
| 2 | `20261005110000_amc_proposal_number_beyond_9999.sql` | Replaces the proposal-number function (same format; no truncation after 9,999) | None |
| 3 | `20261005150000_restrict_shared_allow_all_policies.sql` | Closes `schedule_audit_events` to the public key | None: written by the server only |
| 4 | `20261006100000_active_amc_contracts.sql` | New contract, entitlement and usage tables; adds `renewal_of_contract_id` (nullable) to `amc_submissions`; allows audit type "contract" | None |
| 5 | `20261006110000_active_amc_operations.sql` | Usage corrections, renewal reminders; allows to-dos to point at an AMC contract | None |
| 6 | `20261006120000_amc_fsm_integration.sql` | New FSM link, mapping and sync tables | None |
| 7 | `20261006130000_amc_business_operations.sql` | New customers, properties, assessments, quotes tables; adds nullable `customer_id`, `property_id`, `assessment_id` to `amc_submissions` | None |
| 8 | `20261006140000_amc_atomic_activation_and_dashboard.sql` | Database functions only | None |
| 9 | `20261006150000_amc_business_completion.sql` | Notifications, signed archive, photos; creates the **private** bucket `amc-documents` | None |
| 10 | `20261006161000_todos_and_uploads_tightened.sql` | `todos` closed to the public key; uploads to `uploads` only by signed-in users, updates only by the file's owner | None expected. **Check right after:** upload a profile photo, open Todos |
| 11 | `20261006162000_amc_history_survives_user_deletion.sql` | Deleting a user who owns AMC proposals is refused instead of deleting the proposals | Protects data. An admin who deletes such a user sees an error and should deactivate the user instead |
| 12 | `20261006163000_shared_tables_server_only.sql` | 12 scheduling, lookup, FSM-snapshot and to-do child tables closed to the public key (technicians stay readable when signed in) | None expected. **Check right after:** open the scheduling board, technicians, leave and a to-do |

### Group B: hold until the new code is released (Phase 15)

| File | Why it waits |
|---|---|
| `20261005160000_settings_hide_zoho_token.sql` | Live `main` reads settings through GraphQL with the public key |
| `20261005170000_estimate_tables_server_only.sql` | Live estimate screens read these tables in the browser |
| `20261005180000_password_resets_server_only.sql` | Live password reset uses the public key |
| `20261006160000_role_tables_server_only.sql` | Live users, roles and permissions screens use GraphQL with the public key |

The new code works with or without these four (they only remove permissions), so the demo is unaffected.

### Steps (you run them; I never handle credentials)

| Step | Action | Check |
|---|---|---|
| P1 | **Backup.** In the Supabase dashboard, confirm today's backup exists (Database → Backups). Also keep a copy of the data:<br>`npx supabase db dump --db-url "<PRODUCTION_DB_URL>" --data-only -f amc_backup_2026-10-06.sql` (keep the file outside the repo) | Backup listed; file saved |
| P2 | Run the **pre-check** SQL (`docs/production-migration-checks.md`, read-only) | Matches the expected output. If not, stop and tell me |
| P3 | Apply Group A **in order, one file at a time**. Either use the SQL editor (paste the whole file, run), or:<br>`psql "<PRODUCTION_DB_URL>" -v ON_ERROR_STOP=1 -1 -f supabase/migrations/<file>`<br>(`-1` runs the file as one transaction, so it fully applies or not at all) | Each finishes without error |
| P4 | After files 10 and 12, do the live checks in the table above | Uploads, Todos and Scheduling work as before |
| P5 | Run the **post-check** SQL in the same document | All new tables present, RLS on, nothing granted to the browser roles, `amc-documents` private |
| P6 | Record each applied file and the time in `docs/production-migration-log.md` | Log complete. At release these files are marked "applied" in Supabase's migration history (runbook §3), so they never run twice |
| P7 | Never use `supabase db push` on production | — |

**New migrations from later phases.** Each is written so that it is harmless to live `main`, and comes with its pre-check, post-check and any live check. You apply it the same way after its task is done. Any migration that can't be made harmless is held in Group B and says so in its header.

### Running the demo app

- The new code (`amc-hardening`) runs locally (`npm run dev`) or as a preview deployment, pointed at the production database (today's `.env`). Live users keep using `main`. Both share the database safely because of the rules above.
- Set `EMAIL_REDIRECT_TO=<a test inbox>` in the demo app's environment (Phase 0.3). While it is set, every AMC email goes there, so demo records never email a real client or member of staff.

## 4. Data design for the new scope

These design choices apply across phases and are fixed now, so that later tasks don't contradict each other.

| Concept | Design | Why |
|---|---|---|
| Prospect / client | **One record**: `customers` with a `lifecycle` (`prospect` → `client` → `former`). Enquiries, properties, proposals and contracts hang off it | BRD 5.9 "nothing is retyped": the prospect *becomes* the client |
| Enquiry | `amc_enquiries` + `amc_enquiry_follow_ups`. Stages, sources and lost reasons are configurable lists | BRD 5.1, DEV-347 |
| Contacts | `amc_customer_contacts` (role: primary, alternate, accounts, tenant, signatory; any number) | BRD 5.9 |
| Property | Extend `customer_properties`: full type list, structured address (building, floor, unit), floors/zones, occupancy, `parent_property_id` for combined units | BRD 5.2; fixes wrong-list issue (#9) |
| Assets | `amc_property_assets` (type, trade, location, make, model, serial, condition, status). History is a view over visit lines and call outs | BRD 5.2 |
| Access rules | `amc_property_access_rules` per property; a per-visit access status in Phase 9 | BRD 5.9, 5.11 |
| Scope | `amc_scope_items` per property/enquiry (trade, service, asset qty, frequency, duration, preferred months/days, exclusions). Captured once, then prefills proposals and schedules | BRD 5.2, DEV-360 |
| Documents | `amc_documents` in the private `amc-documents` bucket. Level (enquiry, prospect/client, property, contract, visit, call out), category, auto version, expiry | BRD 5.9 |
| Rate card | `amc_rate_card_versions`: the whole card (services with unit, standard and floor rate, allowed frequencies, model; packages; promotions) saved as one versioned JSON document with `effective_from`, changed by, reason. This is Snagging's singleton card + change log, made versioned. Every proposal line records the version it was priced from | BRD 5.3; Snagging `snagging_pricing_config` + `_log` |
| Proposal versions | `amc_proposal_versions`: frozen data, PDF stored server-side, reason, summary, final price, active flag. `amc_submissions` stays the proposal header | BRD 5.4; fixes overwrite issue (#2) |
| Approvals | `amc_approval_steps` (version, level, triggers crossed, **named approver**, decision, comment, `approval_due_at`, `escalated_at`, escalation level). Approvers per level are named users in configuration, as Snagging names a reviewer and an approval manager per job. No admin override, no self-approval | BRD 5.5; Snagging review routing |
| Send log | `amc_send_log` (version, channel, recipients, user, time, text) | BRD 5.6 |
| Contract | `amc_contracts` becomes a record from **client approval**: own `contract_number`, 11 stored statuses; `start_date`/`end_date`/`signed_at` nullable until reached. Activation becomes a status change | BRD 5.7; fixes contract issue (#4) |
| Signatures | `amc_contract_signatories` (party, order, method link/scan/Zoho Sign, status, time, evidence) | BRD 5.7 |
| Entitlements | Extend `amc_contract_entitlements`: asset quantity, labour cover, material cover, value limit, exclusions | BRD 5.7; fixes quantities issue (#7) |
| Amendments | `amc_contract_amendments` (type, reason, approval, effective date, details) | BRD 5.7, 5.16 |
| Payments | `amc_installments`, `amc_payments`, `amc_cheques`; plan on the contract | BRD 5.8 |
| Visits | `amc_visits` (sequence, cycle, window, target, original, confirmed, status, reason group) + `amc_visit_lines` (one per trade or entitlement). Clubbing means several lines in one visit | BRD 5.10, 5.12; fixes clubbing issue (#6) |
| Calendar | `amc_holidays` + weekend days in configuration | BRD 5.10 |
| Confirmation | `amc_visit_attempts` + attempt rule per contract | BRD 5.11 |
| Technician skills | Managed lists (`lookup_options`: skill, area, tool, access permission, vehicle) + assignments with level, certificate, expiry and confirmation (additive columns on the live table) | BRD 5.11, DEV-356 |
| Job sheet (portal side) | `amc_visit_reports`: per-trade outcome, checklist per asset, photos, faults, consumables, pending works, signature name, review state. FSM fields map into it in Phase 15 | BRD 5.12 |
| Call outs | `amc_call_outs` with SLA deadlines, coverage snapshot, status | BRD 5.13 |
| Additional work | `amc_additional_works`: finding apart from commercial; parties; 9 statuses; 20% fee. It links the existing `amc_additional_quotes` | BRD 5.14 |
| Allowance movements | `amc_entitlement_usage` gains `reserve` and `release` kinds; a trigger keeps `reserved_quantity` | BRD 5.14 |
| Configuration | `amc_config` (one row per key, validated, audited) | DEV-357 |
| Timed rules | One protected endpoint, `/api/amc/jobs/run` (POST, `CRON_SECRET` as `x-cron-secret` or Bearer; a missing secret means closed), called by the same external scheduler that runs the Snagging escalations. Each sweep stamps a row before any side effect (claim, then email/to-do/notification), exactly like `app/api/snagging/approvals/escalations/run`. Admins also get a **Run now** button for the demo | Idle enquiries, escalations, reminders, overdue, SLA at risk, 48 h report |
| To-dos | The existing Todos module, with related types for AMC records; one helper creates and closes them | BRD 6.8 |
| Notifications | `amc_notifications` (exists), extended with every BRD event; home-page panel + inbox | BRD 6.2 |
| Messages | Templates in configuration. "Prepared message" dialog with a `wa.me` link per contact and an SMS text | BRD 6.3 |

---

## 4a. Built the Snagging way: the pattern each AMC area copies

AMC and Snagging must look and work the same. Every AMC feature below reuses the Snagging pattern and helpers named here (paths relative to the repo). Where the BRD needs more than Snagging has, the extension is stated.

| AMC area (BRD) | Snagging pattern reused | Extension for AMC |
|---|---|---|
| **Client list and profile** (5.9) | `snagging/clients`: a server page reads the first page through a shared `listX()` helper (`lib/server/snagging/client-list.ts`); `DataTable` + toolbar in `components/data-table/toolbars/`; find-or-create resolvers `resolveClient` / `resolveProperty` (`lib/server/snagging/client.ts`, `property.ts`); live record + frozen snapshot on the job | BRD 5.9 asks for one page per client, which Snagging does not have (its profile is dialogs off the list). The AMC client page uses the Snagging job-detail layout instead: `Tabs` with `?tab=`, sections pre-read on the server (`inspection-detail.tsx`, `job-detail-sections.ts`) |
| **Properties and combined units** (5.2) | `snagging_properties` fields and type-conditional rules (`propertyColumns()`), deed/NOC uploads on the property | A parent/child link and floors/zones, which Snagging lacks |
| **Proposal sharing and the client decision** (5.6) | Snagging quotation approval, exactly as the BRD says: token minted on send/share, only its hash stored, 30-day expiry, **written before the email is sent and rolled back if the email fails**, decide-once helpers shared by the portal and the public page (`lib/server/snagging/quotation.ts` `approveQuotation` / `rejectQuotation`), public page asks the approver's name first (`app/quote/[token]`), `share_link` for WhatsApp (copy link + download PDF), coordinator records a decision by hand. Generic token helper: `lib/server/link-token.ts` | Adds the third answer "Request revision" (`changes_requested`), versions, several recipients, a prepared WhatsApp text and a send-log table (Snagging logs sends only as audit rows) |
| **Rate card and pricing** (5.3) | `snagging_pricing_config` (whole card, admin-edited, change log), a pure pricing module shared by server and live preview (`lib/server/snagging/pricing.ts`), the quote records the suggested vs chosen rate with `rate_outside_band` + `rate_override_reason` and an approval gate before sending (`approve_rate`) | Card versions with `effective_from`; packages and promotions; the floor-rate gate feeds the approval ladder (5.5) |
| **Approvals and escalation** (5.5) | Named approvers per record (reviewer, approval manager), stored `approval_due_at`, `escalated_at` stamp, hourly runner that claims before acting (`lib/server/snagging/workflow.ts`, `decision-gate.ts`, `approvals/escalations/run`), "waiting on me" queue + notice that polls every 60 s (`approvals/pending`, `approval-notice.tsx`) | Several levels in sequence (escalation level + next escalation time), four triggers, to-dos (Snagging makes none) |
| **PPM visits** (5.10–5.11) | `snagging_job_visits`: visits are appointment rows under one parent, with status, date, time, assignee roster (`snagging_job_inspectors`, `visit_inspectors`, `lib/server/snagging/job-roster.ts`); advisory clash check enforced again on save (`app/api/snagging/availability`) | Service windows, cycles, clubbing (visit lines per trade), attempts, holidays |
| **Visit review and closure** (5.12) | Snagging review flow: submitted → in review → approved/returned with a reason, sign-off rows cleared by trigger when work is reopened (`snagging_job_signoffs`, `signoffs.ts`, `tasks/[id]/visits/[visitId]/review`) | Mandatory review rules, five reason groups, per-trade partial completion |
| **Documents and media** (5.9) | Private bucket, object keys by record, short signed URLs on demand (`lib/server/snagging/media.ts` `signPaths`), roster-gated download routes (`tasks/[id]/gatepass`, `noc`), multipart upload limits (`app/api/snagging/documents`) | An `amc_documents` table with category, version and expiry (Snagging only has path columns) |
| **Service report, client report, proposal PDF** (5.12, 5.15, 5.4) | Report pipeline: data → HTML → headless-Chrome PDF → versioned row → token link with channel, recipient, open count and revoke (`report-data.ts`, `report-html.ts`, `report-pdf-headless.ts` `renderPdfFromHtml`, `report-generate.ts`, `snagging_report_versions`, `snagging_report_tokens`, `tasks/[id]/deliver`) | Same pipeline for proposal versions, the service report (Email 3) and the client report |
| **Audit and status history** (6.9) | Append-only audit table written after the response, never throwing (`lib/server/snagging/audit.ts`); AMC already mirrors it in `amc_audit_events` / `lib/server/amc/audit.ts` | One helper for every new AMC entity's status changes |
| **Email** (6.1) | `sendEmail` (`lib/server/send-email.ts`) + branded template `clientEmailHtml` (`lib/email-brand.ts`) | The four BRD emails, with the demo redirect |
| **Permissions** (6.7) | `hasResourceAction` gates; a master-data resource for the catalogue and rate card (`SNAGGING_CATALOGUE` → `AMC_RATE_CARD`); decisions by name on the record; RLS on with no policies (server-only) | Per-trigger approval levels, payment and allowance override rights |
| **Screens** | Server `page.tsx` reads the first page and passes `initial`; `DataTable` with server paging and sorting, toolbar, `EmptyState` / `ErrorState`; columns in `components/data-table/columns/column-*.tsx` (the `column-user.tsx` shape); `loading.tsx` with route skeletons; shared kit `components/dashboard/shared/kaizen` (`SectionCard`, `DataRow`, `PillTabs`, `PageHeading`, status badges, `useConfirm`, `ActionDialogContent`); export menu | Same components for every new AMC list and detail page; the design-inspiration references for anything new |
| **Settings** | `/settings/snagging` for configurable values; catalogue screens gated by the master-data resource | AMC configuration lives next to `/settings/amc` (DEV-419) |
| **Mobile and technicians** | Snagging has its own app (`getRequestUserAccess` cookie-or-Bearer auth, idempotent outbox, signed direct uploads) | AMC technicians use the **Zoho FSM app** (BRD 5.12). The portal job sheet (Phase 10) is filled from FSM later. Any AMC route a mobile client might call uses `getRequestUserAccess` |
| **Zoho** | Snagging makes no Zoho calls | AMC reuses `lib/server/zoho/*` (`fsmFetch`, `createFsmAppointment`, work orders, contacts) and the signed Edge Function calls |

## 4b. Zoho and other external APIs needed

The portal already holds a Zoho FSM connection (an OAuth refresh token in `settings`, refreshed by the `token-refresher` Edge Function). It reads work orders, appointments, contacts and users, creates and reschedules appointments, and moves estimates between states. What each blocked or FSM-dependent task needs:

| # | API | Used for (Jira) | What I need from you |
|---|---|---|---|
| Z1 | **Zoho FSM: Contacts** (search, create, update), and **Companies** if commercial clients are companies in FSM | Prospect → client → FSM customer (DEV-378) | Confirm the refresh token's scopes cover create/update on Contacts (and Companies); whether commercial clients are Contacts or Companies |
| Z2 | **Zoho FSM: service addresses** on the contact | Properties ↔ FSM addresses (DEV-378, 391) | Confirm properties should become FSM service addresses |
| Z3 | **Zoho FSM: Work Orders** (create with service lines, update, cancel) and **Service Appointments** (create, update, cancel; read status, `Actual_Start`/`Actual_End`) | AMC visits and call outs in FSM (DEV-391); SLA times (DEV-406) | One work order per visit or per contract; required work-order fields and layout; the field holding arrival time |
| Z4 | **Zoho FSM: Services and Parts** (list) | Map rate-card services to FSM service lines for work orders and estimates (DEV-391, 407) | Confirm the catalogue to map to |
| Z5 | **Zoho FSM: Estimates** (create with lines; transitions already work) | Additional work quotations (DEV-407) | Required estimate fields |
| Z6 | **Zoho FSM: Assets** (list/create per contact or address) | Asset register sync and asset history (DEV-361) | Whether assets should live in FSM too, or only in the portal |
| Z7 | **Zoho FSM: job sheet / service report fields** added by the FSM admin, and how to read them (API names; attachments for photos and signature) | Per-asset checklist, photos, allowance flag, additional work, pending works, signature (DEV-400) | The FSM admin adds the fields and sends me their API names |
| Z8 | **Zoho FSM: Time sheets** and parts used on appointments | Labour hours and material cost (DEV-413) | Confirm technicians log time and parts in FSM |
| Z9 | **Zoho FSM: webhooks / workflow notifications** to a portal URL on appointment status change | Submitted/Completed without polling (DEV-402, 409) | Whether FSM workflow can call a URL; otherwise we poll |
| Z10 | **Zoho FSM: the record Finance looks at** for a signed contract | DEV-377 | Module or field (e.g. a custom module "AMC Contracts" or fields on the Contact) |
| Z11 | **Zoho Books / Finance API**: invoices, customer payments, contacts (read; create if the portal raises invoices); webhooks for invoice and payment status | Invoices and receipts per instalment, balance, resend (DEV-387, 383) | Organization ID; scopes; how an invoice references the contract and instalment; trigger and direction (Finance) |
| Z12 | **Zoho Sign API**: create a request from a template, signer order, status webhook, download the signed PDF | Signing route (DEV-375) | Whether Zoho Sign is used; templates for residential and commercial; webhook support |
| X1 | **PayTabs** and **NomuPay** payment-link APIs with a result callback | Link per instalment (DEV-385) | Merchant/profile IDs, sandbox access, callback setup |
| X2 | **WhatsApp Business API and an SMS gateway** (any provider) | Only if the portal sends messages itself (DEV-422) | Whether automatic sending is wanted; the provider |

**How to give access.**
- **Never paste secrets into chat.** Put keys in the server environment (`.env` of the demo app, without a `NEXT_PUBLIC_` prefix) and in the Supabase Edge Function secrets. Tell me only the variable names.
- Field API names, module names, template IDs and documentation links can be shared in chat.
- **Strong recommendation: a Zoho FSM sandbox, or a test territory.** The demo runs on the production database, and any FSM write would land in the live FSM that technicians use.

## 5. Default values for the open questions

All of these are editable in the configuration screen. The demo uses the defaults. **Please confirm or change them with the business; none blocks development.**

| Setting | Default | BRD / Jira |
|---|---|---|
| Enquiry stages | the 12 BRD stages | 5.1 |
| Lost reasons | price, competitor, scope, no response, deferred | DEV-359 |
| Idle enquiry | flag after 5 days without activity; management after 10 | 5.1 |
| Site visit required | commercial categories; **flag**, don't block | 5.2, DEV-362 |
| Proposal validity | 30 days | 5.4, DEV-366 |
| Approval triggers | discount > 10% → level 1 (department head); > 20% → level 2 (management); final value > AED 50,000 → level 2; non-standard plan → level 1 + Finance; below floor → level 1 | 5.5, DEV-369 |
| Approval escalation | 24 hours | 5.5 |
| Payment bands | < AED 4,000 single; ≥ 4,000 50/50 (default), quarterly or monthly allowed | 5.8 |
| Unsigned reminder | every 3 days, up to 3 times | 5.7 |
| Late first payment alert | 7 days after signing | 5.8 |
| Cheque alert | 3 days before the cheque date | 5.8 |
| Working calendar | weekend: Sunday; UAE public holidays 2026–2027 loaded | 5.10 |
| Service window | first 15 days of each cycle; first cycle starts on the commencement date | 5.10, DEV-388 |
| Confirmation lead time | 7 days before the window | 5.11 |
| Attempt rule | 3 attempts, 2 days apart, WhatsApp then call then email; escalate to the coordinator's lead | 5.11 |
| No-show rule | 2 consecutive no-shows count as a consumed visit | 5.11 (contract clause) |
| Standard durations | 60 min per service line, 30 min per extra AC unit | 5.11, DEV-396 |
| SLA | emergency logged ≤ 60 min, attended ≤ 120 min; non-emergency scheduled ≤ 48 h; minor fix ≤ 2 h; same for every package | 5.13, DEV-406 |
| Service report deadline | 48 hours after the visit | 5.12 |
| Allowance warning | when 1 unit remains | 5.14 |
| Allowance reset | per contract year | 5.14, DEV-409 |
| Material handling fee | 20% | 5.14 |
| Renewal reminder | 30 days before expiry (allowed 30–60); escalate to management after 15 idle days | 5.16, 6.8 |
| Renewal escalation | 5% | 5.16 |
| Termination | 30 days' notice; pro-rata refund of unused months, approver can adjust | 5.16, DEV-417 |
| Self-approval | **never allowed** (decided by the BRD) | 5.5, 6.7 |

---

### Questions answered by assumption (to be confirmed at the end)

Development continues on these assumptions. Each is a setting or an isolated rule, so a different answer is a small change. Please send answers when you have them.

| # | Question | Assumption used now |
|---|---|---|
| Q1 | Build order: operational core first (BRD 5.17, Jira DEV-358) or commercial first? | Dependency order: Phases 1–7 (commercial chain), then 8–13. The operational screens can be moved earlier on request |
| Q2 | Approval thresholds and the approver per level | §5 defaults; level 1 = AMC department head, level 2 = management (named users in configuration) |
| Q3 | Payment value bands | Below AED 4,000 single; from 4,000: 50/50 default, quarterly or monthly allowed |
| Q4 | Proposal validity | 30 days |
| Q5 | When is a site visit mandatory, and does a missing one block or flag? | Commercial categories; flag |
| Q6 | Do visit allowances scale with asset quantities (units)? | No. Quantities are recorded and printed; the allowance is per service as today |
| Q7 | Allowance reset basis | Per contract year |
| Q8 | Renewal reminder lead time and escalation % | 30 days before expiry, escalate after 15 idle days; 5% |
| Q9 | Unsigned reminder and late-first-payment timings | Every 3 days (3 times); 7 days |
| Q10 | Working week and holidays | Sunday off; UAE public holidays 2026–2027 |
| Q11 | Default service window; does the first window start at commencement? | First 15 days of each cycle; yes |
| Q12 | Standard durations per service | 60 min per service line, +30 min per extra AC unit |
| Q13 | Do SLA values apply to every package? | Yes |
| Q14 | Refund rule on early termination | 30 days' notice; pro-rata of unused months; approver can adjust |
| Q15 | Cheque bounce charges and replacement process | Charge entered by Finance; replacement cheque linked to the bounced one |
| Q16 | Who holds department head, Finance, supervisor and override roles? | The role templates in §6; an admin assigns people |
| Q17 | Who confirms a technician as competent; where vehicle and tool data come from | The AMC department head or a supervisor; entered in the portal |
| Q18 | Signing route | Portal link + signed scan now; Zoho Sign in Phase 15 |
| Q19 | Which FSM record a signed contract links to (DEV-377) | Deferred to Phase 15; the portal keeps the FSM contact link |
| Q20 | One FSM work order per contract or per visit (DEV-391) | Deferred to Phase 15; designed for one per visit |
| Q21 | Should the portal send WhatsApp/SMS itself? | No for now: prepared messages that the coordinator sends |
| Q22 | Number formats | Proposal AMC-YYYY-NNNN (unchanged), contract AMC-C-YYYY-NNNN, enquiry ENQ-YYYY-NNNN |
| Q23 | Are AMC customers the same people as Snagging clients? | Separate records, linkable (`customers.snagging_client_id`), as the existing schema allows |
| Q24 | Staff emails for portal notifications | BRD 6.2 says portal notifications; emails only for the four BRD emails plus the existing workflow emails |
| Q25 | 20% material handling fee | Applied to material lines only, on additional work |
| Q26 | VAT | 5% (unchanged) |

## 6. Roles (DEV-418), used by every phase

Permissions stay configurable in the existing Roles screen. New AMC permission resources:
- `amc_enquiries`
- `amc_rate_card`
- `amc_config` (Approve = thresholds and bands)
- `amc_payments` (Approve = gate override)
- `amc_visits` (Approve = supervisor closure)
- `amc_allowances` (Approve = override/reversal)

These sit next to the existing `amc` and `amc_operations`. The plan seeds these role templates; you can edit them:

| Role | Can |
|---|---|
| Management | Everything visible; approval level 2; set thresholds and bands; dashboard |
| AMC department head | Rate card (with Finance); approval level 1; team reports; all AMC records |
| Finance | Rate card; payment schedules, cheques, gate override; collections reports |
| Sales / pre-sales | Enquiries, site visits, proposals (create/edit); no approval |
| AMC coordinator | All prospects, clients and contracts (BRD 6.7); proposals, sharing, schedule, confirmation, access, assignment, call outs, renewals; publish schedule without approval (DEV-394) |
| Supervisor | Review and close visits (only role that closes flagged visits); allowance reversal |
| Technician | No AMC portal access; own jobs in the FSM app |
| Administrator | Configuration (except thresholds/bands), templates, calendars, roles |

---

## 7. The phases

Each phase lists its Jira subtasks (in the order I will do them), the work, the migration, the screens, the notifications/to-dos/emails/messages it adds, its tests, and what you see when it's done. Size is relative: S, M, L, XL.

### Phase 0: Environment, safety and baseline fixes (no Jira subtask; prerequisite)

**Status (7 Oct 2026):** 0.3, 0.4 and 0.5 done in code (184 tests, typecheck, lint, harness and main-compatibility all pass). 0.1 and 0.2 are yours; 0.6 follows once Group A is applied.

| # | Task | Size |
|---|---|---|
| 0.1 | You push `amc-hardening` (2 local commits): `git -C "C:/Users/Technisia/Documents/Prohelp-Work/Yalla Fixit" push -u origin amc-hardening` | S |
| 0.2 | Backup, pre-check, apply Group A, live checks, post-check, migration log (§3 P1–P6) | M (you) |
| 0.3 | Demo safety switches for the live database: `EMAIL_REDIRECT_TO` sends every AMC email to a test inbox. AMC to-dos go only to the users on the record. No AMC code writes to Zoho FSM before Phase 15 (checked) | S |
| 0.4 | Quick fixes: self-approval off (+ test); non-emergency SLA 48 h; remove the stale photo text; correct the validity wording | S |
| 0.5 | Migration `20261007100000_amc_audit_events_guard.sql`: replace the audit table's silent RULEs with a trigger that raises, and set `actor_id` to `NO ACTION` (users are deactivated, not deleted). **SAFE BEFORE CODE DEPLOY**. This is also the fix for the live user-deletion error | S |
| 0.6 | Smoke test of the existing AMC flow in the demo app, using the existing AMC demo data (proposal → approval → link → sign → activate → usage → renewal) | S |

**Done when:** Group A is applied and logged, live screens are unaffected, and the existing AMC works end to end in the demo app.

### Phase 1: Foundation: configuration, roles, platform services

**Status (7 Oct 2026): done in code.**
- **Built:**
  - configuration (13 sections) with history, and a screen at Settings → AMC configuration;
  - six new permission areas and six AMC role templates (one-click, admin);
  - corrections limited to an authorised role;
  - status-history helper, AMC to-dos with escalation, and the generic notify;
  - home notifications panel and the `/notifications` inbox;
  - templates for the 4 emails and 8 messages, with WhatsApp links;
  - the scheduled-job runner `/api/amc-jobs/run` with Run now.
- **Migration:** `20261007110000_amc_platform_foundation.sql` (live-safe; checks §6 of the check sheet).

| Jira | Work | Size |
|---|---|---|
| DEV-357 | `amc_config` with validated keys for every §5 value; every change audited (who, when, old, new) | M |
| DEV-418 | New permission resources (§6); `canUseAmc` and access rules extended; corrections allowed only to the authorised role (issue #10). The role templates are offered as a one-click setup for an admin, not inserted automatically, because the roles table is live | M |
| DEV-419 | Configuration screen (Settings → AMC → Configuration): one section per area. Management-only fields locked for others. Sections are added as phases land | M |
| DEV-424 (base) | One status-change helper used by every new entity (user, time, from, to, reason) | S |
| DEV-421 (base) | Notification panel on the portal home page (until opened), inbox page, bell everywhere | M |
| DEV-423 (base) | To-do helper: create, assign, escalate and close AMC to-dos in the existing Todos module | S |
| DEV-420 / 422 (base) | Template engine for emails and prepared messages (WhatsApp `wa.me` link, SMS text), with placeholders filled from records | M |
| — | AMC sweep runner `/api/amc/jobs/run` + admin "Run now" | S |

**Migration:** `…_amc_configuration_and_roles.sql` (SAFE BEFORE CODE DEPLOY).
**Done when:** an admin edits configuration with history; each demo user sees only their permitted screens; notifications appear on the home page.

### Phase 2: Client, property, assets, access rules, documents

| Jira | Work | Size |
|---|---|---|
| DEV-353 | Model: customer lifecycle, type (individual/company), trade licence + expiry, TRN, marketing consent (with date and source), contacts table, communication log | M |
| DEV-348 | Model: property types (villa, apartment, townhouse, restaurant, clinic, shop, office, other), building/floor/unit, floors/zones, occupancy, parent/child, access constraints; scope items | M |
| DEV-360 | One property-and-scope capture form, reused by enquiry, client page and wizard; parent/child linking | M |
| DEV-361 | Asset register per property: add/edit/retire. History tab (filled from Phase 8/10/11 records) | M |
| DEV-380 | Access rules per property: type, lead time, permitted hours, parking, notes, pass documents | S |
| DEV-381 | Document store: upload/list/version/expire per level; existing signed contracts and assessment photos appear in it | M |
| DEV-379 | Client profile page with tabs: identity, contacts, properties, contracts, payments\*, schedule\*, service history\*, allowances, documents, communication log, consent. \*Filled as later phases land | L |

**Migration:** `…_amc_client_property_assets.sql` (SAFE).
**Done when:** a client with two linked units, assets, access rules and documents can be created and viewed on one page.

### Phase 3: Enquiry pipeline and site visit

| Jira | Work | Size |
|---|---|---|
| DEV-347 | Model: enquiries (number, date/time, source + referrer, contacts, channel, language, area, category, need, owner, stage, next follow-up, lost reason) and follow-ups | M |
| DEV-358 | Enquiry list (filters: stage, owner, source, next follow-up; idle badge) and enquiry form with required-field checks. A prospect customer is created or linked | M |
| DEV-359 | Follow-up log; idle sweep → owner, then management; Lost needs a reason; stage history | M |
| DEV-362 | Site visit: schedule, assign assessor, attendance, asset count checked, condition notes (checklist), photos, access notes, recommended scope, exclusions (extends assessments); proposal lines come from it; the required rule flags (configurable to block) | M |

**Notifications:** new enquiry assigned, follow-up due, enquiry idle, site visit assigned.
**Migration:** `…_amc_enquiries_and_site_visits.sql` (SAFE).
**Done when:** an enquiry goes New → Contacted → Qualified → Details Captured → Site Visit Scheduled, with follow-ups logged, an idle flag shown and a site visit recorded.

### Phase 4: Rate card and proposals

| Jira | Work | Size |
|---|---|---|
| DEV-349 | Model: rate card items, effective-dated prices (standard, floor), units, allowed frequencies, model, retire; packages; promotions | M |
| DEV-363 | Rate card screen: edit only by department head/Finance; history (who, when, old, new, effective from); packages; promotions | M |
| DEV-350 | Submission model: enquiry/customer/property links, validity date, payment plan, versions table, approval steps table (the steps are used in Phase 5). Keep the audit table and settings snapshot | M |
| DEV-364 | Wizard prices lines from the rate card by property model (rate read-only); package picker; promotions in date applied; discount within the user's authority; below-floor lines marked as a trigger. Each line records the rate row it used, so old proposals keep their rate | L |
| DEV-365 | "Create proposal" from an enquiry/prospect: customer, contacts, property and scope prefilled. For commercial, lines and units come from the site visit. New property types | M |
| DEV-366 | Validity date from configuration; payment plan (single, 50/50, quarterly, monthly, custom) replacing monthly/quarterly/annual, with old rows mapped (issue #8). The number already exists | S |
| DEV-367 | Versions: an edit after sharing creates V(n+1) with a required reason and summary. Old versions locked, with their PDF generated and stored on the server. Side-by-side prices. The settings snapshot is never reset (issue #2) | L |
| DEV-368 | Team visibility by role: AMC View sees all proposals; others see their own | S |

**Migration:** `…_amc_rate_card_and_proposal_versions.sql` (SAFE).
**Done when:** a proposal created from a prospect is priced from the rate card, and a revision produces V2 while V1 stays locked with its PDF.

### Phase 5: Approval ladder, sharing and decisions

| Jira | Work | Size |
|---|---|---|
| DEV-369 | Four triggers evaluated on Share. No trigger: share directly. Trigger: Pending Approval → levels in sequence. Approve / Reject / Return with comment, logged. No self-approval. Escalation sweep. A new version re-triggers when the discount rises or the plan changes | L |
| DEV-370 | Client link per version; third answer "Request revision" with a note; rejection needs a reason; send log (channel, recipients, version, user, time); several contacts; residential defaults to WhatsApp, commercial to email; prepared WhatsApp text with the link | M |
| DEV-371 | Coordinator records Approved / Rejected / Revision Requested with mandatory evidence (document store); the approved version locks | S |
| DEV-420 (Email 1) | Email 1 per BRD (subject, body fields, cc coordinator, PDF attached, renewal first line) | S |
| DEV-423 (#1) | To-do "Proposal approval" (prospect, version, price, discount, plan, trigger crossed; approve/reject/return; assignee by level; escalates) | S |

**Notifications:** pending approval (+ escalation); approved/rejected/returned; validity expiring; prospect decision recorded.
**Messages:** proposal shared (prepared).
**Migration:** `…_amc_approval_ladder_and_send_log.sql` (SAFE).
**Done when:** demo story steps 4–6 work.

### Phase 6: Contract and signature

| Jira | Work | Size |
|---|---|---|
| DEV-351 | Model: contract record from client approval with its own number; 11 statuses; nullable dates until reached; enquiry and version links; signatories; amendments; renewal link (exists) | L |
| DEV-372 | Contract created on client approval; commencement date separate from signing; term (≥ 1 year) sets expiry; residential and commercial templates chosen by category. Existing active contracts keep working | L |
| DEV-373 | Entitlements filled from the approved version: frequency, asset quantities (scaling rule configurable), labour, material, call-out allowances, value limits, exclusions; printed in the contract table | M |
| DEV-374 | Internal signatories, configurable order, each tracked; unsigned reminder sweep (resends Email 2) | M |
| DEV-375 (part 1) | Signed scan upload with its date as a signing route, in the same status view. *Zoho Sign → Phase 15* | S |
| DEV-376 | Statuses after signing (Pending Initial Payment, Active, On Hold, Expired, Renewed, Cancelled, Terminated), each change audited with a reason | M |
| DEV-378 (part 1) | Prospect → client on signing + first payment (Phase 7 supplies the payment; until then, on signing). Link an existing FSM customer. *Creating a new FSM customer → Phase 15* | S |
| DEV-420 (Email 2) | Email 2 per BRD (cc coordinator and Finance; start/end, value incl. VAT, plan, first amount) | S |
| DEV-423 (#2) | To-do "Contract follow-up" (resend Email 2, upload scan, record payment, override, snooze) | S |

**Notifications:** contract unsigned.
**Messages:** contract ready to sign (prepared).
**Migration:** `…_amc_contract_lifecycle.sql` (SAFE: live `main` does not use the contract tables).
**Done when:** demo story step 7 works.

### Phase 7: Payments (without external integrations)

| Jira | Work | Size |
|---|---|---|
| DEV-352 | Model: plan on contract, instalments (9 statuses), payments (mode, reference, proof, collector, handover), cheques | M |
| DEV-382 | Plan proposed from the value band; another permitted plan; non-standard plan → approval (Phase 5 ladder); instalments generated on signing with due dates, amounts and VAT | M |
| DEV-383 | Record cash/transfer payments (partial allowed); balance and ageing per contract and client; Finance payments list | M |
| DEV-384 | Cheque register: held → deposited → cleared/bounced, bounce reason and charges, replacement; alerts before the date and on a bounce | M |
| DEV-386 | Initial payment gate: Pending Initial Payment releases no visits until the first instalment is received; authorised override with reason; late-payment alert | M |
| DEV-420 (Email 4) | Instalment due/overdue email | S |
| DEV-423 (#6) | To-do "Instalment overdue" (send reminder, record payment/bounce/replacement, escalate) | S |

**Notifications:** initial payment pending, instalment due, overdue, cheque date near, cheque bounced, payment received.
**Messages:** instalment due (prepared, without a payment link until Phase 15).
**Migration:** `…_amc_payments.sql` (SAFE).
**Done when:** demo story step 8 works.

### Phase 8: PPM schedule

| Jira | Work | Size |
|---|---|---|
| DEV-354 | Model: visits, visit lines (per trade or entitlement), statuses, reasons, attempts, attempt rule per contract, holidays; FSM link moved to visit level (issue #6) | L |
| DEV-388 | Generator on activation (after the payment gate): per service line from commencement, evenly spread, holidays and weekends skipped, windows, targets from preferred months/days | L |
| DEV-389 | Schedule review screen (timeline per contract): adjust (inside window is not a reschedule; outside needs a reason, original kept), add/remove with reason, confirm as plan of record; contract shows completed/remaining/overdue | L |
| DEV-390 | Club trades due in the same window into one visit; separate again; completion per trade | M |

**Notifications:** PPM overdue.
**Migration:** `…_amc_ppm_schedule.sql` (SAFE).
**Done when:** demo story step 9 works.

### Phase 9: Scheduling board, skills, assignment, confirmation, access

| Jira | Work | Size |
|---|---|---|
| DEV-356 | Technician profile: skills per task type with level, certificates with expiry, area, tools, access permissions, vehicle/driver (additive columns on the live scheduling tables) | M |
| DEV-395 | Technician skills screen in the scheduling module (managed lists) | M |
| DEV-392 | Board side panel "AMC to place": confirmed visits with an open window (call outs added in Phase 11). Placing creates a board entry linked to the visit; details travel with it | L |
| DEV-393 | Move to another day inside the window; multi-select move/reassign; original date kept | L |
| DEV-394 | AMC coordinators publish schedule changes without approval (role right) | S |
| DEV-396 | Suggest trade and headcount from the visit lines and standard durations; list only competent technicians filtered by shift, area, workload, team, vehicle/driver, tools, access; accept or override with a reason | L |
| DEV-397 | Block assignment without the skill or access permission (like leave); keep the double-booking check | M |
| DEV-398 | Confirmation flow: to-do N days before the window, client request (prepared message/email), attempts log, rule per contract, escalation, no-show rule; reminders the day before (client) and on the day (technician) | L |
| DEV-399 | Access status on the visit (not required, pending, approved, rejected, expired), pass upload, alert when near without access | M |
| DEV-423 (#3, #4) | To-dos "PPM confirmation" and "Access / gate pass" | S |

**Notifications:** PPM confirmation due, no answer after attempts, access pending.
**Messages:** appointment confirmation, appointment reminder.
**Live-safety design.** AMC visits placed on the board are stored on the AMC visit (technician, date, time) and drawn on the board as an overlay. They are not inserted into the live `schedule_entries` until they are published to FSM (DEV-391, Phase 15). Live coordinators using `main` therefore never see demo visits. Technician skills are new nullable columns and new list keys, which `main` ignores.
**Migration:** `…_amc_technician_skills_and_confirmation.sql` (SAFE: additive columns on live tables).
**Done when:** demo story step 10 works.

### Phase 10: Visit execution and closure (portal side)

| Jira | Work | Size |
|---|---|---|
| — (base for DEV-400) | Portal job sheet for a visit: arrival, completion, per-trade outcome, checklist per asset, before/after photos, faults, consumables, additional work found, pending works + reason, client signature name. The FSM fields fill the same record in Phase 15 | L |
| DEV-402 | Submitted ≠ Completed; supervisor review queue; mandatory review rules (pending works, quality concern, missing evidence, incomplete scope); close (Completed / Completed with Additional Work / Partially Completed) or return with comment | L |
| DEV-403 | Five non-completion reason groups (+ sub-reasons); partial clubbed visit reschedules only the remaining trade | M |
| DEV-404 | Service report (stored PDF) + Email 3 on close; 48 h clock with at-risk flag; prepared WhatsApp with the report link | M |
| DEV-423 (#5) | To-do "Job closure review" | S |

**Notifications:** job sheet not submitted, awaiting review.
**Messages:** service report.
**Migration:** `…_amc_visit_reports.sql` (SAFE).
**Done when:** demo story step 11 works.

### Phase 11: Call outs, additional work, allowances

| Jira | Work | Size |
|---|---|---|
| DEV-355 | Model: call outs, additional works (finding apart from commercial, five parties, 9 statuses), allowance reserve/release movements | M |
| DEV-408 | One entitlement check (quantity, labour, material, value limit, exclusions) → covered/chargeable + balance + why; blocks chargeable-as-free unless an authorised override with a reason | M |
| DEV-405 | Call-out logging (call/WhatsApp/email, issue, photos, on-site contact, priority) with the coverage result shown before confirming; client acknowledgement; call outs appear on the board panel, emergencies first | M |
| DEV-406 | SLA deadlines and at-risk warnings, statuses Logged → Closed, attendance/diagnosis/resolution/pending works recorded in the portal (FSM timestamps in Phase 15); SLA-miss and misuse flags | M |
| DEV-407 | Additional work from a visit or call out: technician, finding, photos, risk, parties, quotation with 20% material fee, statuses to Paid, roll-up to contract and client; the call out stays open until done or declined | L |
| DEV-409 | Reserve on booking, consume on closure, release on cancel/failure, reverse/correct with reason; used/reserved/remaining; near-zero warning; reset per contract year | M |
| DEV-423 (#8) | To-do "Call out" | S |

**Notifications:** call out logged, SLA at risk, allowance near limit/used up (exists), quotation awaiting client approval.
**Messages:** call-out acknowledgement.
**Migration:** `…_amc_call_outs_additional_work_allowances.sql` (SAFE).
**Done when:** demo story steps 12–13 work.

### Phase 12: Reports and dashboard

| Jira | Work | Size |
|---|---|---|
| DEV-410 | Client report per contract on demand (residential and commercial templates); send by email and prepared WhatsApp | M |
| DEV-411 | Operational reports: adherence vs windows, due/overdue/pending by reason group, call-out SLA met/missed, contracts at risk, technician utilisation, allowance use, access failures by community | L |
| DEV-412 | Commercial reports: proposals and conversion, discounts by level, signed value by period/category, collections and ageing, cheques by status, additional-work revenue, renewals | L |
| DEV-414 | Management dashboard: pipeline, contracts, approvals, delivery, workforce, commercial, renewals 30/60/90 | M |

**Migration:** report functions only if needed for speed (SAFE).
**Done when:** demo story step 14 works, with CSV/Excel export.

### Phase 13: Renewal, amendments, termination

| Jira | Work | Size |
|---|---|---|
| DEV-415 | Reminder at the configured lead time (owner + management), renewals-due view, escalation when idle; the sweep switched on | M |
| DEV-416 | Renewal draft with escalation % and last year's visits, call outs, additional works and allowance use beside it; normal flow; outcomes (Renewed, Renewed with Revised Scope, Under Negotiation, Not Renewed + reason, Lapsed) | M |
| DEV-417 | Amendments with approval: scope change, property change, hold (pauses the schedule), transfer to new owner/tenant, early termination (30-day notice, pro-rata refund), cancellation | L |
| DEV-423 (#7) | To-do "Renewal due" (last-year summary, open draft, send, record outcome; management after 15 idle days) | S |

**Notifications:** expiring in 60 and 30 days, no renewal activity.
**Messages:** renewal proposal.
**Migration:** `…_amc_renewal_outcomes_and_amendments.sql` (SAFE).
**Done when:** demo story step 15 works.

### Phase 14: Completion sweep and demo readiness

| Jira | Work | Size |
|---|---|---|
| DEV-420 | All four emails checked against BRD 6.1 (and the companion workbook if it arrives) | S |
| DEV-421 | All 27 notifications present; home page and inbox behaviour | S |
| DEV-422 | All 8 prepared messages (WhatsApp + SMS text) | S |
| DEV-423 | All 8 to-dos with details, actions, assignee and escalation | S |
| DEV-424 | Every entity's status history and the 6.9 metrics data | S |
| — | Demo records: top up the existing AMC demo data through the app so every stage is shown (enquiries in each stage, rate card, proposals with versions, contracts in each status, payments and cheques, schedules, visits, call outs, renewals). No SQL seeding of the live database | M |
| — | Demo script: a click-by-click story (§2) with the demo users | S |
| DEV-425–430 (internal) | Line-by-line BRD re-check per area. The gap analysis is re-run and must show every non-deferred requirement IMPLEMENTED. Full regression | M |

**Done when:** the full demo runs in the demo app without errors, and the updated gap analysis shows no non-deferred gaps.

### Phase 15: Blocked items (last, after their answers arrive) and release

| Jira | Needs first | Work once answered |
|---|---|---|
| DEV-375 (part 2) | How Zoho Sign returns status; Zoho Sign account | Zoho Sign route in the same status view |
| DEV-377 | Which FSM record Finance uses | Link/push signed contracts to FSM |
| DEV-378 (part 2) | Same as DEV-377 | Create the FSM customer when none exists |
| DEV-385 | PayTabs/NomuPay accounts, keys, callbacks | Payment link per instalment, automatic settlement |
| DEV-387 | Zoho Finance trigger and direction | Invoices and receipts against contract/client/instalment, resend |
| DEV-391 | One FSM work order per contract or per visit | Create FSM work orders/appointments for AMC visits and call outs; publish from the board |
| DEV-400 | FSM admin adds the job-sheet fields | Map FSM job-sheet fields into the portal job sheet |
| DEV-401 | What the FSM app supports offline | Verify and document offline behaviour |
| DEV-406 (FSM part) | FSM arrival/booking timestamps | SLA measured from FSM times |
| DEV-413 | Source of cost figures | Profitability report |
| DEV-422 (automatic) | Whether the portal sends messages itself; a WhatsApp/SMS provider | Automatic sending with SMS fallback |
| DEV-425–430 (formal) | Companion workbook test cases TC-01 to TC-78 | Run every test case in the demo app |
| Release | Your approval | Production migration-history reconciliation, migrations in classified order, code deploy, credential rotation, smoke test, merge (runbook) |

---

## 8. Subtask index (all 84)

| Key | Phase | Key | Phase | Key | Phase | Key | Phase |
|---|---|---|---|---|---|---|---|
| DEV-347 | 3 | DEV-368 | 4 | DEV-389 | 8 | DEV-410 | 12 |
| DEV-348 | 2 | DEV-369 | 5 | DEV-390 | 8 | DEV-411 | 12 |
| DEV-349 | 4 | DEV-370 | 5 | DEV-391 | 15 | DEV-412 | 12 |
| DEV-350 | 4 | DEV-371 | 5 | DEV-392 | 9 | DEV-413 | 15 |
| DEV-351 | 6 | DEV-372 | 6 | DEV-393 | 9 | DEV-414 | 12 |
| DEV-352 | 7 | DEV-373 | 6 | DEV-394 | 9 | DEV-415 | 13 |
| DEV-353 | 2 | DEV-374 | 6 | DEV-395 | 9 | DEV-416 | 13 |
| DEV-354 | 8 | DEV-375 | 6 + 15 | DEV-396 | 9 | DEV-417 | 13 |
| DEV-355 | 11 | DEV-376 | 6 | DEV-397 | 9 | DEV-418 | 1 |
| DEV-356 | 9 | DEV-377 | 15 | DEV-398 | 9 | DEV-419 | 1 |
| DEV-357 | 1 | DEV-378 | 6 + 15 | DEV-399 | 9 | DEV-420 | 1, 5, 6, 7, 10, 14 |
| DEV-358 | 3 | DEV-379 | 2 | DEV-400 | 10 (base) + 15 | DEV-421 | 1 → 14 |
| DEV-359 | 3 | DEV-380 | 2 | DEV-401 | 15 | DEV-422 | 1 → 14, 15 |
| DEV-360 | 2 | DEV-381 | 2 | DEV-402 | 10 | DEV-423 | 1 → 14 |
| DEV-361 | 2 | DEV-382 | 7 | DEV-403 | 10 | DEV-424 | 1, 14 |
| DEV-362 | 3 | DEV-383 | 7 | DEV-404 | 10 | DEV-425–430 | 14 + 15 |
| DEV-363 | 4 | DEV-384 | 7 | DEV-405 | 11 | | |
| DEV-364 | 4 | DEV-385 | 15 | DEV-406 | 11 + 15 | | |
| DEV-365 | 4 | DEV-386 | 7 | DEV-407 | 11 | | |
| DEV-366 | 4 | DEV-387 | 15 | DEV-408 | 11 | | |
| DEV-367 | 4 | DEV-388 | 8 | DEV-409 | 11 | | |

**Order note.** Jira (DEV-358) and BRD 5.17 lean towards the operational core first. This plan keeps the commercial chain (enquiry → proposal → contract → payment) before scheduling for one reason: dependency. The PPM schedule is generated from a contract that has passed the payment gate, and the demo story has to run in that order. If management wants the operational screens shown earlier, Phases 8–11 can start right after Phase 6, with Phase 7's gate switched off by configuration.

## 9. Risks and how the plan handles them

| Risk | Handling |
|---|---|
| Scope is large (about 70 subtasks before Phase 15) | One subtask at a time, each finished and working before the next. Demo checkpoints after Phase 6 (commercial), Phase 11 (operational) and Phase 14 (full) |
| Live scheduling tables change (DEV-356, 392, 393) | Additive columns only; the board keeps working for non-AMC entries; tested against main's behaviour |
| Contract model change (Phase 6) on existing data | Existing active contracts are kept as `active` with their dates; the migration has a pre-check and rollback notes |
| Proposal PDF on the server | Reuses the signed-archive renderer (headless Chrome, or stored HTML when Chrome is absent) |
| Demo on the live database | Only live-safe migrations (§3); email redirect; AMC to-dos only to the record's users; AMC visits overlaid, not written into live scheduling tables; no FSM writes before Phase 15 |
| Defaults the business disagrees with | All in configuration (§5); changed in minutes, no release |
| Production drift while we build | Only live-safe migrations reach production, each logged; the 4 held ones wait for the release with the code |

## 10. Definition of done for every subtask

- [ ] Behaviour matches the Jira description and the BRD lines it cites.
- [ ] Migration (if any): additive, RLS on, no browser grants, applied twice on the local harness, classified, rollback notes.
- [ ] Permissions enforced on the server for the record, not just the screen.
- [ ] Status changes recorded with user, time and reason.
- [ ] Notifications, to-dos, emails and messages for this subtask in place.
- [ ] Unit tests added; all tests, typecheck, lint and build pass.
- [ ] Checked in the browser in the demo app (production database, live-safe); screenshot for the demo notes.
- [ ] Committed on `amc-hardening`. You receive the migration, the verification SQL and the click path.
