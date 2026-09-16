# AMC Proposals v2 — Implementation Plan

**Source:** `YFI AMC Proposals Extension FRD v2 - Draft` (11 Sep 2026, Sami Farah)
**Target:** `components/dashboard/extensions/amc/`
**Baseline:** commit `9dd4d5a`, branch `snagging`
**Written:** 15 Sep 2026

---

## 1. How I read the FRD

v2 is not a polish pass. It replaces the module's pricing model, adds a
four-party workflow (team → approver → client → signature), and moves standard
text out of code into an admin screen. Roughly 60% of the existing module
survives; the wizard shell, the service table mechanics, the persistence layer
and the PDF pagination engine all stay.

Three things in the FRD are load-bearing and shape everything below:

1. **§9 — "follow the same pattern as the snagging quotation."** This is an
   instruction to reuse, not to invent. Snagging already has hashed-at-rest
   approval tokens, a public no-login decision route, sequence-allocated
   document numbers, an append-only audit table and an in-process email
   helper. Every one of those is a requirement in this FRD. The plan below
   mirrors them rather than writing parallel versions.

2. **FR6.4 — "A proposal already sent keeps the text it was sent with."**
   Settings cannot be read live at render time. The standard text has to be
   snapshotted onto the submission at the moment it is sent, and the document
   rendered from the snapshot forever after. This is the single most
   consequential design decision in the document and it is easy to miss.

3. **FR5.3 — "Approval rights are given by role, so the approver can change
   without a code change."** Approval moves to `role_access`. Note that §4
   keeps the *access* allowlist explicitly out of scope — so the allowlist
   stays for "can you open the module", and the role governs "can you approve".
   Two different gates. Don't collapse them.

---

## 2. Current state, confirmed

From the audit of 15 Sep (`docs/amc-proposal-module-audit.html`), verified
against the live database:

| | |
|---|---|
| Services with a unit rate | **0 of 12** — all `unitRate: 0` behind a `TODO(pricing)` |
| Production submissions priced at zero | **10 of 10** |
| Submissions by status | 9 draft, 1 generated |
| `amc_submissions` RLS | `USING (true)` for `public` — anon key reads all rows |
| Proposal numbers | `AMC-{year}-{random 1000-9999}`, no uniqueness check |
| Delete path | none (GET/POST/PUT only) |
| Email delivery | none |

