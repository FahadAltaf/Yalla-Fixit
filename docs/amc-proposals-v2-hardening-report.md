# AMC Proposals v2: production hardening report

**Date:** 5 October 2026
**Branch:** `amc-hardening` (from `main` at `db3dfc6`), in a separate worktree; nothing committed, pushed or merged
**Production:** not modified. No migration applied, no `db push`, no data changed. Read-only queries only.
**Basis:** the read-only audit of 5 Oct 2026 (findings D1–D9, E, C, J referenced below)

---

## 1. Executive summary

The existing proposal workflow is now enforced on the server end to end, and the code paths that let a browser or a request bypass it are closed in the code. Two of the closures (direct database writes, and proposal numbers past 9999) need migrations that are written but **not applied**; applying them is a production maintenance step that depends on reconciling the migration history first.

What changed, in one line each:

- **Database write hole (D1, D2):** migration drops every browser write path to `amc_submissions`; the API (service role) is the only writer. *Pending apply.*
- **Open email relay (D4):** `/api/send-email` now serves only signed internal calls, signed-in active users, and one narrow public case (notify a company mailbox). Validated, size-limited, PDF-only attachments.
- **Pricing (E):** one integer-fils pricing implementation shared by the API, wizard, documents and lists. The server recalculates and stores every total; browser totals are ignored.
- **Rounding (E):** the printed parts always add up to the printed total; amount in words is read from the same integer as the figure; no "ONE HUNDRED FILS".
- **Services (E):** AMC Settings is the catalogue for new and draft proposals; switched-off services can no longer be charged; sent proposals keep their snapshot.
- **Public payload (D5):** explicit DTO; no approver emails, no disabled clauses, no other services' scopes.
- **Tokens (D7, D8, J):** a link is usable only while its document awaits the client; answered, signed, superseded and revised links fail safely; stale client decisions are cleared.
- **Input limits (D9):** names, reasons and body size are bounded and cleaned.
- **Attachments (D6):** server-named, PDF-signature-checked, size-limited; full integrity needs server-side generation (follow-up).
- **Placeholders (E):** case-insensitive, printed-text-only, says where; covers proposal data.
- **Proposal numbers (C):** migration fixes the 10,000 collision. *Pending apply.*
- **Send auditing (J):** every attempt is audited, including refused and failed sends.
- **Self-approval:** one switch in `lib/amc/workflow.ts`, still **allowed**, pending a business decision.
- **Tests:** a dependency-free test runner and 53 tests, all passing.

A critical issue **outside AMC** was found during this phase: `public.settings` (holding the Zoho FSM OAuth access token) is readable and writable with the public anon key. It is documented in `docs/security-followup-shared-rls.md` §0 for an urgent, separate fix.

---

## 2. Tasks and status

| # | Task | Status |
|---|---|---|
| 1 | Close AMC direct database write holes | **COMPLETED** in repo (migration written) · **MANUAL ACTION REQUIRED** to apply |
| 2 | Secure `/api/send-email` | **COMPLETED** |
| 3 | Server is the authority for pricing | **COMPLETED** |
| 4 | Rounding consistency | **COMPLETED** |
| 5 | Settings/service source of truth | **COMPLETED** |
| 6 | Reduce public client payload | **COMPLETED** |
| 7 | Client token lifecycle | **COMPLETED** |
| 8 | Validate client decision input | **COMPLETED** |
| 9 | Document attachment trust | **PARTIALLY COMPLETED** (validation done; server-side generation deferred to the Signed Contract Archive phase) |
| 10 | Placeholder validation | **COMPLETED** |
| 11 | Proposal number past 9999 | **COMPLETED** in repo (migration written) · **MANUAL ACTION REQUIRED** to apply |
| 12 | Send failure auditing | **COMPLETED** |
| 13 | Signature document behaviour | **BUSINESS DECISION REQUIRED** (documented; helper prepared; nothing rendered) |
| 14 | Self-approval policy preparation | **COMPLETED** (single switch) · **BUSINESS DECISION REQUIRED** for the policy |
| 15 | Automated test foundation | **COMPLETED** (53 tests, all pass) |
| 16 | Update manual testing guide | **COMPLETED** (no manual test claimed as run) |
| 17 | Migration history: prepare, do not repair | **COMPLETED** (document) · **MANUAL ACTION REQUIRED** (DevOps) |
| 18 | Shared RLS risks | **COMPLETED** (findings + one isolated migration for `schedule_audit_events`) · estimate tables and `settings` **BLOCKED** on a separate security phase |
| 19 | Build / typecheck / lint / test | **COMPLETED** (see §10) |
| 20 | Final report | **COMPLETED** (this file) |

