# Active AMC: implementation report

**Date:** 6 October 2026
**Branch:** `active-amc` (from `amc-hardening` at `51c023b`, which is not yet pushed), worktree `_wt/amc-hardening`. Not committed or pushed.
**Production:** not modified. No migration applied; no signed proposal converted.

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

- **Kinds:** `consumption` (positive) or `adjustment` (± with a reason).
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

`checkCoverage(contracts, { serviceId, date })` (pure) and `coverageFor(admin, { customerRef, serviceId, date })` (server). Exposed read-only at `GET /api/amc-contracts/coverage`.

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
- **Reminders:** `planRenewalReminders(endDate, today, thresholds)`, with **`AMC_RENEWAL_REMINDER_DAYS = []`** (none until approved). They would be created as Todos, so the existing reminders cron emails them. That needs `todos.related_type` to allow `'amc_contract'` (a one-line CHECK change, **not made**) and an approved schedule.

## 12. Additional-service discount foundation

`lib/amc/additional-service-discount.ts`:
- **`discountedPrice(standard, percent)`:** rounded half up to the fil.
- **`additionalServicePrice({ serviceKey, standardPrice, hasContractInForce, config })`:** checks eligibility (AMC in force, a configured rate, an eligible service) and returns the standard / discount / discounted figures.
- **Off by default:** `discountPercent: null`, `eligibleServiceKeys: []`.
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

## Task classification

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
