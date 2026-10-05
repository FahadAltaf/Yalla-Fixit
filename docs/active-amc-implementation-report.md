# Active AMC: implementation report

**Date:** 6 October 2026
**Branch:** `active-amc` (from `amc-hardening` at `51c023b`), worktree `_wt/amc-hardening`. Two commits: the foundation (`cad560e`, Part 1) and contract operations (Part 2). Neither is pushed or merged.
**Production:** not modified. No migration applied; no signed proposal converted.

**Part 2, [Operations and contract management](#part-2-operations-and-contract-management), changes some Part 1 details:** usage corrections replace free adjustments in the UI and API; renewals start the day after the old end date; reminder thresholds have defaults but are switched off; the discount has a master switch. Part 1 sections note where they are superseded.

The proposal workflow is unchanged: `draft → … → contract_sent → signed`. This phase adds what happens **after** `signed`: an operational contract, what it entitles the customer to, how usage is recorded, and the engines that scheduling and FSM flows can call later.

---

## 1. Architecture

```
AMC proposal (amc_submissions, status 'signed')            unchanged
        │  "Activate AMC" (explicit; dates confirmed)
        ▼
POST /api/amc-contracts ──► lib/server/amc/contracts.ts ──► service role
        │                         │
        │                         ├─ snapshots customer, property, account managers,
        │                         │  signed commercial values, signed contract wording
        │                         └─ derives entitlements (lib/amc/contracts.ts)
        ▼
amc_contracts ─┬─ amc_contract_entitlements ── amc_entitlement_usage (ledger; trigger keeps totals)
               └─ amc_audit_events (entity_type 'contract')
```

- **Domain rules:** pure, shared and tested. The entire domain layer is pure TypeScript in `lib/amc/` (no database, no React), used by the API, the screens and the tests:
  - `contracts.ts`: lifecycle, dates, entitlements, usage, coverage
  - `sla.ts`
  - `renewal.ts`
  - `additional-service-discount.ts`
- **Server layer:** `lib/server/amc/contracts.ts` and `contract-access.ts`. All writes use the service role, after the route has checked the caller.
- **No browser access to the new tables.** RLS is on, no policies, and anon/authenticated grants are revoked, matching the hardening model.

## 2. Database tables

Migration `20261006100000_active_amc_contracts.sql`. **NOT APPLIED.**

| Table | Purpose | Key rules |
|---|---|---|
| `amc_contracts` | The agreement | `submission_id` **UNIQUE** (one signed proposal → one contract, even under a double-click race); `end_date > start_date`; status `active` / `cancelled`; cancellation needs a reason; snapshots of customer, property, account managers, signed totals (`subtotal`, `discount_*`, `final_price`, `vat_amount`, `grand_total`) and `contract_settings_snapshot`; `renewed_from_contract_id`, partial-unique so a contract is renewed at most once |
| `amc_contract_entitlements` | One row per contracted service | Type `visits` / `hours` / `unlimited` / `informational`; `included_quantity` is required for visits and hours, absent otherwise; **`used_quantity ≤ included_quantity`** and `≥ 0` are DB CHECKs; informational rows can never be used; `call_out_class` `emergency` / `non_emergency`; base and contracted price as signed |
| `amc_entitlement_usage` | Append-only ledger | `consumption` (positive) or `adjustment` (either sign, reason required); optional FSM reference (`fsm_work_order` / `fsm_appointment` / `schedule_entry`), **unique per entitlement**, so a sync can't double-count; UPDATE/DELETE rules do nothing; a `BEFORE INSERT` trigger locks the entitlement row, checks it belongs to the contract and isn't informational, refuses consumption on a non-active contract, and adds the quantity, so the CHECKs reject any over-use atomically |
| `amc_submissions.renewal_of_contract_id` | Renewal link | Set on renewal proposals; copied to the new contract on activation |
| `amc_audit_events.entity_type` | Audit | CHECK extended with `contract` |

**Snapshots:** later edits to the proposal, AMC Settings or service prices never change an existing contract; its wording, services, prices and totals are copies.

**Verified locally:** a throwaway PostgreSQL 15 cluster rebuilt with the production AMC migrations and Supabase roles; the migration applied twice (idempotent). These checks passed:
- duplicate activation refused;
- invalid period refused;
- trigger totals correct;
- over-consumption refused, leaving no ledger row;
- informational consumption refused;
- negative balance refused;
- adjustment without a reason refused;
- double-consuming one FSM appointment refused;
- cross-contract usage refused;
- ledger UPDATE/DELETE ineffective;
- cancel without a reason refused;
- consumption on a cancelled contract refused;
- audit accepts `contract`;
- browser roles locked out.

## 3. Contract lifecycle

Stored status is only `active | cancelled`. Everything else is **derived** (`contractDisplayStatus`), so it can never go stale:

| Display status | Rule |
|---|---|
| `pending_activation` | A signed proposal with no contract row |
| `not_started` | Active, start date after today |
| `active` | Running, more than the expiring window left |
| `expiring` | Running, ending within the window (default 30 days; configurable) |
| `expired` | Active, end date before today (the last day still counts) |
| `cancelled` | Cancelled by an approver, with a reason |

**Transitions:** activation creates `active`; `canCancelContract` allows `active → cancelled` only. "Renewed" isn't a status: a contract whose successor exists shows "Renewed by a later contract". The proposal's own `signed` status is untouched. All dates are calendar dates in Dubai time (`todayInDubai`).

## 4. Activation flow

**Explicit**, through **Activate AMC** (option B). The proposal already holds structured dates (`customer.startDate` / `customer.endDate`, `yyyy-MM-dd`, required by the wizard); the dialog starts from them and asks for confirmation, because the dates decide coverage and expiry. Nothing is parsed from document text.

`POST /api/amc-contracts { submissionId, startDate, endDate }`:

1. **Caller:** must be the proposal's owner or an AMC approver (403 otherwise).
2. **`checkActivation`:** the proposal must be `signed`, with a signer name and time (409); not already activated (409); with a valid period (400).
3. **Signed wording:** the contract's own settings snapshot, else the proposal's, merged over the shipped defaults.
4. **Commercial values:** the breakdown is recomputed from the signed rows with the shared pricing; `final_price` is what the client was quoted. VAT and grand total come from it.
5. **Entitlements:** derived from the ticked rows, typed from the **signed** service frequency types.
6. **Insert:** the contract, then its entitlements. If the entitlements fail, the contract row is removed, so activation can be retried. The unique `submission_id` also guards the race.
7. **Audit:** `contract_activated` on the contract and on the proposal.

**Entry points:** the signed proposal's page (**Activate AMC**, or **Open contract** once done) and the contracts list ("Pending activation" rows → kebab menu → Activate AMC).

## 5. Entitlement model

Mapping from the service's frequency type in the signed settings (`ENTITLEMENT_TYPE_BY_FREQUENCY_TYPE`):

| Frequency type | Entitlement | Included | Example |
|---|---|---|---|
| `covered` | informational | — | Helpdesk |
| `unlimited` | unlimited | — | Emergency call-outs |
| `ppm` | visits | frequency | AC PPM, 4 a year |
| `fixed` | visits | frequency | Non-emergency call-outs, water tank cleaning |
| `handyman` | hours | frequency | Handyman, 6 hours a year |

- **Unknown services:** a ticked service the signed settings don't describe becomes informational rather than being dropped.
- **Units:** kept alongside, but the allowance is currently the frequency. **BUSINESS DECISION REQUIRED:** whether allowances scale with units (`includedQuantityFor`).
- **Helpers:** `remainingQuantity`, `isExhausted`, `usagePercent`, `describeUsage` ("1 of 4 visits used", "3 used (unlimited)", "Included"), `formatQuantity`, `unitWord`.

## 6. Usage tracking

`POST /api/amc-contracts/[id]/usage`, by the owner or an approver:

- **Kinds:** `consumption` (positive) or `adjustment` (± with a reason). *Superseded in Part 2: the API now accepts consumption only; mistakes are fixed with corrections that reference the entry (§P4).*
- **Fields:** date, optional FSM work order or appointment reference, notes.
- **Validation** (`checkUsage`, mirrored by the database):
  - visits are whole numbers;
  - hours allow two decimals;
  - consumption only on an active contract, within its period;
  - never past the allowance;
  - never below zero;
  - informational services are never consumed.
- **Concurrency:** a concurrent overuse caught by the database comes back as a clear 409.
- **History:** the ledger is append-only. The detail page shows it, and each entry writes `entitlement_consumed` / `entitlement_adjusted` audit events.

## 7. FSM integration status

| Link in the chain | Status |
|---|---|
| AMC Contract → Entitlement | **Done** |
| Entitlement → FSM Work Order / Appointment | **Local foundation done:** usage rows carry `external_type` + `external_reference`, unique per entitlement |
| FSM Appointment → Completion | **No trustworthy event exists.** `schedule_entries.fsm_status` is FSM's raw, polled picklist string (editable per org; `lib/scheduling/appointment-status.ts`). There are no completion timestamps, and no FSM customer ID on schedule entries (`client_name` is free text) to tie an appointment to a contract |
| Completion → AMC Usage | **Not automated, by design.** Usage is recorded manually with the FSM reference |

**Hook required (next phase):**
1. Store the FSM customer / contact ID on the contract, or match the proposal's Customer ID (`customer_ref`, e.g. `YFI1806`, which appears to be FSM's `Customer_Id__C`; to confirm).
2. Map FSM service line items to AMC service IDs.
3. On an FSM **Completed** status transition (from `reconcile.ts` / `import-appointments.ts`), call `coverageFor` and then insert a `consumption` with `source = 'fsm'` and the appointment ID. The unique index makes it safe to retry.