---

## 3. Files changed

**Modified (16)**

| File | Why |
|---|---|
| `app/api/amc-submissions/route.ts` | Server pricing on POST/PUT; settings catalogue check; proposal-number JSONB pinned on create; `viewer_can_approve` uses the policy |
| `app/api/amc-submissions/approval/route.ts` | Transitions from `lib/amc/workflow.ts`; submit completeness check; stale client decision cleared on resubmit |
| `app/api/amc-submissions/send/route.ts` | Placeholder scan; attachment checks and server naming; stale client decision cleared on proposal send; audit for refused, failed and no-recipient attempts |
| `app/api/amc/[token]/route.ts` | Link resolution and lifecycle; explicit public DTO; bounded and cleaned decision input |
| `app/api/send-email/route.ts` | Caller authorization, validation, payload limits |
| `lib/email-service.ts` | Same-origin call in the browser; signed call on the server |
| `components/dashboard/extensions/amc/amc-pricing.ts` | Delegates to the canonical pricing; catalogue-driven row sync; document totals over listed rows |
| `components/dashboard/extensions/amc/amc-proposal-content.ts` | Brochure rows match the contract's rows (by id); fils kept in fees |
| `components/dashboard/extensions/amc/utils/amount-to-words.ts` | Reads integer fils |
| `components/dashboard/extensions/amc/components/service-table.tsx` | Rows from AMC Settings services |
| `components/dashboard/extensions/amc/steps/services-pricing-step.tsx` | Same; hidden-services notice names Settings labels |
| `components/dashboard/extensions/amc/index.tsx` | Sync rows after Settings load; warn when a ticked service is removed |
| `components/dashboard/extensions/amc/submissions-list.tsx` | Approve/Send back follow the self-approval policy |
| `components/dashboard/extensions/amc/submission-details.tsx` | Same |
| `docs/amc-proposals-v2-testing.md` | Stale content removed; new sections J–O and security checks 4.6–4.13 |
| `package.json` | `npm test` script (no new dependencies) |

**Added**

| File | Purpose |
|---|---|
| `lib/amc/pricing.ts` | Canonical pricing, money rounding, row validation schema |
| `lib/amc/workflow.ts` | Status transitions, send/client rules, self-approval switch, stale-decision fields |
| `lib/amc/placeholders.ts` | Placeholder finder and the "what this document prints" list |
| `lib/amc/proposal-number.ts` | Number format rule (mirror of the SQL function, tested) |
| `lib/amc/signature.ts` | What a signature records today; caption helper for later |
| `lib/server/amc/pricing.ts` | Server pricing against the Settings catalogue; submit completeness |
| `lib/server/amc/public-dto.ts` | Public status and settings DTOs; decision schema |
| `lib/server/amc/link-resolution.ts` | Token resolution (not found / expired / open / closed) |
| `lib/server/email-request-policy.ts` | `/api/send-email` rules |
| `lib/internal-signature.ts` | HMAC signing of server-to-server calls |
| `tests/setup/ts-loader.mjs`, `tests/setup/register.mjs` | TypeScript loader for `node --test` |
| `tests/amc/*.test.ts`, `tests/email/*.test.ts` | 53 tests |
| `supabase/migrations/20261005100000_amc_close_direct_writes.sql` | Task 1 |
| `supabase/migrations/20261005110000_amc_proposal_number_beyond_9999.sql` | Task 11 |
| `supabase/migrations/20261005150000_restrict_shared_allow_all_policies.sql` | Task 18 (`schedule_audit_events` only) |
| `docs/database-migration-reconciliation.md` | Task 17 |
| `docs/security-followup-shared-rls.md` | Task 18, plus the `settings` finding |
| `docs/amc-proposals-v2-hardening-report.md` | This report |

---

## 4. Migrations created (none applied)

| File | Effect | Data change | Rollback |
|---|---|---|---|
| `20261005100000_amc_close_direct_writes.sql` | Drops owner insert/update and approver decide policies; revokes INSERT/UPDATE/DELETE/TRUNCATE on `amc_submissions` and the AMC sequences from `anon`/`authenticated`; re-asserts settings/audit are service-role only. Read policies kept. | None | In header |
| `20261005110000_amc_proposal_number_beyond_9999.sql` | `amc_next_proposal_number()` (one `nextval`, pad ≥ 4, never truncate); column default uses it; EXECUTE for `service_role` only | None; sequence untouched | In header |
| `20261005150000_restrict_shared_allow_all_policies.sql` | Drops "Allow All on schedule_audit_events"; revokes `anon`/`authenticated` | None | In header |

