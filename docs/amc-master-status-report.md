# AMC Master Status Report

**Date:** 6 October 2026
**Branch:** `amc-hardening`. It contains every AMC phase, plus `main` up to `a40fe4f`. Not merged to main.
**Production:** not changed by this work. **None of the AMC migrations in §5 are applied to production.**
**This report** is the authoritative status. It supersedes the "remaining work" sections of the earlier phase reports.

---

## 1. Executive summary

The AMC system in `amc-hardening` covers the whole commercial and operational life of an Annual Maintenance Contract:

- **Selling:** a proposal is priced from per-service base prices, VAT and discount, with services the client gets free (such as the 24/7 helpdesk) marked as such. It is approved internally, sent to the client by a secure link, approved or rejected by the client, turned into a contract, and signed. Every step is audited. The text the client saw is frozen at sending.
- **Running:** a signed proposal is activated into a contract. The contract has fixed dates, an immutable snapshot of what was signed, and per-service entitlements (visits, hours, unlimited, included). Staff record usage and correct mistakes; the history is never edited. Coverage can be checked for any request. Contracts expire, can be cancelled, and can be renewed through a normal proposal.
- **Connecting:**
  - Zoho FSM work can be linked to contract services. Completed visits are reviewed and confirmed into usage, idempotently.
  - Customers, properties and property assessments are kept.
  - Additional-service quotes apply a configurable AMC discount.
  - Reports cover expiry, the renewal pipeline, account managers and services, with CSV/Excel export.

**What it cannot do yet** is mostly not code:
- Nothing is deployed: the database changes are not applied.
- Several business rules await confirmation (§7).
- Automatic FSM usage waits on Zoho FSM confirmations (§8).
- Security issues in shared platform tables must be closed before release (§9).

Since the business-completion phase (6 Oct 2026) the system also:
- notifies approvers, owners and the team at each workflow step, in the portal and by email;
- archives every signed contract privately, exactly as signed;
- keeps assessment photos privately;
- has an expiry-reminder engine, which stays switched off until the schedule is approved.

What remains in code is creating FSM estimates from the portal (blocked on FSM fields) and the final document layout, which waits for Sharon's sign-off (§4, §11).

## 2. Architecture

```
Proposal (wizard: property/customer → services & pricing → review)
  → Internal approval (approve / send back with reason; role-based approver)
  → Send (email or copied link; wording snapshotted)
  → Customer decision (public tokenised page: approve / reject, once)
  → Contract (built from the same data; sent the same way)
  → Signature (typed name + time)
  → Activation (explicit; dates confirmed; snapshot of everything signed)
  → Active AMC (derived status: not started / active / expiring / expired; cancellation)
  → Entitlements (visits / hours / unlimited / included, per service)
  → Usage (append-only ledger; corrections; coverage checks)
  → FSM (linked work orders/appointments; reviewed completed visits → usage)
  → Renewal (renewal proposal → same workflow → new contract linked to the old)
```

**Layers:**
- **Domain rules:** pure TypeScript in `lib/amc/`, unit-tested.
- **Server:** `lib/server/amc/`, writing with the service role after route checks.
- **APIs:** `app/api/amc-submissions`, `app/api/amc/[token]`, `app/api/amc-contracts/**`.
- **UI:** `components/dashboard/extensions/amc` (proposals), `components/dashboard/extensions/amc-contracts` (contracts, customers, assessments, reports, settings).

**Data:** `amc_submissions`, `amc_settings` and `amc_audit_events`, plus the 14 tables in §5 (17 in all). All AMC tables have RLS on and no browser grants: the browser goes through the API. Design, ER diagram and merge review: `docs/amc-database-architecture.md`. Whether each migration can run while today's `main` is live: `docs/amc-migration-safety-report.md`.

## 3. Completed work