## 8. Coverage engine

`checkCoverage(contracts, { serviceId, date })` (pure), with `coverageForCustomer` and `coverageForContract` on the server (Part 2, §P7). Exposed read-only at `GET /api/amc-contracts/coverage`.

It answers: is an AMC in force on that date (the most recent start wins where renewals overlap), is the service on it, its type, included / used / remaining, whether it's unlimited, the call-out class, and an outcome:

| Outcome | Meaning |
|---|---|
| `covered` | Allowance left, or unlimited (not chargeable) |
| `exhausted` | On the contract but used up (chargeable) |
| `informational` | Included, not counted |
| `not_covered` | Not on the contract (chargeable) |
| `no_contract` | Nothing in force: expired, not started, cancelled or none (chargeable) |

It never consumes anything.

## 9. SLA foundation

`lib/amc/sla.ts`:
- **Defaults** (from the AMC requirements, overridable per call): emergency **attendance within 120 minutes**; non-emergency **scheduling within 6 hours**.
- **`evaluateSla(callOutClass, { requestedAt, scheduledAt, arrivedAt })`** returns met / breached / pending / unknown, plus the target time and minutes from target.
- **Which SLA applies:** the call-out class comes from the signed entitlement.
- **No timestamps exist yet.** The portal stores no request, scheduling or arrival times for FSM work, so nothing is evaluated automatically, and no timestamps are invented.