The code works with or without these applied: the API already writes with the service role, and the number default is only reached on insert.

---

## 5. Security issues fixed

| Audit ref | Issue | Fix | Where |
|---|---|---|---|
| D1 | Owners could write any column directly (status, prices, signature, tokens) | Browser roles lose all write privileges and policies | migration `20261005100000` (pending) |
| D2 | Approver policy allowed any column change | Policy dropped | same |
| D3 | Self-approval | Single switch, shared by API and UI; behaviour unchanged pending decision | `lib/amc/workflow.ts` |
| D4 | `/api/send-email` open relay | Signed internal / signed-in active user / narrow anonymous case; zod validation; 15 MB body, 500 KB HTML, 50 recipients, PDF-only ≤ 10 MB with `%PDF-` check, safe filenames | `app/api/send-email/route.ts`, `lib/server/email-request-policy.ts`, `lib/internal-signature.ts` |
| D5 | Public link returned full settings incl. approver emails | Explicit DTO | `lib/server/amc/public-dto.ts` |
| D6 | Unchecked browser PDF attachment | Server names the file; base64 and PDF signature checked; size capped; checked before any status change | `send/route.ts` |
| D7 | Client could see unapproved edits after rejecting | Link closed (no document) whenever the proposal is not `proposal_sent` | `link-resolution.ts`, `[token]/route.ts` |
| D8 | Tokens usable after use; proposal link survived into contract stage | Same lifecycle rule; contract link closed after signing | same |
| D9 | No length limits on client input | Name 2–120, reason 3–2000, control characters stripped, strict keys, 16 KB body cap | `public-dto.ts`, `[token]/route.ts` |
| — | Server did not check submit completeness | Ticked service and base price on every ticked row required at submit | `lib/server/amc/pricing.ts`, `approval/route.ts` |

Callers of `/api/send-email` checked (all still work):

| Caller | Runs in | Now authorized as |
|---|---|---|
| `app/api/snagging/approvals/escalations/run/route.ts` (via `emailService`) | server | signed internal call |
| `app/api/snagging/tasks/[id]/deliver/route.ts` | server | signed internal call |
| `app/api/snagging/tasks/[id]/reject/route.ts` | server | signed internal call |
| `app/api/todos/route.ts`, `app/api/todos/reminders/run/route.ts` | server | signed internal call |
| `modules/auth/auth-actions.ts` (password reset), `modules/auth/services/auth-service.ts` (invite) | server actions | signed internal call |
| `components/dashboard/extensions/quotation-templates/quotation-preview-modal.tsx` | browser, signed in | session cookie (same-origin call) |
| `app/quotations/review/ActionSection.tsx` (public quotation review) | browser, anonymous | anonymous: one company-domain recipient, no cc, no attachment |
| `app/api/amc-submissions/send`, `app/api/snagging/quotations/[id]`, `app/api/snagging/tasks/[id]/quotation` | server | do not use the route (in-process `lib/server/send-email.ts`) |

Residual: an anonymous caller can still send arbitrary HTML to a company mailbox (internal phishing risk). The proper fix is a server-built notification endpoint for the quotation review page (follow-up §12).

---

## 6. Pricing changes

- **One implementation:** `lib/amc/pricing.ts`, used by the API, wizard, documents, list, approval notice, brochure and amount in words.
- **Money rule:** amounts are held in whole fils and rounded once, half up, at the step that creates them: row = base × units × frequency (exact); discount = subtotal × % (half up); final = subtotal − discount; VAT = final × 5% (half up); total = final + VAT; monthly = final / 12 (half up).
- **Server authority:** POST/PUT accept rows (`serviceId`, `included`, `units`, `frequency`, `basePrice`) and `discount_percent`; `final_price`, `discount_amount` and row `price` sent by the client are ignored and recalculated. Rows are validated (integers, ranges, unique ids); base prices are normalised to two decimals.
- **Catalogue check:** a ticked service that AMC Settings does not offer on the property type is refused with 400.
- **Consistency:** list and approval totals (`grandTotalFromFinal`) equal document totals to the fil; the brochure keeps fils (3,500.50, not 3,501).
- **Historical rows:** not mutated. A legacy float `final_price` is normalised to fils when displayed.
- **VAT** stays 5%, hard-coded as `AMC_VAT_RATE_BP` (business confirmation pending).