| Area | Delivered |
|---|---|
| **Proposal** | Three-step wizard. Services from the AMC Settings catalogue. Base price × units × frequency. Discount. 5% VAT. Amount in words. Integer-fils arithmetic, recomputed on the server. **Client changes (Oct 2026, merged from main):** services "included at no charge" (no base price; the 24/7 helpdesk by default); monthly price divided by the contract term; per-service unit display; account managers picked from a saved list; term-aware clause text |
| **Approval** | Status machine (draft → awaiting approval → approved/sent back → proposal sent → approved/rejected → contract sent → signed). Approver by role or the Settings list. Send back with a reason. Editing locked outside draft/sent back. Self-approval switch |
| **Documents** | Proposal (the client's brochure with their plan) and contract, in PDF and Word, built from the data. Optional sections. Supply-and-install price list. Every placeholder bound. A sent document renders from the wording snapshot taken when it was sent |
| **Client portal** | Public `/amc/[token]` page: no login, unguessable hashed tokens, 30-day expiry, one answer only. Typed-name signature. The proposal link stops working once the contract stage is reached |
| **Active contracts** | Explicit activation with a preview and confirmation. Immutable snapshots (customer, property, managers, commercial values, wording). Derived lifecycle. Expiry labels. Cancellation with a reason. List with search, filters, sorting; dashboard cards |
| **Entitlements & usage** | Per-service allowances. Append-only usage ledger with trigger-kept totals and database limits (no over-use, no negatives). Usage preview. Compensating corrections. Coverage check (covered / chargeable / no AMC) |
| **FSM** | Explicit FSM customer link (by contact id). AMC→FSM service mapping (approvers). FSM work-order/appointment links with the coverage answer at linking. Completed-visit review with manual confirmation. Idempotent per appointment. Reversal as a correction. Sync log. Scheduling-board AMC notice. Automation built, **switched off** |
| **Customers & properties** | Shared `customers` / `customer_properties`, linkable to Snagging records. Contracts keep the signed snapshot and gain a live link. Customer and property AMC views |
| **Assessments** | Draft → completed property assessments. Approver-editable checklist (OK / attention / n/a + notes). Recommended services. Locked once completed. Starts an unpriced AMC proposal |
| **Additional services** | Eligibility (included / AMC discount / standard / not configured). Configurable discount (off, no rate assumed). Quotes with a frozen calculation, linked to an FSM estimate looked up by number |
| **Renewals** | Renewal proposal with a preview: the next day after the end date, same term. One per contract. Relationship timeline. Pipeline stages derived from proposal status. Reminder Todos built, **switched off** |
| **Reporting** | Portfolio figures (customers and properties counted once). Expiry buckets. Renewal pipeline. Account-manager portfolio. Service analytics (units never mixed). CSV/Excel exports |
| **Testing** | 128 unit tests. A local PostgreSQL harness for every AMC migration (applied twice, behavioural and schema-invariant checks), a main-compatibility replay, a ~10k-contract scale test with query plans, and two-session race tests |
| **Database review (6 Oct 2026)** | No table merged or removed (each kept for a constraint, key or lifecycle; review in the architecture doc). Fixed: assessment/quote numbers truncating past 9,999; a redundant index; 3 missing indexes; contract activation now one transaction; dashboard counted in the database (was wrong above the row cap); reports and lists page instead of stopping at 1,000–5,000 rows; assessments searchable and paged on the server; FSM sync-log race; cancellation-vs-usage race; the usage ledger now refuses edits loudly |
| **Notifications (6 Oct 2026)** | One AMC notification log (`amc_notifications`) over the portal's existing delivery: an in-app bell on the AMC screens, and email through Resend. Events: proposal submitted, approved, sent back (with reason), sent; client approved or rejected (with reason); contract sent, signed (number, customer, property, typed name, time); contract activated; allowance low or used up; contract expiring; renewal started. Recipients come from the workflow (approvers by the same rule as the approval route, the proposal owner). A unique dedupe key per event, recipient and channel makes retries and double clicks harmless. Workflow emails are on; allowance and reminder emails are off until confirmed (`amc_notification_settings`, editable by approvers) |
| **Signed-contract archive** | At signing, the contract is rebuilt from the signed row and the wording frozen when it was sent (never today's settings). It is stored in the private `amc-documents` bucket as a PDF printed by headless Chrome, the Snagging report path, or as HTML when no browser is available. Its content hash and file hash are recorded in the immutable `amc_signed_documents`. An electronic acceptance record shows signed by, typed name, signed date and time, and says plainly that this is not a cryptographic signature. The contract and proposal pages show it apart from the generated documents. Older signed contracts can be archived by hand, marked "archived after signing" |
| **Assessment photos** | Up to 20 JPEG/PNG/WebP photos per assessment in the private bucket (type checked from the file bytes; SVG refused). Shown through 10-minute signed links. Removable while a draft, kept unchanged once completed (database trigger) |
| **Expiry reminders** | A reminder sweep: the nearest due threshold per contract (60/30/15 days by default), to configured recipients (owner, approvers, extra addresses) and channels. Idempotent. Run by an approver, or by a signed scheduled call only when automatic reminders are switched on (off by default). The existing reminder Todos use the same settings |
| **Customer-facing consistency** | The contract page shows the support line and response times **as signed** (from the contract's frozen wording), with compliance "Not measured". Findings in §7 (6 h vs 48 h) |
| **Hardening** | Direct table writes closed. Server-side pricing. Proposal numbers beyond 9,999. Zoho token hidden from browsers. Estimate, password-reset and audit tables made server-only (migrations written; §5) |

## 4. Requirement matrix

**Sources:**
- The FRD (*YFI AMC Proposals Extension FRD v2*, as mapped in `docs/amc-proposals-v2-implementation-plan.md`).
- The customer brochure copy (`amc-brochure-copy.ts`).
- The operational goals set for Active AMC, FSM and business operations.

**Status key:** IMPLEMENTED · PARTIAL · NOT IMPLEMENTED · BUSINESS DECISION · BLOCKED (external) · DEFERRED SECURITY.

| # | Original requirement | Status | Implementation | Remaining |
|---|---|---|---|---|
| 1 | FR1.1–1.6: three-step wizard, no packages | IMPLEMENTED | `extensions/amc/index.tsx`, `steps/*` | Browser UAT |
| 2 | FR2.1–2.12: price = base × units × frequency; base price required (0 allowed) | IMPLEMENTED | `lib/amc/pricing.ts`, `lib/server/amc/pricing.ts` | Default PPM/handyman frequencies (§7 B) |
| 3 | Client change: services included at no charge | IMPLEMENTED | `free` row flag, `includedFree` in Settings | Confirm which services are free (only the helpdesk today) |
| 4 | Client change: monthly price by contract term | IMPLEMENTED | `computeAmcPricing(…, termMonths)` | — |
| 5 | §6.3 totals: subtotal → discount → final; VAT | IMPLEMENTED | as row 2 | **5% VAT** confirmation (§7 C) |
| 6 | FR3.2 visibility; FR3.4 edit lock | IMPLEMENTED | `lib/amc/workflow.ts`, submissions API | — |
| 7 | FR4.1–4.7: documents from the data, optional sections, price list, placeholders | IMPLEMENTED | `amc-document-model.ts`, `amc-proposal-content.ts`, PDF/DOCX | OI-5 / clause 6.3 meaning (§7 A) |
| 8 | FR4.8: final document layout | BUSINESS DECISION | Brochure-style proposal built (28 Sep) | **Layout sign-off (Sharon)**: BUSINESS DECISION |
| 9 | FR5.1–5.3: internal approval, send back, role-based approver | IMPLEMENTED | `app/api/amc-submissions/[id]/decision`, `amc-approval-notice.tsx` | Self-approval policy (§7 C) |
| 10 | FR5.4–5.7: tokenised client links, approve/reject once, contract, signature, email/link | IMPLEMENTED | `app/amc/[token]`, `app/api/amc/[token]`, `send/route.ts` | Typed-name signature, 30-day validity (§7 C) |
| 11 | FR5.8 status machine; FR5.9 audit | IMPLEMENTED | `lib/amc/workflow.ts`, `amc_audit_events` | — |
| 12 | FR6.1–6.5: AMC Settings, snapshot on send, settings audit | IMPLEMENTED | `amc-settings-page.tsx`, `settings_snapshot` | — |
| 13 | Client change: saved account managers | IMPLEMENTED | `settings.accountManagers`, services step | — |
| 14 | NFR4 / §7: unguessable links; no open table access | IMPLEMENTED in code | hashed tokens; hardening migrations | Migrations **not applied** (§5, §10) |
| 15 | Notifications: proposal and contract emails | IMPLEMENTED | `lib/server/send-email.ts` via send route | — |
| 16 | Notifications: approver told when a proposal awaits approval; team told of client decisions/signature | IMPLEMENTED | `lib/server/amc/notifications.ts` + hooks in the approval, send, client and activation paths; bell on AMC screens | Recipients are the workflow's own; confirm workflow emails stay on (§7 C) |
| 17 | Brochure: dedicated account manager | IMPLEMENTED | managers on proposal/contract, saved list, reports | — |
| 18 | Brochure: unlimited emergency call-outs; non-emergency per package | IMPLEMENTED | entitlement types unlimited/visits | Allowance scaling rules (§7 A) |
| 19 | Brochure: emergency attended in 120 min, non-emergency scheduled in 6 h | BLOCKED | Targets shown as signed (`lib/amc/commitments.ts`); evaluation ready (`lib/amc/sla.ts`) | **BLOCKED:** FSM request/arrival/booking times (compliance UNKNOWN). **BUSINESS DECISION:** brochure says 6 h, contract and proposal say 48 h (§7 A) |
| 20 | Brochure: discounts on additional services | BUSINESS DECISION | eligibility, configurable discount, frozen quotes | **Rate/eligible services** (§7 A); FSM estimate created by hand |
| 21 | Brochure: free property assessment | IMPLEMENTED | assessments, checklist, notes, recommended services, private photos, completion lock, proposal from assessment | Assessment rules (§7 A7) |
| 22 | Activation and contract lifecycle | IMPLEMENTED | `lib/server/amc/contracts.ts`, contracts UI | Early signed/test rows (§7 C) |
| 23 | Entitlements, usage, corrections, coverage | IMPLEMENTED | ledger + triggers, usage UI, coverage check | Usage/correction permissions (§7 A) |
| 24 | Expiry management | IMPLEMENTED | derived status, labels, expiry report | Expiring window (default 30 days) (§7 B) |
| 25 | Renewal proposals, relationships, pipeline | IMPLEMENTED | renewal API/UI, derived pipeline | Renewal pricing basis (§7 A) |
| 26 | Renewal reminders | IMPLEMENTED (off) | reminder sweep + Todos, configurable thresholds/recipients/channels, idempotent | Automatic delivery off until **schedule + recipients** are confirmed (§7 A2) |
| 27 | Expiry / usage / exhausted-allowance operational notifications | IMPLEMENTED | low (25%) and used-up alerts on each usage write, state-based; expiry reminders via the sweep | Allowance emails off until recipients confirmed |
| 28 | FSM customer and service mapping | BLOCKED | explicit links + mapping screen | **Data entry** + confirmation of `Customer_Id__C` (§8) |
| 29 | FSM completed visit → usage | BLOCKED | review/confirm, idempotent; automation off | **BLOCKED:** meaning of "Completed", reopening, hours (§8) |
| 30 | Shared customers/properties | BUSINESS DECISION | AMC uses them; Snagging not yet | **Ownership** (§7 A) |
| 31 | Additional-service quotation into FSM | BLOCKED | quote record (service, standard price, AMC discount, final price, frozen calculation) + link to the FSM estimate | Creating the estimate from the portal needs the FSM fields (§8). Clause 6.3 "additional fixed-price services": BUSINESS DECISION REQUIRED (§7 A8); the quote record already holds what it would need |
| 32 | Reporting, dashboards, exports | IMPLEMENTED | `amc-reports.tsx`, `contracts-summary.tsx` | — |
| 33 | Signed-contract archive (stored signed PDF) | IMPLEMENTED | `lib/server/amc/signed-archive.ts`, private `amc-documents` bucket, immutable `amc_signed_documents` | A Chrome binary on the production host for PDF (else HTML) (§8) |
| 34 | Production deployment of all of the above | NOT IMPLEMENTED | runbook + smoke test written | Goal 4 |

**Counted from the rows above (6 Oct 2026, after business completion):**

| Status | Rows | Which |
|---|---|---|
| IMPLEMENTED | **26** | 1–7, 9–18, 21–27, 32, 33 |
| BUSINESS DECISION REQUIRED | 3 | 8 (layout sign-off), 20 (discount rate), 30 (customer ownership) |
| BLOCKED (external) | 4 | 19, 28, 29, 31 (Zoho FSM data and confirmations) |
| PARTIAL (development pending) | 0 | — |
| NOT IMPLEMENTED | 1 | 34 (production deployment) |

- **AMC business requirements: 26 of 34 implemented in code (76%).** Counting a blocked or decision-pending row as half done, as the previous estimate did, gives **87%**. No row is waiting on development that can be done without a decision or an FSM answer.
- **Proposal workflow (FRD rows 1–14): 13 of 14 implemented (93%)**, 96% with FR4.8 counted as half. FR4.8 waits for the layout sign-off.
- **0% is in production.**

## 5. Database changes

All AMC migrations apply in this order. **NOT APPLIED TO PRODUCTION** means production does not have it; checked read-only on 6 Oct 2026, for example `amc_contracts` and `customers` do not exist there.

| Order | Migration | What | Production |
|---|---|---|---|
| (main) | `20261002100000_inspector_role.sql` | Snagging inspector role (from `main`, not AMC) | Role already present in production |
| 1 | `20261005100000_amc_close_direct_writes.sql` | Close direct browser writes to `amc_submissions` | **NOT APPLIED** |
| 2 | `20261005110000_amc_proposal_number_beyond_9999.sql` | Proposal numbers past 9,999 | **NOT APPLIED** |
| 3 | `20261005150000_restrict_shared_allow_all_policies.sql` | Remove "Allow All" on `schedule_audit_events` | **NOT APPLIED** |
| 4 | `20261005160000_settings_hide_zoho_token.sql` | Hide the Zoho token in `settings` from browsers | **NOT APPLIED** |
| 5 | `20261005170000_estimate_tables_server_only.sql` | Estimate tables server-only | **NOT APPLIED** |
| 6 | `20261005180000_password_resets_server_only.sql` | `password_resets` server-only | **NOT APPLIED** |
| 7 | `20261006100000_active_amc_contracts.sql` | Contracts, entitlements, usage ledger, renewal link | **NOT APPLIED** |
| 8 | `20261006110000_active_amc_operations.sql` | Corrections, manager names, reminder Todos, one renewal per contract (has a pre-check) | **NOT APPLIED** |
| 9 | `20261006120000_amc_fsm_integration.sql` | FSM customer link, service mapping, work links, sync log | **NOT APPLIED** |
| 10 | `20261006130000_amc_business_operations.sql` | Customers/properties, assessments, discount config, additional quotes | **NOT APPLIED** |
| 11 | `20261006140000_amc_atomic_activation_and_dashboard.sql` | Atomic contract activation; dashboard figures counted in the database (functions only) | **NOT APPLIED** |
| 12 | `20261006150000_amc_business_completion.sql` | Notifications and their settings, signed-contract archive, private `amc-documents` bucket, assessment photos | **NOT APPLIED** |
| 13 | `20261006160000_role_tables_server_only.sql` | `roles`, `role_access`, `user_profile`: browser read-only, no anon access (security phase) | **NOT APPLIED** |
| 14 | `20261006161000_todos_and_uploads_tightened.sql` | `todos` server-only; `uploads` writes by signed-in owners only | **NOT APPLIED** |
| 15 | `20261006162000_amc_history_survives_user_deletion.sql` | Proposal owner FK `RESTRICT`, so deleting a user cannot remove AMC history | **NOT APPLIED** |
| 16 | `20261006163000_shared_tables_server_only.sql` | 12 scheduling, lookup, FSM snapshot and todo child tables closed to the anon key | **NOT APPLIED** |

**Checks:**
- No duplicate timestamps, and no `main` migration supersedes an AMC one.
- Each AMC migration depends only on earlier ones.
- Production's migration history must be reconciled first (`docs/database-migration-reconciliation.md`).
- Then apply via the runbook (`docs/amc-hardening-production-runbook.md` 7.x). Never `db push --include-all`.
- **While today's `main` is live: PARTIALLY.** Migrations 1–3, 7–12 and 14–16 are compatible with the live `main` (SAFE BEFORE CODE DEPLOY; main's AMC queries replayed after each one; all pass). Migrations 4–6 and 13 break today's `main` (settings, users, roles and permissions via graphql, and the estimate and password-reset paths) and must follow the code deploy (REQUIRES NEW CODE FIRST). Details: `docs/amc-security-hardening-report.md` §12. No migration drops, renames or narrows anything `main` uses; no backfill is needed. Details: `docs/amc-migration-safety-report.md`.

## 6. Automated verification

On `amc-hardening` after the main merge:

| Check | Result |
|---|---|
| Unit tests (`npm test`) | **179 / 179** (154 before + 25 security) |
| Security tests (`tests/amc/security.test.ts`) | **25 / 25**: object-level access, role escalation, GraphQL allowlist, email relay, Edge signatures, review links, client links, reset tokens, server actions, CSRF, rate limits, notifications |
| Full-project typecheck (`tsc --noEmit`, whole repo) | **PASS, 0 errors.** The 3 earlier test-only errors in `tests/amc/tokens.test.ts` are fixed |
| Lint (AMC and security-changed TypeScript files) | **PASS** (0 errors; 1 pre-existing warning) |
| Production build (`next build --webpack`) | **PASS** |
| Local migration harness (PostgreSQL 15, every AMC migration applied twice + behavioural checks) | **PASS** (all check suites, including the schema invariants, the business-completion checks and the security checks `97c_verify_security.sql`) |
| Main compatibility harness (main's AMC schema from `origin/main`, each new migration in turn, main's queries replayed) | **PASS** for all 23 AMC queries at every step, migrations 13–16 included; the expected non-AMC breaks come only from migrations 4–6 and 13 |
| Synthetic scale (~10k contracts, 146k usage rows) and `EXPLAIN ANALYZE` | Interactive queries under 20 ms; approver dashboard 135–161 ms |
| Two-session concurrency tests | **7 / 7** (last visit, double activation, corrections, cancellation vs usage, sync log, renewal, reminder) |
| Browser / UAT | **Not done.** Needs a signed-in session and a migrated database (`docs/active-amc-user-testing-checklist.md`). The dev server points at production, which has none of these migrations |

## 7. Business decisions remaining

Old defaults are listed as defaults, not as approved decisions.

**A. Must decide before development can finish**
1. **Allowance scaling:** do visit/hour allowances scale with units, and with contract length (today: one year's allowance whatever the term)?
2. **Renewal reminders:** schedule (default 60/30/15 days, off), recipients, and switching on.
3. **Renewal pricing:** start from the old base prices (today) or a rate card.
4. **Additional-service discount:** does it exist, at what rate, for which services or categories (off, no rate)?
5. **Usage and correction permissions:** proposal owner and approvers today; should operations staff record usage; should corrections be approver-only?
6. **Customer/property ownership:** which module owns the shared records, who edits them, when Snagging adopts them.
7. **Assessments:** who may perform/complete; must every item be answered (today yes); are photos required.
8. **OI-5 / clause 6.3:** what "additional fixed-price services" means (FRD §12 missing).
9. **Notifications:** built. Approvers, owners and the team are told at each workflow step (in-app and email). To confirm: who receives expiry reminders and allowance alerts by email, and whether reminders run automatically (both off).
10. **Non-emergency response time:** the brochure promises non-emergency visits "scheduled within 6 hours", but the contract clause and the proposal's "standard response time" say 48 hours. The documents print what the settings say; the contract page shows what was signed. One wording must be chosen (Sharon / legal).
11. **Signature on the generated contract:** the archived signed contract shows the typed name, date and time. Whether the regenerated contract's signature block should print them too (`lib/amc/signature.ts`).
12. **Provider contact number:** the shipped default `contactNo` is "800-PERFECT / 05X XXX XX / 05X XXX XX" (placeholders). Check that production AMC Settings holds the real numbers before any contract is sent (the production read failed on 6 Oct, so this is unverified).

**B. Can stay configurable**
1. Expiring window (default 30 days) and low-remaining threshold (25%).
2. Renewal pipeline window (90 days).
3. Default PPM/handyman frequencies.
4. Which services are "included at no charge" (Settings).
5. Checklist content (Settings).

**C. Must decide before production**
1. **5% VAT** stays as printed.
2. **Self-approval** (on today, pending decision).
3. **Typed-name signature** is acceptable (and whether it prints).
4. **Client link validity** (30 days).
5. **Existing signed rows** AMC-2026-6886/6890/6891: real (activate) or test data.
6. **Final document layout sign-off** (FR4.8, Sharon).

**D. Optional / future**
1. Creating FSM estimates from the portal.
2. A stored signed-contract archive.
3. Commission or revenue reporting (not built; the portal lacks full revenue data).

## 8. External dependencies

| What is missing | Who provides it | What it blocks | Can development continue? |
|---|---|---|---|
| Meaning of FSM "Completed"; whether appointments can be reopened | Operations + Zoho FSM admin | Automatic visit usage and reversal | Yes (manual confirmation works) |
| Approved handyman-hours source | Operations | Automatic hours usage | Yes (hours entered by hand) |
| FSM request / arrival / booking timestamps | Zoho FSM configuration | SLA measurement (shows UNKNOWN) | Yes |
| Confirmation that Customer ID = FSM `Customer_Id__C` | Business + FSM admin | Validating the proposal's Customer ID | Yes (explicit links) |
| FSM service mappings and customer links (data entry) | AMC approvers / account managers | FSM matching | Yes |
| FSM estimate required fields and catalogue prices | Zoho FSM admin | Creating estimates from the portal | Yes (manual estimate + link) |
| Private file storage decision | Platform owner (security goal) | Assessment photos, signed-PDF archive | Partly (both deferred) |
| Production migration-history reconciliation; a staging database | Platform owner | Any deployment, browser UAT | No, for release |
| Chrome/Chromium on the production host (`PUPPETEER_EXECUTABLE_PATH`), as Snagging reports already need | Platform owner | Signed contracts archived as PDF (without it they are archived as HTML, same content) | Yes |
| GitHub credentials in this environment | Developer | Pushing from automation (manual push works) | Yes |

## 9. Security backlog

The security goal (6 Oct 2026) fixed every item below **in code and unapplied migrations**. Nothing is fixed in production until the code is deployed, the migrations are applied and the Edge Functions redeployed (`docs/amc-security-hardening-report.md` §12). Model: `docs/amc-security-model.md`.

| Item | Risk | Status on the branch |
|---|---|---|
| `roles`, `role_access`, `user_profile` writable with the anon key | Self-granted approval or admin | Fixed: migration 13 + `/api/users`, `/api/roles`, `/api/role-access` with escalation rules |
| Zoho token readable with the anon key | FSM account takeover | Fixed: migration 4; token server-only. **Rotate at deployment** |
| `amc_submissions` direct writes | Proposal tampering | Fixed: migration 1 |
| Zoho Edge Functions open; one logged the token | FSM data exposure | Fixed in `supabase/functions/` (signed calls, cron secret, no token logs). **Manual redeploy needed** |
| `/api/graphql` passing any query | Data exposure and writes | Fixed: one allowlisted read |
| Generic email relay | Phishing from the company domain | Fixed: limited and rate-limited |
| `password_resets`, estimate tables, todos, scheduling tables open | Account and data exposure | Fixed: migrations 5, 6, 14, 16; reset tokens hashed |
| FSM work-order lookup and customers open to every AMC user | Over-broad access | Fixed: object-level rules in `lib/amc/access.ts` |
| No operations permission | Least privilege | Fixed: `amc_operations` (View, Create, Edit, Approve) |
| User deletion removes proposals | Lost history | Fixed: migration 15 (`RESTRICT`); deactivate instead |
| Public `uploads` bucket | Exposure of other modules' files | **Open (MEDIUM)**: writes tightened; public read kept for avatars/logos (strategy in the hardening report §7) |
| Open self-registration | Unvetted accounts | **Open (HIGH)**: disable sign-ups or keep the "user" role empty |
| Self-approval allowed by setting | BRD v0.3 §6.7 forbids it | **Open (HIGH, business rule)**: next AMC goal |
| Per-instance rate limits | Weaker throttling | **Open (MEDIUM)** |

## 10. Production readiness

These prevent release today:
1. Production migration history not reconciled; AMC migrations not applied.
2. The security fixes in §9 deployed (code, migrations 4–6 and 13–16, Edge Functions, secrets) and the Zoho and Resend credentials rotated.
3. No browser/UAT pass on a migrated staging database.
4. Category C decisions (§7) not confirmed.
5. The non-emergency response wording (§7 A10) and the provider contact number (§7 A12) checked before contracts go out.
6. `amc-hardening` not merged to `main` (by instruction).

## 11. Remaining development

These follow from §4 rows marked PARTIAL or NOT IMPLEMENTED and the security backlog:
1. ~~Security and permissions~~: done in code on 6 Oct 2026; deployment steps in the hardening report §12. Open: self-registration, self-approval (BRD), `uploads` public read.
2. **Decision-driven changes** (no new systems needed):
   - switch on the reminder schedule and the allowance/reminder emails once confirmed;
   - allowance scaling, renewal pricing, usage permissions, discount rate (rows 18, 20, 23, 25);
   - FR4.8 layout once signed off (row 8).
3. **FSM automation and estimates** (rows 19, 28, 29, 31), once §8 confirmations arrive.
4. **Release readiness:** reconciliation, staging, UAT, production migration and deployment, data cleanup, merge to main with approval.

## 12. Recommended prompt plan

**TOTAL MAJOR PROMPTS REMAINING: 2** (FSM automation, release readiness), plus small decision-driven changes as answers arrive.

1. ~~Security and permissions hardening~~: done on 6 Oct 2026 (code and unapplied migrations).
   - Close role-table writes; secure Edge Functions and `/api/graphql`.
   - The public `uploads` bucket for the other modules (AMC already uses private storage).
   - Customer/FSM-lookup visibility.
   - AMC permission model (including an operations role if decided).
   - Re-verify the hardening migrations.
2. ~~AMC business completion~~: done on 6 Oct 2026. What is left of it are the decisions in §7 A and C (switching on reminders, rates, layout), each a small change.
3. **FSM automation activation.** Needs §8 answers.
   - Switch on automatic visit usage, with a scheduled check.
   - Automatic reversal if reopening is confirmed.
   - SLA attendance mapping.
   - FSM estimate creation from additional-service quotes.
   - Bulk entry tools for mappings and customer links.
4. **Release readiness.** Needs prompt 1 and the §7 C decisions.
   - Migration-history reconciliation; staging database.
   - Full UAT against the checklist and fixes.
   - Production migrations in runbook order; deployment; smoke test.
   - Test-data cleanup; approved merge to `main`.

## 13. Final definition of done

AMC is complete when all of these hold:
1. Every row in §4 is IMPLEMENTED, or explicitly accepted as out of scope by the business.
2. Every §7 A and C decision is recorded, and the code follows it.
3. Every CRITICAL and HIGH item in §9 is closed in production.
4. All AMC migrations are applied to production in order, verified by the runbook checks and the smoke test.
5. The user-testing checklist passes on staging, signed off by the business.
6. Automated tests, full typecheck, lint and build pass on the release commit.
7. `amc-hardening` is merged to `main` with approval and deployed.
8. Early test rows are cleaned up or marked; real signed proposals are activated.