The FRD independently reaches the same conclusion on the RLS rule (§7:
*"an access rule that lets anyone read or change it directly … Replace that
rule"*), which is a useful confirmation that this is a known defect and not a
deliberate choice.

---

## 3. Target architecture

### 3.1 Data model — 3 tables

Consistent with the scheduling consolidation (dropdowns in `lookup_options`,
one audit table per module), this adds two tables and extends one. It does not
add a table per concept.

**`amc_submissions`** *(extend)*

| Change | Column | Why |
|---|---|---|
| drop use | `package` | FR2.6 — packages removed |
| add | `services` rows gain `basePrice` | FR2.4 |
| add | `optional_sections` JSONB | FR4.5 |
| add | `placeholders` JSONB | FR4.4 — account manager name/number, supply & install rows |
| replace | `status` CHECK → the 9 of §9.2 | FR5.8 |
| add | `settings_snapshot` JSONB | **FR6.4** |
| add | `proposal_token_hash`, `contract_token_hash`, `*_expires_at` | FR5.4–5.7, NFR4 |
| add | `client_decision`, `client_decided_at`, `signed_by_name`, `signed_at` | FR5.5, FR5.7 |
| add | `approver_id`, `sent_back_reason` | FR5.1–5.3 |
| change | `proposal_number` default → sequence | fixes the collision defect |

**`amc_settings`** *(new)* — one row, JSONB document. Holds clause text, the
per-service scope text (FR6.2 requires per-service scope to be editable), TPH
contact numbers and coordination emails (FR6.3). A single JSONB document rather
than a key/value table specifically so `settings_snapshot` is one clean copy.

**`amc_audit_events`** *(new)* — append-only, mirroring `snagging_audit_events`
including the rule that refuses UPDATE/DELETE. Satisfies FR5.9 and FR6.5.

### 3.2 Two gates, not one

```
open the AMC extension  →  email allowlist        (unchanged, §4 out of scope)
approve a submission    →  role_access: AMC/APPROVE  (new, FR5.3)
```

### 3.3 Status machine (§9.2)

```
draft ──submit──> awaiting_approval ──send back──> sent_back ──> (draft edit)
                          │
                       approve
                          ↓
                      approved ──send──> proposal_sent ──┬──> proposal_rejected
                                                          └──> proposal_approved
                                                                     │
                                                              build contract
                                                                     ↓
                                                            contract_sent ──sign──> signed
```

Locking (FR3.4): editable in `draft` and `sent_back` only.

---

## 4. Phased delivery

Ordered so that each phase leaves the module in a working state, and so the
two live defects are closed before any feature work lands on top of them.

### Phase 0 — Close the live defects *(no FRD requirement; prerequisites)*

| Step | Change |
|---|---|
| 0.1 | Replace the `USING (true)` policy with owner policies; revoke `anon` |

*Why first:* a live PII exposure, and schema-only — no application code
depends on it, so it can ship on its own without waiting for Phase 1.

*Moved:* proposal numbering was going to sit here too, but the column and the
code that writes it have to land together. On its own the migration would give
new rows a sequence number nobody reads while the wizard kept generating a
random one into the customer JSONB — two sources of truth, and a module that
looks fixed while the customer-facing number is still the unsafe one. It moves
to Phase 1, step 1.7.

### Phase 1 — Remove packages, add base price *(FR1.1–1.6, FR2.1–2.12)*

| Step | Change | Files |
|---|---|---|
| 1.1 | Delete `AMC_PACKAGES`, `unitRate`, package-derived frequency defaults | `amc-constants.ts` |
| 1.2 | `price = basePrice × units × frequency`; drop package branches | `amc-pricing.ts` |
| 1.3 | Schema + types: `basePrice` on rows, drop `packageId` / `customMonthlyPrice` | `amc-types.ts`, route, mapper |
| 1.4 | Step 2 → "Services and Pricing", opens on the table, Base Price column | `package-services-step.tsx` → `services-pricing-step.tsx` |
| 1.5 | Step 3 → "Review and Submit" | `review-step.tsx`, `index.tsx` |
| 1.6 | Validation: base price required, may be 0; units/frequency positive ints | `amc-types.ts` |
| 1.7 | `proposal_number` column + sequence + unique index, and the wizard reads it from the server instead of generating one | migration, route, `amc-constants.ts` |

*Acceptance covered:* three named steps · no package anywhere · price formula live · no zero price unless entered.

### Phase 2 — Documents built from the data *(FR4.1–4.7)*

| Step | Change |
|---|---|
| 2.1 | Render only checked services, with entered units/frequency/price |
| 2.2 | Strip package references from clause text (free handyman hours, non-emergency call-out) |
| 2.3 | Optional-section toggles in step 2; omit unchecked sections entirely |
| 2.4 | Supply & installation price list rows (category, description, brand, price) |
| 2.5 | Every `XXX` placeholder bound to a real value |

*Note:* this is content correctness only. The **layout** rework (FR4.8) is
Phase 6 and is blocked — see §5.

### Phase 3 — AMC Settings *(FR6.1–6.5)*

| Step | Change |
|---|---|
| 3.1 | `amc_settings` table + admin-only page |
| 3.2 | Clause text, per-service scope text, TPH numbers, coordination emails |
| 3.3 | **Snapshot into `settings_snapshot` on send; documents render from the snapshot** |
| 3.4 | Write settings changes to `amc_audit_events` |

### Phase 4 — Internal approval *(FR5.1–5.3, FR5.8–5.9, FR3.2, FR3.4)*

| Step | Change |
|---|---|
| 4.1 | Status column + transitions + `amc_audit_events` on every change |
| 4.2 | Submit for Approval from step 3; approve / send back with reason |
| 4.3 | `ResourceType.AMC` + `ActionType.APPROVE` in `role_access` |
| 4.4 | Approver queue view; owner list shows status |
| 4.5 | Lock editing outside `draft` / `sent_back` |

### Phase 5 — Client links and sending *(FR5.4–5.7, NFR4)*

| Step | Change |
|---|---|
| 5.1 | Token issue + hash-at-rest + expiry, reusing `hashReportToken` |
| 5.2 | `app/amc/[token]` public page — no login, `no-store`, `noindex` |
| 5.3 | Proposal approve/reject, recorded once with timestamp |
| 5.4 | Contract build on proposal approval; signature capture; `signed` |
| 5.5 | Send by email via `lib/server/send-email.ts`; copy-link for WhatsApp |

### Phase 6 — Document layout rework *(FR4.8)* — **BLOCKED**

Cannot start until the layout is agreed with Sharon (FR4.8 says so explicitly,
and points at OI-8, which is missing from the PDF — see §5).

---

## 5. Blockers and open questions

**B1 — §12 is missing from the PDF.** The document goes from §11
Non-Functional Requirements straight to §13 Acceptance Criteria. The Open
Issues register is not in the file, yet two requirements cite it: FR4.8 → OI-8,
and the "Additional fixed price services" row → OI-5. Please send §12, or
confirm it was cut from the draft.

**B2 — FR4.8 needs Sharon's sign-off before any layout work.** Phases 0–5 are
unaffected; they change what the documents *say*, not how they look.

**Q1 — Does VAT survive?** §6.3 defines the totals as Subtotal → Discount →
Final Price and stops there. The current documents also print 5% VAT, a grand
total and the amount in words. The acceptance criteria don't mention VAT
either. I will **keep** VAT unless told otherwise — removing a tax line from a
UAE contract on the strength of an omission would be the wrong default — but
this should be confirmed.

**Q2 — What happens to the 10 existing submissions?** All are priced at zero
and all carry a package. Nine are drafts; one is marked generated with both
PDFs produced. My default is to leave them in place with `basePrice` null so
they surface as needing attention rather than silently re-pricing. Archiving
them instead is a one-line change.

**Q3 — How is the signature captured (FR5.7)?** Typed full name, as snagging
records `approved_by_name`? Or a drawn signature image? The FRD says only
"signs … the signature and the time are recorded". Typed name is my default,
matching the existing precedent.

**Q4 — Does the team review the contract before sending it (FR5.6)?** "The
system builds the contract from the same data, and the team sends it the same
way" — I read that as build automatically, then a human sends. Confirming,
because auto-send would be a very different risk profile.

**Q5 — Token lifetime?** Snagging sets `approval_token_expires_at`. The FRD
requires unguessable (NFR4) but sets no window. Default: 30 days, renewable by
re-sending.

---

## 6. What I am starting on now

Phase 0, then Phase 1. Both are unblocked, and Phase 1 is what makes the
module produce a correct number for the first time.

I will report after each phase: what changed, which requirement IDs it closes,
what I verified, and anything I found that the FRD did not anticipate.

**Verification per phase:** `tsc --noEmit`, `eslint`, and
`next build --webpack` (the default Turbopack build is broken in this repo on
a node_modules mismatch).