## 7. Token lifecycle changes

| Link | Open (document + answers) | Closed (outcome only) | 404 | 410 |
|---|---|---|---|---|
| Proposal | status `proposal_sent` | any other status (answered, revised, contract stage, signed) | malformed, unknown, or superseded by a re-send | past 30 days |
| Contract | status `contract_sent` | any other status (signed) | same | same |

- Re-sending replaces the hash, so the previous link is a 404.
- Resubmitting after a client rejection clears the proposal token, the snapshot **and** the client decision fields.
- Sending (or re-sending) a proposal clears stale client decision fields.
- The 30-day expiry is unchanged.

## 8. Public API changes

- `GET /api/amc/[token]` → `{ data: PublicStatus, document: AmcClientDocument | null }`.
  - `PublicStatus` gains `closed`; customer and fee fields are null when closed; signer fields only for a signed contract.
  - The fields `services`, `documentOptions`, `discountPercent`, `discountAmount`, `clientDecision` and `clientDecidedAt` were dropped from `data` (unused by the page; still available to the renderer through `document` when open).
  - `document.settings` is the explicit public settings DTO; `document` is null when closed.
- `POST /api/amc/[token]` → same `data` shape; 400 on malformed input; 413 above 16 KB.
- `POST /api/send-email` → 401 anonymous refusal, 400 invalid, 413 too large, 500 provider failure (`{ error: { message } }`).
- `PUT/POST /api/amc-submissions` → 400 when a ticked service is not offered; totals in the response are the server's.
- `POST /api/amc-submissions/approval` (submit) → 400 when nothing is ticked or a ticked row has no base price.
- `POST /api/amc-submissions/send` → 409 with `placeholders: [{ location, excerpt }]`; 400 for a bad attachment; audit rows `proposal_send_refused` / `contract_send_refused`, and `proposal_sent` / `contract_sent` with `outcome` = `emailed` | `link_created` | `no_recipient` | `email_failed`.

## 9. Testing added

`npm test` runs `node --test` with a small TypeScript loader (`tests/setup/`), using the repo's own `typescript`; no new dependency.

| File | Covers |
|---|---|
| `tests/amc/pricing.test.ts` | base × units × frequency, VAT, discount, rounding sweeps (parts add up; list = document), float normalisation, amount in words (fils, no "ONE HUNDRED FILS", matches figure, edge cases) |
| `tests/amc/server-pricing.test.ts` | server ignores sent totals, refuses not-offered and switched-off services, schema rejects malformed rows, submit completeness |
| `tests/amc/workflow.test.ts` | valid/invalid transitions, owner and approver restrictions, self-approval switch, send stages, client answers once |
| `tests/amc/tokens.test.ts` | valid, invalid, expired, consumed, superseded, proposal link after approval/rejection and at contract stage, contract link after signature, revised proposal |
| `tests/amc/public-payload.test.ts` | approver emails excluded, disabled clauses excluded, only this proposal's services, closed links carry no customer data |
| `tests/amc/validation-and-numbers.test.ts` | malformed and oversized decisions, trimming, non-Latin names; proposal numbers 9998/9999/10000/10001 and the old collision; placeholder detection and hidden-content rules |
| `tests/email/send-email-policy.test.ts` | relay refused, company-mailbox case, malformed payloads, attachment rules, domain derivation, internal signature validity/expiry/purpose |

## 10. Test and build results (5 Oct 2026, worktree `amc-hardening`)

| Check | Result |
|---|---|
| `npm test` | **53 passed, 0 failed** |
| ESLint on every changed and added file | **0 problems** |
| TypeScript (`tsc --noEmit` over all AMC, email and new files) | **0 errors in changed code.** 2 pre-existing errors in the untouched `amc-pdf-utils.tsx` (html2canvas types do not declare `background`) |
| `next build --webpack` | **Succeeded** (exit 0; all routes compiled, including `/api/send-email`, `/api/amc-submissions/*`, `/api/amc/[token]` and `/amc/[token]`) |

Pre-existing issues recorded, not fixed: the two `amc-pdf-utils.tsx` type errors; the default Turbopack build is known to fail on this repo (webpack used, as before); the generated `next-env.d.ts` is git-ignored and was created locally in the worktree.

## 11. Production migrations NOT yet applied

`20261005100000_amc_close_direct_writes.sql`, `20261005110000_amc_proposal_number_beyond_9999.sql`, `20261005150000_restrict_shared_allow_all_policies.sql`. Apply only after the migration-history reconciliation (`docs/database-migration-reconciliation.md` step 6(e)), one at a time, with each file's verification query.