## 10. Expiry

`daysRemaining`, `isExpired`, `isExpiringSoon(endDate, today, windowDays)` and `contractDisplayStatus`:
- **Default window:** `DEFAULT_EXPIRING_WINDOW_DAYS = 30`. **BUSINESS DECISION REQUIRED** for the real figure.
- **Derived, not stored.** The list filters derive status in SQL from the dates. No notification schedule is chosen.

## 11. Renewal

- **"Start renewal"** on a contract → `POST /api/amc-contracts/[id]/renewal`. This creates a normal **draft** proposal owned by the person who asked, with `renewal_of_contract_id` set.
- **Pre-filled** with: the customer, property, account managers and discount; the contracted services that the **current** catalogue still offers (others are reported back); and dates starting at the old end date, for the same term.
- **Pricing:** priced by the server against current settings.
- **Then the normal workflow:** approval, client approval, signature, activation. That last step sets the new contract's `renewed_from_contract_id`.
- **Guards:**
  - the old contract is never edited or extended;
  - a cancelled contract can't be renewed;
  - only one renewal proposal per contract, and a contract can be renewed at most once.
- **Nothing is sent automatically.**
- **BUSINESS DECISION REQUIRED:** there's no price list, so the draft starts from the old contract's base prices for review.
- **Reminders:** *superseded in Part 2 (§P10):* default thresholds 60/30/15, switched off, with the Todo link and dedupe table in migration `20261006110000`.

## 12. Additional-service discount foundation

`lib/amc/additional-service-discount.ts`:
- **`discountedPrice(standard, percent)`:** rounded half up to the fil.
- **`additionalServicePrice({ serviceKey, standardPrice, hasContractInForce, config })`:** checks eligibility (AMC in force, a configured rate, an eligible service) and returns the standard / discount / discounted figures.
- **Off by default:** `enabled: false`, `discountPercent: null`, no eligible services or categories (Part 2, §P12).
- **The brochure's 25% isn't applied anywhere,** and no quotation flow calls this. **BUSINESS DECISION REQUIRED.**

## 13. UI implemented

| Screen | Path | Contents |
|---|---|---|
| AMC contracts list | `/extensions/amc-contracts` (menu: Extensions → AMC contracts) | Status pill tabs with counts (All, Pending activation, Active, Expiring, Not started, Expired, Cancelled); canonical DataTable: customer/property identity cell, contract no., account manager, period + days remaining, contract value, soft-tinted status pill, kebab menu (Activate AMC / open contract / open source proposal); search; pagination; skeleton loading; error state with Retry; distinct empty states |
| Contract details | `/extensions/amc-contracts/[id]` | Heading with Refresh, Start renewal, Cancel contract, Record usage; stat cards (status + days remaining, period, value incl. VAT, allowances left); **Coverage and usage** (every service, type, call-out class, units × frequency, progress bar, used/remaining, per-row Record); **Overview** (customer, contact, property, account managers); **Commercial** (subtotal, discount, fee before VAT, VAT, grand total); **Source** (signed proposal link, signer, activation, renewal links); **Usage history**; **History** (audit). Skeleton and error states; a cancelled-contract banner |
| Dialogs | — | Activate AMC (dates from the proposal, validated live); Record usage (service, used/adjustment, quantity, date, FSM reference, notes, live remaining and limits); Cancel contract (reason) |
| Signed proposal page | `/extensions/amc/[id]` | **Activate AMC**, or **Open contract** |

Built from the existing kit (DataTable, RecordsToolbar, IdentityCell, Money, PageHeading, StatCard, SectionCard, DataRow, PillTabs, ActionDialogContent, DatePickerField) and the design references. Layout is responsive: grids collapse to one column below `lg` / `sm`. Internal IDs aren't shown; only the customer ID the team enters is.

**Not visually verified in a browser.** The screens need a signed-in session (I don't sign in with real credentials) and a database with the new tables. The portal's database is production, where the migration isn't applied. They're verified by type-check, lint and production build only. The manual check is listed in §20.

## 14. APIs implemented

| Method and path | Who | What |
|---|---|---|
| `GET /api/amc-contracts?status=&search=&page=&pageSize=` | AMC users (own proposals' contracts); approvers (all) | List + pending activations + counts |
| `POST /api/amc-contracts` | Owner or approver | Activate |
| `GET /api/amc-contracts/[id]` | Owner or approver | Contract, entitlements (with remaining / percent / label), usage, audit, source, permissions |
| `POST /api/amc-contracts/[id]/usage` | Owner or approver | Record consumption or adjustment |
| `POST /api/amc-contracts/[id]/cancel` | Approvers | Cancel with a reason |
| `POST /api/amc-contracts/[id]/renewal` | Owner or approver | Start a renewal draft |
| `GET /api/amc-contracts/coverage?customerRef=&serviceId=&date=` | AMC users | Coverage check (read-only) |
| `GET /api/amc-submissions?id=` (changed) | unchanged | Now also returns `contract_id` for signed proposals (null = not activated; absent = table missing) |

Every route returns a clear **503** if the migration isn't applied.

## 15. Audit events

All in `amc_audit_events`, entity type `contract` (activation is also recorded on the proposal):

| Event | When |
|---|---|
| `contract_activated` | Activation; payload: dates, total, services |
| `entitlement_consumed` | Each consumption |
| `entitlement_adjusted` | Each adjustment; the reason goes in `justification` |
| `contract_cancelled` | Cancellation; the reason goes in `justification` |
| `renewal_created` | A renewal draft is started |

## 16. Tests

`npm test`: **70 passed** (57 existing + 13 new in `tests/amc/active-contracts.test.ts`). The new tests cover:

| Area | Covered |
|---|---|
| Activation | unsigned refused, signed accepted, duplicate refused, invalid period |
| Entitlement derivation | from signed rows and types (visits, hours, unlimited, informational, unknown → informational, unticked excluded) |
| Dates | valid and invalid periods, default end date, month-end clamping, days remaining, expiring, expired, display status, Dubai date |
| Entitlements and usage | remaining, labels, consumption, decimals, over-consumption, informational, out-of-period, cancelled, adjustments |
| Coverage | active, expired, not started, cancelled, covered, not covered, unlimited, exhausted, informational, renewal overlap |
| Renewal | pre-fill, current catalogue, dropped services, **source unchanged**, reminders off by default, configurable thresholds |
| SLA | met, breached, pending, unknown |
| Discount | off by default, eligibility, rounding |
| Pricing | the existing pricing tests still pass |

The database rules were tested separately on local Postgres (§2).

## 17. Build results

| Check | Result |
|---|---|
| `npm test` | 70 / 70 |
| ESLint (all new and changed files) | 0 problems |
| TypeScript (all new and changed areas) | 0 new errors; the 2 known `amc-pdf-utils.tsx` errors remain (pre-existing) |
| `next build --webpack` | **Succeeded** (exit 0); new routes `/api/amc-contracts`, `/[id]`, `/[id]/usage`, `/[id]/cancel`, `/[id]/renewal`, `/coverage`, and pages `/extensions/amc-contracts`, `/[id]` compiled. Only notices: the existing "Dynamic server usage … cookies" log lines (pages render on demand) and the pre-existing `middleware` deprecation |
| Local migration test | Passed (twice) |

## 18. Migrations created / not applied

| File | Depends on | Order |
|---|---|---|
| `20261006100000_active_amc_contracts.sql` | `amc_submissions`, `amc_audit_events`, `user_profile`; **apply after** the hardening migrations (`20261005100000`–`20261005180000`) and the migration-history reconciliation | Apply as one transaction, then deploy the code. The code before the migration shows clear 503s on the contract screens; everything else works |

**Backfill:** **none performed, and none should be automatic.** Production has 3 signed proposals (AMC-2026-6886, 6890, 6891), each signed 23–52 seconds after sending, which suggests test runs. After review, a real one is converted by pressing **Activate AMC** (no script needed). Test ones should be left unactivated or marked as test data. **BUSINESS DECISION REQUIRED.**

**Runbook:** add this migration as step 7.7 of `docs/amc-hardening-production-runbook.md`, after D8, with the verification queries in the migration and §2 above.

## 19. Business decisions still required

1. Whether visit and hour allowances scale with units (§5).
2. The "expiring" window in days (§10).
3. Renewal reminder schedule (e.g. 60/30/15 days are examples only), who receives them, and allowing `todos.related_type = 'amc_contract'` (§11).
4. Renewal pricing: start from the old base prices or a rate card (§11).
5. Additional-service discount: rate, eligible services, contract vs customer eligibility (§12).
6. Who may record usage: today the proposal owner and approvers; operations staff may need it (§6).
7. Whether early signed proposals are real (to activate) or test data (§18).
8. FSM: confirm `customer_ref` = FSM `Customer_Id__C`, the service-to-FSM-line mapping, and which FSM status means "completed" (§7).
9. SLA targets: confirm 120 min attendance (emergency) and 6 h scheduling (non-emergency), and where request/arrival times will come from (§9).
10. Linking contracts to `snagging_clients` / `snagging_properties` (not done; `snagging_clients` isn't in tracked migrations).
11. Carried over from earlier phases: self-approval, layout sign-off, OI-5 / clause 6.3, 5% VAT, typed-name signature, PPM / handyman default frequencies, link validity, property assessment.

## 20. Deferred functionality

- Automatic FSM usage sync (§7); SLA evaluation from real timestamps (§9).
- Creating renewal reminder Todos (§11).
- Applying the additional-service discount in quotations (§12).
- Contract PDF archive (server-side generation and storage of the signed contract).
- Visual verification of the new screens in a browser, signed in against a database with the migration (desktop and mobile widths). To do on staging/local after migration: activate a signed proposal, record usage until exhausted, cancel, start a renewal.
- **Security (deferred to the security phase, per this goal):**
  - `roles` / `role_access` / `user_profile` are writable with the anon key;
  - the public Zoho edge functions, and the token logged by one of them;
  - `/api/graphql` has no authentication;
  - the public `uploads` bucket.

  Because roles can currently be forged, the contract permissions (owner / approver) are only as strong as the role tables.

## 21. Recommended next phase

1. **Security phase:** close the role tables and the edge functions. Active AMC permissions depend on them.
2. **Deploy:** reconcile the migration history, apply the hardening migrations and this one, then deploy and smoke-test, including the §20 manual UI checks.
3. **Decisions:** take §19 items 1, 6, 7 and 8.
4. **FSM usage sync:** customer mapping, then service mapping, then consume on completion through `coverageFor` + the ledger.
5. **Reminders and expiry:** renewal reminders via Todos, and an "expiring" notification once the schedule is approved.
6. **Signed contract archive** (server-side PDF).

---

## Task classification (Part 1)

| # | Task | Status |
|---|---|---|
| 1 | Data model design | COMPLETED |
| 2 | Migrations | COMPLETED (not applied) |
| 3 | Lifecycle | COMPLETED |
| 4 | Activation | COMPLETED |
| 5 | Start/end dates | COMPLETED |
| 6 | Contracts list | COMPLETED (not browser-verified) |
| 7 | Contract details | COMPLETED (not browser-verified) |
| 8 | Entitlement model | COMPLETED · units scaling: BUSINESS DECISION REQUIRED |
| 9 | Usage ledger | COMPLETED |
| 10 | FSM integration prep | PARTIALLY COMPLETED (local mapping done; completion hook DEFERRED: no trustworthy event) |
| 11 | Coverage engine | COMPLETED |
| 12 | Emergency vs non-emergency | COMPLETED |
| 13 | SLA foundation | PARTIALLY COMPLETED (definitions and evaluation done; no timestamps to evaluate: DEFERRED) |
| 14 | Expiry | COMPLETED · window: BUSINESS DECISION REQUIRED |
| 15 | Renewal | COMPLETED · renewal pricing: BUSINESS DECISION REQUIRED |
| 16 | Renewal reminders | PARTIALLY COMPLETED (planner; Todo creation DEFERRED pending schedule) · BUSINESS DECISION REQUIRED |
| 17 | Additional-service discount | COMPLETED (foundation) · BUSINESS DECISION REQUIRED |
| 18 | Audit | COMPLETED |
| 19 | Tests | COMPLETED |
| 20 | UI/UX verification | PARTIALLY COMPLETED (states, responsive layout, existing components; browser check BLOCKED: needs sign-in and a migrated database) |
| 21 | Migration notes | COMPLETED |
| 22 | Report | COMPLETED |
| 23 | Final verification | COMPLETED (§17) |


---

# Part 2: Operations and contract management

**Goal:** make Active AMC usable day to day (record and correct usage, check coverage, manage expiry and renewal) while keeping clean points for FSM to plug into later. No automatic FSM consumption, no reminders sent, no discount applied, no production change.

## P1. Review of the foundation

A review of commit `cad560e` found these, all fixed here:

| # | Finding | Fix |
|---|---|---|
| 1 | **The list returned 500 on every tab.** The new `renewal_of_contract_id` gave `amc_contracts` and `amc_submissions` a second foreign key, so PostgREST refused the unnamed embeds (PGRST201) | Every embed names `amc_contracts_submission_id_fkey` |
| 2 | Periods under a whole month (6 to 20 Oct) failed activation with a raw database error: `term_months` was 0 against a `> 0` CHECK | Stored as null |
| 3 | Legacy proposals (rows with a price but no base price) got contracted prices of 0 and a subtotal of 0 against a real fee | `signedCommercials`: legacy rows keep their line price; subtotal = stored final + stored discount |
| 4 | Pending activations were cut at 500 rows before filtering | Anti-join in the database (`amc_contracts=is.null`), re-checked in code |
| 5 | Every check violation read "past its allowance"; every unique violation read "already activated" | Errors matched on the constraint or message (cancelled meanwhile, below zero, reference pair, renewal already used) |
| 6 | A renewal started on the old end date, so both contracts covered that day | Starts the day after; same term by the activation convention |
| 7 | Two quick clicks could create two renewal drafts | Unique index `idx_amc_submissions_one_renewal`; 23505 becomes a 409; the detail page hides the button once a renewal exists |
| 8 | If the compensating delete after a failed entitlement insert also failed, it was silent | Checked; logged loudly; the user is told an administrator must remove it |
| 9 | The coverage endpoint answered for any customer's contracts | Only contracts the caller can see (their own proposals', or all for approvers) |
| 10 | A usage timestamp near midnight was checked against the UTC date | `usageDate` reads it in Dubai time |
| 12 | The All tab paged wrongly (trailing empty pages) | One continuous list: pending rows first, then contracts, paged together |

Not changed: #11 (allowances do not scale with the contract length; a business decision, below).

## P2. Migration `20261006110000_active_amc_operations.sql` (NOT APPLIED)

Apply after `20261006100000`. Verified on the throwaway Postgres 15 cluster, applied twice.

| Change | Why |
|---|---|
| `amc_entitlement_usage.corrects_usage_id` + kind `correction` + CHECK `amc_usage_correction_shape` | A correction must reference an entry, be negative and carry a reason; other kinds may not reference one |
| Trigger `amc_apply_entitlement_usage` replaced | A correction's original must be a consumption on the same service, and all corrections of an entry together can never exceed it |
| `amc_contracts.account_manager_names` (text, backfilled) | Search and filter by account manager |
| `todos_related_type_check` allows `amc_contract` | Renewal reminder Todos can point at a contract |
| `amc_renewal_reminders` (unique per contract and threshold; RLS on, no browser grants) | A reminder is never created twice |
| Unique index `idx_amc_submissions_one_renewal` | One renewal proposal per contract. **Pre-check** in the migration header must return no rows |

Local checks passed: correction reduces usage; over-correction, a correction without a reason or original, a cross-service correction and a positive correction are refused; todos accept `amc_contract` and refuse unknown types; duplicate reminders and a second renewal proposal are refused; authenticated users cannot read reminders.

## P3. Operational summary and coverage table

The contract page opens with four cards:
- **Status:** status pill, expiry label ("Expires in 24 days"), period and term.
- **Contract value:** incl. VAT, and before VAT.
- **Coverage:** total services, how many have allowance left, exhausted, unlimited, included.
- **Usage:** entries, visits left of included and hours left of included (**always separately; visits and hours are never added**), last usage date.

The **Coverage** table lists every service with type, included, used, remaining, frequency, call-out class and a state:

| State | Rule |
|---|---|
| Available | Allowance left, more than a quarter |
| Low remaining | A quarter or less left (`LOW_REMAINING_FRACTION = 0.25`, a configuration default) |
| Exhausted | Nothing left |
| Unlimited | Unlimited service; **no percentage** |
| Included | Informational; not counted, **no percentage** |
| Not started / Expired / Cancelled | The contract's own state overrides |

## P4. Usage: record, history, corrections

- **Record usage** (owner or approver, contract in force): service, quantity, date of the work, FSM work order or appointment reference, notes. Before saving it shows **Included / Already used / Recording / Remaining after**; for unlimited, "Unlimited". Used-up services are disabled; informational services are not offered.
- **History:** paged (10/25/50), filterable by service, newest first. Columns: date (and when it was entered), service, quantity, source, FSM reference, recorded by, notes. **No editing or deleting.**
- **Corrections:** a **Correct** action on any consumption that still counts. The dialog shows the entry, asks how much to take back (default: all that still counts) and a **mandatory reason**. It adds a `correction` row that references the original; the original is untouched. Corrections show amber with "Corrects the entry of …", and the corrected entry shows what still counts. Allowed whatever the contract state, since fixing the record is not new usage. Guarded three times: `checkCorrection` (form and server), the trigger, and the CHECKs. Audit: `entitlement_corrected` with the reason, actor and time.
- The usage API now accepts **consumption only**. Free `adjustment` entries are no longer accepted (the kind remains in the database for future system use).

## P5. Coverage check

**Check coverage** on the contracts page (by Customer ID, or by searching for a contract) and on each contract page. Inputs: request type (planned service, emergency call-out, non-emergency call-out), service, date. Output:
- **AMC status:** Active, Not started, Expired, Cancelled or None.
- **Service:** Covered or Not covered.
- **Entitlement:** included, used, remaining (or Unlimited, or Included not counted).
- **Result:** **COVERED BY AMC**, **CHARGEABLE** or **NO ACTIVE AMC**, with the reason.
- For call-outs, the SLA target, with the status stated as unknown.

Read-only: it records nothing and creates no work orders.

## P6. Activation

The **Activate AMC** dialog now loads a preview first (`GET /api/amc-contracts/activation-preview`):
- customer and Customer ID, property, value incl. and before VAT, signer and signing time, proposal number, account managers;
- every service and the allowance it will get;
- the dates, with where they came from ("Taken from the signed proposal's contract dates", or "Changed from the proposal's dates …").

Activation needs the **"I have checked …" box** (the API also requires `confirmed: true`). A proposal that is already activated, not signed, or has no recorded signature shows why instead, with a link to the existing contract where there is one. After activation the page opens the contract.

## P7. Cancellation

Approvers only. The dialog states the consequences (coverage stops, no new usage, history kept, cannot be undone), needs a reason and a confirmation box. It records `cancelled_at`, `cancelled_by` and the reason, and writes `contract_cancelled`. Afterwards the contract stays viewable with a cancellation banner, usage stays visible and correctable, new usage is refused (UI, server and trigger), and coverage answers **NO ACTIVE AMC** (status Cancelled).

## P8. Expiry

Derived, never stored. `EXPIRING_SOON_DAYS = 30` is a **configuration default, not a business rule**. Labels: "Starts in 5 days", "Expires in 24 days", "Expires tomorrow", "Expires today", "Expired yesterday", "Expired 12 days ago", "Cancelled". Not-started and expired contracts get a banner on their page.

## P9. List and dashboard

- **Tabs:** All, Active, Expiring, Expired, Pending activation, Not started, Cancelled, with counts.
- **Search:** customer, Customer ID, property, contract number, account manager.
- **Filter:** account manager (from the visible contracts).
- **Columns:** Contract, Customer, Property, Account manager, Start, End (with expiry label), Coverage (services, exhausted), Value, Status.
- **Sorting** by contract, customer, property, start, end or value, done by the server.
- **Dashboard cards** (counted from the contracts the viewer can see; each opens its filter): In force with the total value in force, Pending activation, Expiring soon, Expired, Allowance used up (in-force contracts with a visit or hour allowance at zero). **Recent usage** lists the latest six entries and the count over 30 days.

## P10. Renewal and reminders

- **Renewal card** on the contract page: a timeline **Previous contract → This contract → Renewal proposal → Renewed contract**, each linked when it exists.
- **Create renewal proposal** opens a preview: the new period (the day after the old end date, same term), discount, current value against the value at today's settings, every service copied (units, frequency, base price), services no longer offered, and the pricing rule in words. Afterwards: **Open renewal proposal**. Duplicates are blocked by the shared rule `renewalBlockedReason` and the unique index.
- **Reminders card:** the planned reminder dates (60, 30 and 15 days before the end date, **configuration defaults**) and which exist. `AMC_RENEWAL_REMINDERS_ENABLED = false`: nothing is created or emailed, and `POST /api/amc-contracts/[id]/reminders` answers 409. When switched on, each reminder inserts its `amc_renewal_reminders` row first (unique per contract and threshold), then the Todo (`related_type = 'amc_contract'`, owner = the proposal's owner, reminder 09:00 Dubai on the date, deadline the end date), so a rerun or a parallel run never duplicates.

## P11. SLA, documents, account managers, audit

- **Service levels card:** the target for each call-out class on the contract (emergency attendance 120 minutes, non-emergency scheduling 6 hours), status **unknown**, because the portal has no request or arrival times from FSM.
- **Documents card:** view or download (PDF) the proposal with its brochure, and the contract, rebuilt from the signed proposal's saved data and the wording captured when each was sent. **There is no stored copy of the signed PDF**, and the card says so. A document never sent renders with today's settings.
- **Account managers** from the signed snapshot, on the contract page, in the list, in search and in the filter.
- **History timeline** with the actor, the time and the reason: Contract activated, Usage recorded, Usage corrected, Contract cancelled, Renewal proposal created, Renewal reminders created.

## P12. Additional-service discount

Configuration is now `{ enabled, discountPercent, eligibleServiceKeys, eligibleCategories }`; the default is off with nothing eligible. `additionalServicePrice` needs the switch on, a rate, and a matching service or category, and an AMC in force. **Nothing calls it**, quotations are unchanged, and the brochure's 25% is not applied.

## P13. APIs added or changed

| Method and path | Who | What |
|---|---|---|
| `GET /api/amc-contracts?status=&search=&manager=&sort=&dir=&page=&pageSize=` | AMC users (own); approvers (all) | List; adds sorting, manager filter, coverage summary, expiry label, managers list |
| `POST /api/amc-contracts` | Owner or approver | Activate; now needs `confirmed: true` |
| `GET /api/amc-contracts/activation-preview?submissionId=` | Owner or approver | What activation would create |
| `GET /api/amc-contracts/summary` | AMC users | Dashboard figures |
| `GET /api/amc-contracts/[id]` | Owner or approver | Adds summary, entitlement states, expiry label, SLA targets; usage moved to its own endpoint |
| `GET /api/amc-contracts/[id]/usage?page=&pageSize=&entitlementId=` | Owner or approver | Paged history with corrected totals |
| `POST /api/amc-contracts/[id]/usage` | Owner or approver | Consumption only |
| `POST /api/amc-contracts/[id]/usage/[usageId]/correction` | Owner or approver | `{ amount, reason }` |
| `GET /api/amc-contracts/[id]/renewal` | Owner or approver | Relationships and preview |
| `GET` / `POST /api/amc-contracts/[id]/reminders` | Owner or approver | Plan; create (409 while switched off) |
| `GET /api/amc-contracts/coverage?catalogue=1` / `?contractId=` / `?customerRef=` | AMC users, scoped | Catalogue; coverage, verdict, SLA target |

## P14. Tests and verification

`npm test`: **87 passed** (70 before + 17 new in `tests/amc/contract-operations.test.ts`; 3 Part 1 tests updated for the intended changes: renewal dates, reminder defaults, discount switch). New coverage: corrections (partial, full, repeated, over-correction, below zero, no reason, correcting a correction, bad amounts); over-consumption; unlimited; informational; cancelled, expired and not-started usage; Dubai usage date; usage preview; entitlement states; summary keeping visits and hours apart; coverage AMC status and verdicts; expiry labels; short periods; activation pricing for legacy rows; renewal non-overlap, same term and duplicate blocking; reminder dedupe; SLA unknown; discount switch and categories. Database rules: §P2.

| Check | Result |
|---|---|
| `npm test` | 87 / 87 |
| ESLint (all new and changed files) | 0 problems |
| TypeScript (all AMC areas, incl. every new route) | 0 new errors; the 2 known `amc-pdf-utils.tsx` errors remain (pre-existing) |
| `next build --webpack` | **Succeeded** (exit 0); all new routes and both pages compiled. Only the existing "Dynamic server usage … cookies" notices and the `middleware` deprecation |
| Local migration test (both migrations, applied twice) | Passed |

**Not verified in a browser.** The screens need a signed-in session and a database with both migrations; the portal's database is production, where neither is applied. Use the checklist in `docs/active-amc-user-testing-checklist.md` on staging or a local database.

## P15. Business decisions still required (Part 2)

1. The expiring window (30 days is a default) and the low-remaining threshold (25%).
2. The renewal reminder schedule (60/30/15 are defaults), who receives the Todos, and switching reminders on.
3. Whether allowances scale with units, and with contracts longer or shorter than a year (review #11).
4. Renewal pricing: the old base prices (today) or a rate card.
5. Additional-service discount: rate, services or categories, and per contract or per customer.
6. Who may record and correct usage: today the proposal owner and approvers. Whether corrections should be approver-only.
7. Whether the early signed proposals are real (to activate) or test data.

## Task classification (Part 2)

| # | Task | Status |
|---|---|---|
| 0 | Commit the foundation | COMPLETED (`cad560e`; push blocked: no GitHub credentials in this environment) |
| 1 | Review and fix | COMPLETED (11 fixed; #11 is a business decision) |
| 2 | Operational summary | COMPLETED |
| 3 | Coverage table | COMPLETED |
| 4 | Record usage UX | COMPLETED |
| 5 | Usage history | COMPLETED |
| 6 | Corrections | COMPLETED |
| 7 | Coverage check UI | COMPLETED |
| 8 | Activation UX | COMPLETED |
| 9 | Cancellation UX | COMPLETED |
| 10 | Expiry | COMPLETED · window: BUSINESS DECISION REQUIRED |
| 11 | List improvements | COMPLETED |
| 12 | Dashboard cards | COMPLETED |
| 13 | Renewal UX | COMPLETED · pricing: BUSINESS DECISION REQUIRED |
| 14 | Renewal relationships | COMPLETED |
| 15 | Renewal reminders | COMPLETED (switched off) · schedule: BUSINESS DECISION REQUIRED |
| 16 | SLA display | COMPLETED (targets; status unknown until FSM timestamps exist) |
| 17 | Discount configuration | COMPLETED (not applied anywhere) · BUSINESS DECISION REQUIRED |
| 18 | Document access | COMPLETED (rebuilt from the snapshot; no signed-PDF archive, stated) |
| 19 | Account managers | COMPLETED |
| 20 | Audit timeline | COMPLETED |
| 21 | Responsive review | COMPLETED in code (tables scroll inside their cards, dialogs scroll, header actions wrap); browser check BLOCKED: needs sign-in and a migrated database |
| 22 | Tests | COMPLETED |
| 23 | Docs | COMPLETED |
| 24 | Verification | COMPLETED (§P14) |
| 25 | Commit | COMPLETED (local commit on `active-amc`; push needs GitHub credentials, not merged to main) |

---

# Part 3: Zoho FSM integration

Details: `docs/amc-fsm-integration-report.md`; evidence: `docs/amc-fsm-integration-analysis.md`. Migration `20261006120000` (not applied).

| Link in the chain | Status |
|---|---|
| AMC contract → FSM customer | **Explicit link** (`fsm_contact_id`, from a real work order's contact). No identifier was shared before; the proposal's Customer ID is free text |
| AMC service → FSM service | **Explicit mapping** (`amc_fsm_service_mappings`, approvers). None entered yet |
| Entitlement → FSM work order / appointment | **Done** (`amc_fsm_links`, with the coverage answer at linking) |
| Scheduling → AMC context | **Done**, read-only notice under the chosen work order |
| FSM appointment → completed | **Observed, not confirmed:** "Completed" + actual end time |
| Completed → AMC usage | **Engine built, automatic OFF.** Completed visits show "Needs review"; a person confirms. Idempotent per appointment |
| Reversal | **Manual**, as a correction referencing the original |
| Hours | **Manual.** FSM's duration is shown for reference only |
| SLA | **Unavailable.** Request time can be entered on links; attendance and booking times are not mapped |

Tests: 100 / 100 (13 new).