## 12. Remaining risks

1. **`public.settings` exposes the Zoho FSM OAuth token to the anon key** (outside AMC, critical). See `docs/security-followup-shared-rls.md` §0.
2. Until migration `20261005100000` is applied, D1/D2 remain open in production.
3. `estimate_revisions` and `estimate_service_items` remain open to anon (needed today by unauthenticated routes and edge functions); `/api/graphql` has no authentication.
4. The emailed PDF is browser-built; the server cannot prove it matches the approved data (follow-up: server-side generation).
5. Anonymous `/api/send-email` can still send arbitrary HTML to a company mailbox (follow-up: dedicated server-built notification for the quotation review page).
6. A full local `supabase db reset` cannot rebuild the schema (untracked `snagging_clients`, `snagging_jobs` rename), so migrations cannot yet be tested from scratch.
7. The submission details page renders documents with shipped default settings rather than the snapshot (pre-existing; not in scope).
8. No rate limiting on public endpoints (tokens are 256-bit, so brute force is not the concern; volume is).

## 13. Business decisions still required

1. **Self-approval policy:** can a proposal creator approve their own AMC proposal? (Switch: `AMC_SELF_APPROVAL_ALLOWED`.)
2. **Final document layout sign-off** (FR4.8, Sharon).
3. **OI-5 / clause 6.3 interpretation** (additional fixed-price services; FRD §12 missing).
4. **5% VAT confirmation.**
5. **Typed-name signature requirements**, and whether the recorded name and time print on the signed contract.
6. **PPM default frequency** (today 1 per year unless Settings gives one).
7. **Handyman default frequency** (today 1 hour per year unless Settings gives one).
8. **Client link validity** (today 30 days).
9. **Whether the early signed rows are test data** (AMC-2026-6886, 6890, 6891 were signed 23–52 seconds after sending).
10. **Whether AMC should link to `snagging_clients` / `snagging_properties`.**
11. **Whether AMC entitlement usage lives in the Portal or in Zoho FSM.**
12. **Whether property assessment belongs in the Portal.**

## 14. Manual / DevOps actions required

1. Review and merge branch `amc-hardening` (expect conflicts with the uncommitted AMC edits on `main`: `submissions-list.tsx`, `review-step.tsx`, `amc-approval-notice.tsx`, `amc-submissions-page.tsx`).
2. Approve and run the migration-history reconciliation (DevOps).
3. Apply the three pending migrations, one at a time, and verify.
4. Fix `public.settings` exposure and rotate the Zoho credentials (separate urgent change).
5. Confirm `NEXT_PUBLIC_APP_URL` in production is the real domain.
6. Run the manual testing guide (`docs/amc-proposals-v2-testing.md`) locally, then the production smoke test.
7. Optionally set `EMAIL_PUBLIC_RECIPIENT_DOMAINS` if quotation owners use a domain other than the sender's.

## 15. Recommended Active AMC architecture (from what was learned)

- **Contract record on signature.** A new `amc_contracts` row created by the server when a contract is signed (same transaction as the status change), with `submission_id` (unique), `client_id` → `snagging_clients`, `property_id` → `snagging_properties` (once tracked in migrations), `start_date`, `end_date`, `status` (`active`, `expired`, `renewed`, `cancelled`), and a frozen copy of the signed services. No browser write grants, as with `amc_submissions`.
- **Entitlements from the signed rows.** `amc_contract_entitlements(contract_id, service_id, frequency_type, allowance, unit)`, seeded from the snapshot of service rows at signature, never from live Settings.
- **Usage as a ledger.** `amc_entitlement_usage(contract_id, service_id, quantity, source, source_ref, occurred_at)`, append-only like `amc_audit_events`. Sources: FSM work orders / appointments (via `schedule_entries.fsm_work_order_id`), since FSM is the system of record for visits today.
- **Reuse:** client links (`lib/server/link-token.ts` and the lifecycle rule here), audit (`amc_audit_events` with a `contract` entity type), email (`lib/server/send-email.ts`), todos (`related_type = 'amc_contract'`) and the reminders cron for renewals, and the snagging server-side PDF pipeline for a stored signed-contract archive.
- **Pricing:** any additional-service quote reuses `lib/amc/pricing.ts`.
- **Before starting:** apply the hardening migrations, fix `public.settings`, reconcile migration history, and take decisions 9–12 above, which shape the data model.
