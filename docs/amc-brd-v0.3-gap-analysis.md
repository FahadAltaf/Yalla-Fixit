# AMC BRD v0.3 Gap Analysis

**Source of truth:** *AMC Generation and Tracking BRD*, Draft v0.3, 23 September 2026 (Sami Farah / Sharon Benedict Varghese).
**Audited:** branch `amc-hardening` at `926cb24`, 6 October 2026. Read-only audit of the repository (code, migrations, API, UI, tests). Nothing was implemented for this report.
**Status:** this file is the authoritative AMC implementation checklist. It supersedes the requirement matrix and percentages in `docs/amc-master-status-report.md` §4, which measured the older proposals FRD, not this BRD.

## How to read this

**Rule.** A requirement is IMPLEMENTED only when the end-to-end behaviour the BRD describes exists: data, server logic and, where a person does it, a screen. These do not count as implemented on their own:
- a table or column;
- a settings field;
- a placeholder;
- a manual workaround;
- part of the workflow.

**Production caveat.** Every AMC migration after `20261005100000` is **not applied to production**, including contracts, entitlements, customers, assessments, notifications and the signed archive. "IMPLEMENTED" below therefore means implemented on the branch, not live.

**Status values**

| Written as | Status |
|---|---|
| IMPLEMENTED | IMPLEMENTED |
| PARTIAL | PARTIALLY IMPLEMENTED: the row says what exists and what is missing |
| NOT IMPLEMENTED | NOT IMPLEMENTED |
| BIZ BLOCKED | BLOCKED BY BUSINESS DECISION. Used only when everything else is built and only the BRD's "to confirm" point is open. None qualify today: every "to confirm" point sits on top of machinery that is not built yet |
| EXT BLOCKED | BLOCKED BY EXTERNAL SYSTEM |
| FSM | OUT OF SCOPE / ALREADY PROVIDED BY FSM (Zoho FSM mobile app or FSM records; any AMC-specific FSM configuration still needed is noted) |

**Columns:**
- **Evidence:** where it is, or what was searched for.
- **Missing:** what is not there.
- **Blocker:** a business decision ("BRD: to confirm") or an external system.
- **Next:** the roadmap goal (§ Roadmap) that closes it.

**Path short forms:**
- `M/` = `supabase/migrations/`
- `X/` = `components/dashboard/extensions/`
- `api/` = `app/api/`

## Results

### Detailed requirements (542 audited)

| Status | Count |
|---|---|
| IMPLEMENTED | **78** |
| PARTIALLY IMPLEMENTED | **130** |
| NOT IMPLEMENTED | **315** |
| BLOCKED BY BUSINESS DECISION | **0** |
| BLOCKED BY EXTERNAL SYSTEM | **1** |
| OUT OF SCOPE / ALREADY PROVIDED BY FSM | **18** |

- **Strict detailed completion: 78 of 524 in-scope requirements = 14.9%.** The 18 FSM-provided items are excluded from the denominator. Counting all 542 gives 14.4%.
- **Counting rules:**
  - PARTIAL is not counted as done.
  - Where the BRD states the same requirement in two sections (for example self-approval in 5.5 and 6.7, or the WhatsApp proposal text in 5.6 and 6.3), it is audited, and counted, in each section, as the BRD lists it.

| Section | Total | Impl. | Partial | Not | Ext. blocked | FSM |
|---|---|---|---|---|---|---|
| 5.1 Enquiry and prospect | 20 | 0 | 0 | 20 | 0 | 0 |
| 5.2 Property, scope, site visit | 36 | 9 | 11 | 16 | 0 | 0 |
| 5.3 Rate card | 19 | 0 | 7 | 12 | 0 | 0 |
| 5.4 Proposal and revisions | 20 | 3 | 8 | 9 | 0 | 0 |
| 5.5 Approvals | 16 | 4 | 2 | 10 | 0 | 0 |
| 5.6 Sharing and decision | 12 | 4 | 5 | 3 | 0 | 0 |
| 5.7 Contract and signature | 46 | 18 | 13 | 15 | 0 | 0 |
| 5.8 Payments | 25 | 0 | 3 | 22 | 0 | 0 |
| 5.9 Client profile, access, documents | 27 | 4 | 8 | 15 | 0 | 0 |
| 5.10 PPM schedule | 23 | 1 | 2 | 20 | 0 | 0 |
| 5.11 Confirmation, board, assignment, access | 35 | 0 | 10 | 25 | 0 | 0 |
| 5.12 Job execution and closure | 34 | 0 | 7 | 14 | 0 | 13 |
| 5.13 Call outs | 26 | 1 | 8 | 12 | 1 | 4 |
| 5.14 Additional works and entitlements | 37 | 10 | 8 | 19 | 0 | 0 |
| 5.15 Reports and dashboard | 41 | 4 | 7 | 30 | 0 | 0 |
| 5.16 Renewal, amendments, termination | 24 | 6 | 8 | 10 | 0 | 0 |
| 6.1 Emails (1, 2, 3, installment) | 37 | 10 | 8 | 19 | 0 | 0 |
| 6.2 Notifications | 28 | 2 | 4 | 22 | 0 | 0 |
| 6.3 WhatsApp / SMS | 9 | 0 | 3 | 6 | 0 | 0 |
| 6.7 Roles | 12 | 2 | 3 | 6 | 0 | 1 |
| 6.8 To-dos | 8 | 0 | 2 | 6 | 0 | 0 |
| 6.9 Metrics | 7 | 0 | 3 | 4 | 0 | 0 |
| **Total** | **542** | **78** | **130** | **315** | **1** | **18** |

### BRD 6.10 deliverables (14 groups)

| # | Deliverable (BRD 6.10) | Status |
|---|---|---|
| 1 | Enquiry pipeline, property, asset register, combined units, scope and site visit (5.1, 5.2) | PARTIAL |
| 2 | Governed rate card with floor rates, history and packages (5.3) | NOT STARTED |
| 3 | Wizard linked to the prospect, versions, team visibility (5.4) | PARTIAL |
| 4 | Configurable approval ladder; approval link by email or WhatsApp, decision recorded (5.5, 5.6) | PARTIAL |
| 5 | Contract with commencement date and entitlements, signing routes, statuses; client profile with access rules, consent and documents (5.7, 5.9) | PARTIAL |
| 6 | Payment bands, schedule, cheques, initial payment gate, Zoho Finance view (5.8) | NOT STARTED |
| 7 | PPM schedule per service line with service windows and clubbing, adherence kept (5.10) | NOT STARTED |
| 8 | Confirmation to-do with configurable attempts, scheduling board, competency-based assignment, access status (5.11) | NOT STARTED |
| 9 | Offline FSM job with AMC checklist, supervisor closure, non-completion groups, partial completion per trade (5.12) | NOT STARTED |
| 10 | Reactive call outs with priority, SLA, coverage check and statuses (5.13) | PARTIAL |
| 11 | Additional work parties and findings, entitlement check, allowance reserve and consume with audit trail (5.14) | PARTIAL |
| 12 | Client report, operational, commercial and profitability reports, dashboard (5.15) | PARTIAL |
| 13 | Renewal reminder, draft with history, outcomes, edge cases with approval (5.16) | PARTIAL |
| 14 | Emails, notifications, messages, to-dos and roles (6.1, 6.2, 6.3, 6.7, 6.8) | PARTIAL |

**Complete: 0 of 14 (0%).** Partial: 9. Not started: 5. Blocked: 0. Details per group are in §6.10 below.

---

## 5.1 Enquiry and prospect

There is no enquiry, lead or prospect entity. Searching migrations, `lib`, `app`, `modules` and `components` for enquir/inquir/lead/prospect/follow finds only Snagging quotation code. The AMC flow starts at the proposal wizard or at an assessment.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.1-01 | Enquiry date | NOT IMPLEMENTED | none | Enquiry record | —  | G2 |
| 5.1-02 | Source (SEO, website, referral, walk in, repeat client, campaign) | NOT IMPLEMENTED | none | Field and list | —  | G2 |
| 5.1-03 | Contacts | NOT IMPLEMENTED | Contacts exist only on `customers` (M/20261006130000:35-51) and on the proposal (X/amc/amc-types.ts:11-30) | Enquiry contacts | —  | G2 |
| 5.1-04 | Preferred channel | NOT IMPLEMENTED | none | Field | —  | G2 |
| 5.1-05 | Preferred language | NOT IMPLEMENTED | none | Field | —  | G2 |
| 5.1-06 | Area | NOT IMPLEMENTED | `customer_properties.community` only | Field on enquiry | —  | G2 |
| 5.1-07 | Property category | NOT IMPLEMENTED | Only on property and proposal | Field on enquiry | —  | G2 |
| 5.1-08 | Need in short | NOT IMPLEMENTED | none | Field | —  | G2 |
| 5.1-09 | Owner | NOT IMPLEMENTED | Only `amc_submissions.owner_id` (proposal owner) | Enquiry owner | —  | G2 |
| 5.1-10 | Status | NOT IMPLEMENTED | none | Status | —  | G2 |
| 5.1-11 | Next follow-up date | NOT IMPLEMENTED | none | Field | —  | G2 |
| 5.1-12 | The 12 stages (New Enquiry … On Hold) | NOT IMPLEMENTED | The proposal workflow starts at draft (lib/amc/workflow.ts:5-13) | Pre-proposal stages; Won/Lost/On Hold | —  | G2 |
| 5.1-13 | Configurable stages | NOT IMPLEMENTED | none | Stage configuration | —  | G2 |
| 5.1-14 | Configurable owners | NOT IMPLEMENTED | none | Owner rules | —  | G2 |
| 5.1-15 | Configurable follow-up rules | NOT IMPLEMENTED | none | Rules | —  | G2 |
| 5.1-16 | Follow-up log (date, channel, person, outcome, next date) | NOT IMPLEMENTED | none | Log | —  | G2 |
| 5.1-17 | Idle enquiry detection | NOT IMPLEMENTED | Reminders exist only for contract expiry (M/20261006150000:87-93) | Idle rule and job | —  | G2 |
| 5.1-18 | Owner alert | NOT IMPLEMENTED | No enquiry event in `amc_notifications` (M/20261006150000:35-40) | Notification | —  | G2 |
| 5.1-19 | Management escalation | NOT IMPLEMENTED | none | Escalation | —  | G2 |
| 5.1-20 | Lost needs a reason | NOT IMPLEMENTED | Only the client's rejection reason on a sent proposal | Lost stage and reason list | —  | G2 |

## 5.2 Property, scope and site visit

**Property**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-01 | Category | IMPLEMENTED | `customer_properties.property_category` (M/20261006130000:67); X/amc-contracts/customer-pickers.tsx:181; wizard X/amc/steps/property-customer-step.tsx:99 | — | — | — |
| 5.2-02 | Type: villa, apartment, townhouse, restaurant, clinic, shop, office | PARTIAL | `unit_type` villa/apartment/townhouse/office/other (M/…130000:68); the wizard allows villa/apartment/office only (X/amc/amc-types.ts:7) | restaurant, clinic, shop; wizard and property lists differ | — | G1 |
| 5.2-03 | Address down to the unit | PARTIAL | Free-text label, address, community (M/…130000:64-66) | Structured building/floor/unit | — | G1 |
| 5.2-04 | Size | IMPLEMENTED | `size_sqft`, `bedrooms` (M/…130000:69-70); customer-pickers.tsx:194-204 | — | — | — |
| 5.2-05 | Floors or zones | NOT IMPLEMENTED | Only Snagging has `floors` | Field | — | G1 |
| 5.2-06 | Owner or tenant | PARTIAL | Proposal contact designation owner/tenant/representative (amc-types.ts:9) | Not on the property | — | G1 |
| 5.2-07 | Access constraints | NOT IMPLEMENTED | Generic `notes` only | Field (see 5.9 access rules) | — | G1 |

**Asset register**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-08 | AC units by type and count | PARTIAL | Per-proposal `units` on the AC row (X/amc/components/service-table.tsx:102-119) | Breakdown by type; held on the property | — | G1 |
| 5.2-09 | Other assets | NOT IMPLEMENTED | No asset table | Asset register | — | G1 |
| 5.2-10 | Asset type | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-11 | Location | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-12 | Make | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-13 | Model | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-14 | Serial number | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-15 | Condition | NOT IMPLEMENTED | Condition only per checklist category on an assessment | Per asset | — | G1 |
| 5.2-16 | Service history per asset | NOT IMPLEMENTED | Usage history per contract only (`amc_entitlement_usage`) | Per asset | FSM Assets (if used) | G1/G5 |

**Scope**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-17 | Trade (AC, plumbing, electrical, handyman, civil) | PARTIAL | Catalogue ids ac-ppm, electrical-ppm, plumbing-ppm, handyman (X/amc/amc-constants.ts:33-141) | No trade field; no civil | — | G1 |
| 5.2-18 | Frequency per item | IMPLEMENTED | `frequencyPerYear` default (X/amc/amc-settings.ts:156); per row (service-table.tsx:133-151) | — | — | — |
| 5.2-19 | Duration | IMPLEMENTED | Wizard start/end dates (amc-types.ts:130-131); termMonths (lib/amc/pricing.ts:134) | — | — | — |
| 5.2-20 | Preferred months or days | NOT IMPLEMENTED | none | Field (feeds 5.10 target dates) | — | G1/G4 |
| 5.2-21 | Exclusions | PARTIAL | Global `servicesExcluded` clause (amc-settings.ts:238) | Per property and proposal | — | G1 |
| 5.2-22 | Photos | PARTIAL | Assessment photos only (M/…150000:169-180) | Property or scope photos | — | G1 |

**Combined units**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-23 | Parent and child properties | NOT IMPLEMENTED | No parent column | Relation | — | G1 |
| 5.2-24 | Each keeps its ownership | PARTIAL | `customer_properties.customer_id` per property | No combined-unit concept | — | G1 |
| 5.2-25 | Each keeps its billing | NOT IMPLEMENTED | none | Billing party | — | G1/G3 |
| 5.2-26 | Each keeps its history | PARTIAL | Each property shows its own contracts and assessments (X/amc-contracts/customer-property-views.tsx:395-401) | Parent link | — | G1 |

**Commercial site visit** (`amc_assessments`, M/20261006130000; photos M/20261006150000)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.2-27 | Date | IMPLEMENTED | `assessed_on`; X/amc-contracts/assessments.tsx:437-443; required to complete | — | — | — |
| 5.2-28 | Assessor | IMPLEMENTED | `assessor_id` / `assessor_name`; assessments.tsx:444 | — | — | — |
| 5.2-29 | Asset count checked on site | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-30 | Condition notes | IMPLEMENTED | Checklist result and notes per item; assessments.tsx:470-557 | — | — | — |
| 5.2-31 | Photos | IMPLEMENTED | `amc_assessment_photos`; api/amc-contracts/assessments/[assessmentId]/photos; assessment-photos.tsx | Stale text at assessments.tsx:467 says photos are not stored | — | G1 (text fix) |
| 5.2-32 | Access notes | PARTIAL | Generic notes | Dedicated field | — | G1 |
| 5.2-33 | Recommended scope | IMPLEMENTED | `recommended_service_ids`; assessments.tsx:528-553 | — | — | — |
| 5.2-34 | Exclusions | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.2-35 | Proposal draws its lines from the visit | PARTIAL | lib/server/amc/business.ts:942-1022; lib/amc/business.ts:149-203 tick the recommended services | Lines are unpriced (`units: 1`, `basePrice: null`); asset counts unused | Rate card (5.3) | G1/G2 |
| 5.2-36 | Wizard blocks or flags when a required visit is missing | NOT IMPLEMENTED | Proposal code never references assessments | Rule | BRD: block vs flag to confirm | G2 |

## 5.3 Rate card

There is no AMC rate card. AMC Settings holds a service catalogue without prices. The base price is typed into every proposal. (Snagging's rate card is separate.)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.3-01 | Governed service list | PARTIAL | Admin-edited catalogue in `amc_settings` (X/amc/amc-settings.ts:142-180) | Prices, units, floors | —  | G2 |
| 5.3-02 | Unit | NOT IMPLEMENTED | `hasUnits` derived only (amc-types.ts:291) | Unit of measure | —  | G2 |
| 5.3-03 | Standard rate | NOT IMPLEMENTED | amc-types.ts:267-268: "price comes from the base price entered per proposal" | Rate | —  | G2 |
| 5.3-04 | Floor rate | NOT IMPLEMENTED | none | Rate | —  | G2 |
| 5.3-05 | Allowed frequencies | PARTIAL | frequencyType + one default (amc-settings.ts:154-156) | Wizard accepts 1–1000 (lib/amc/pricing.ts:206) | —  | G2 |
| 5.3-06 | Residential / commercial model | PARTIAL | `unitTypes` limits where a service is offered (lib/server/amc/pricing.ts:58-71) | Separate pricing per model | —  | G2 |
| 5.3-07 | Only department head and Finance edit | PARTIAL | AMC Settings PUT admin-only (api/amc-settings/route.ts:28-42) | Department-head / Finance permission; nothing priced to protect | —  | G2 |
| 5.3-08 | Price-change history | NOT IMPLEMENTED | none | History table | —  | G2 |
| 5.3-09 | Changed by | PARTIAL | Settings audit records the actor (route.ts:159-165) | Per price | —  | G2 |
| 5.3-10 | Changed at | PARTIAL | `amc_audit_events.created_at` | Per price | —  | G2 |
| 5.3-11 | Old value | NOT IMPLEMENTED | Audit stores key paths only (lib/server/amc/audit.ts:53-59) | Value | —  | G2 |
| 5.3-12 | New value | NOT IMPLEMENTED | Same | Value | —  | G2 |
| 5.3-13 | Effective-from date | NOT IMPLEMENTED | none | Field | —  | G2 |
| 5.3-14 | An old proposal keeps the rate of its day | PARTIAL | Prices stored on the proposal rows; settings wording snapshot at send | Holds only because prices are typed; no rate version | —  | G2 |
| 5.3-15 | Brochure packages (Essential, Advantage, Premium, Complete, Build your own) | NOT IMPLEMENTED | Brochure copy only (X/amc/amc-brochure-copy.ts:93-105) | Preset service sets | —  | G2 |
| 5.3-16 | Promotions with start and end dates | NOT IMPLEMENTED | none | Promotions | —  | G2 |
| 5.3-17 | Users cannot change the rate | NOT IMPLEMENTED | Base price is a free input (service-table.tsx:214-231); server accepts 0–10M (lib/amc/pricing.ts:207) | Rate locked from the card | —  | G2 |
| 5.3-18 | Discount within authority | NOT IMPLEMENTED | Any user enters 0–100% (lib/amc/pricing.ts:226) | Authority limits | Thresholds (BRD: not decided) | G2 |
| 5.3-19 | Below floor triggers approval | NOT IMPLEMENTED | Every proposal goes to approval (workflow.ts:54-89) | Trigger | — | G2 |

## 5.4 Proposal and revisions

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.4-01 | Proposal created from the prospect | PARTIAL | From a completed assessment (api/amc-contracts/assessments/[assessmentId]/proposal) or a blank wizard | Enquiry/prospect origin | — | G2 |
| 5.4-02 | Customer prefilled | PARTIAL | Assessment path only (lib/amc/business.ts:185-199) | Wizard customer lookup; contacts | — | G2 |
| 5.4-03 | Property prefilled | IMPLEMENTED | lib/amc/business.ts:158-184 (assessment path) | Wizard pick-from-property | — | — |
| 5.4-04 | Commercial lines from the site visit | PARTIAL | Recommended services ticked | Unpriced, units 1 | Rate card | G2 |
| 5.4-05 | Unique number | IMPLEMENTED | Sequence + unique index (M/20260916105000; lib/amc/proposal-number.ts) | — | — | — |
| 5.4-06 | Date | PARTIAL | Printed as document date (X/amc/amc-pricing.ts:173-176) | Stored proposal date | — | G2 |
| 5.4-07 | Validity period | NOT IMPLEMENTED | One global text setting `proposalValidity`, printed nowhere | Validity date per proposal | BRD: period to confirm | G2 |
| 5.4-08 | Payment terms | IMPLEMENTED | monthly/quarterly/annual (amc-types.ts:8); printed (amc-document-model.ts:267) | — | — | — |
| 5.4-09 | Payment plan | NOT IMPLEMENTED | Terms label only | Structured plan | 5.8 bands | G2/G3 |
| 5.4-10 | Visible to the team by role | PARTIAL | Owner + approvers (api/amc-submissions/route.ts:253,343) | Coordinator/team visibility | — | G2 |
| 5.4-11 | Edit after sharing creates V2, V3 | NOT IMPLEMENTED | PUT overwrites the row (route.ts:654-668); no version table | Versions | — | G2 |
| 5.4-12 | Old versions locked | NOT IMPLEMENTED | No versions | — | — | G2 |
| 5.4-13 | Old PDF kept | NOT IMPLEMENTED | Proposal PDF built in the browser, never stored; snapshot reset on resubmit (approval/route.ts:145-154) | Stored PDF per version | — | G2 |
| 5.4-14 | Revision date | PARTIAL | Audit event `resubmitted_after_client_changes` | Per version | — | G2 |
| 5.4-15 | Revision user | PARTIAL | Audit actor | Per version | — | G2 |
| 5.4-16 | Revision reason (scope, discount, price, frequency, duration, plan, other) | NOT IMPLEMENTED | none | Reason list | — | G2 |
| 5.4-17 | Revision summary | NOT IMPLEMENTED | none | Field | — | G2 |
| 5.4-18 | Final price per version | NOT IMPLEMENTED | `final_price` overwritten | Per version | — | G2 |
| 5.4-19 | Active version marked | NOT IMPLEMENTED | none | Marker | — | G2 |
| 5.4-20 | Revision crossing a threshold returns for approval | PARTIAL | Every resubmission is re-approved (workflow.ts:54,89) | Threshold-based; only after client rejection | Thresholds | G2 |

## 5.5 Approval of discounts, values and payment plans

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.5-01 | Trigger: discount percent | NOT IMPLEMENTED | No trigger checks (approval/route.ts:113-176) | Trigger | Thresholds not decided | G2 |
| 5.5-02 | Trigger: final value | NOT IMPLEMENTED | none | Trigger | Same | G2 |
| 5.5-03 | Trigger: non-standard payment plan | NOT IMPLEMENTED | No plan exists | Trigger | 5.8 bands | G2 |
| 5.5-04 | Trigger: below floor rate | NOT IMPLEMENTED | No floor rate | Trigger | — | G2 |
| 5.5-05 | Configurable thresholds | NOT IMPLEMENTED | none | Settings | — | G2 |
| 5.5-06 | Configurable approval levels | PARTIAL | One flat approver list (amc-settings.ts:290-292, 651-659) | Levels per trigger | — | G2 |
| 5.5-07 | Level 1, then higher levels in sequence | NOT IMPLEMENTED | Single step (workflow.ts:106-109) | Sequential routing | — | G2 |
| 5.5-08 | Approve | IMPLEMENTED | approval/route.ts:161-168 | — | — | — |
| 5.5-09 | Reject | NOT IMPLEMENTED | Actions are submit, approve, send_back only (approval/route.ts:39-52) | Internal reject | — | G2 |
| 5.5-10 | Return with comments | IMPLEMENTED | `send_back` with required reason | — | — | — |
| 5.5-11 | Logged with user and time | IMPLEMENTED | `decided_by`/`decided_at`; append-only `amc_audit_events` | — | — | — |
| 5.5-12 | A pending proposal cannot be shared | IMPLEMENTED | workflow.ts:117-120; send/route.ts:232-242 | — | — | — |
| 5.5-13 | Open approval escalates after a set time | NOT IMPLEMENTED | none | Escalation job | — | G2 |
| 5.5-14 | Raised discount or changed plan re-triggers | PARTIAL | Every resubmission re-approved | Trigger-based | — | G2 |
| 5.5-15 | Nobody approves their own proposal | NOT IMPLEMENTED | `AMC_SELF_APPROVAL_ALLOWED = true` (lib/amc/workflow.ts:34), pinned by tests/amc/workflow.test.ts:48-55. The enforcement path exists and the bell hides your own | Set to false; update the test. **The BRD has decided this; it is no longer an open decision** | — | G2 (first item) |
| 5.5-16 | No trigger: share directly | NOT IMPLEMENTED | Sending requires `approved` (send/route.ts:232) | Direct share | — | G2 |

## 5.6 Sharing and the prospect decision

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.6-01 | Approval link per proposal version | PARTIAL | Hashed token per send (send/route.ts:338-350) | Per version | — | G2 |
| 5.6-02 | Email sharing | IMPLEMENTED | send/route.ts:425-476 (content gaps under Email 1) | — | — | — |
| 5.6-03 | WhatsApp: portal prepares the text with the link | PARTIAL | Bare link to copy (amc-link-dialog.tsx:64-87) | Prepared text, wa.me link | — | G2 |
| 5.6-04 | WhatsApp default for residential, email for commercial | NOT IMPLEMENTED | none | Default by category | — | G2 |
| 5.6-05 | More than one contact | NOT IMPLEMENTED | One `to` (send/route.ts:57; amc-send-dialog.tsx) | Multiple recipients | — | G2 |
| 5.6-06 | Send log: channel, recipient, version, user, time | PARTIAL | Audit `proposal_sent` with deliver, to, actor, time | Version; recipient on link sends | — | G2 |
| 5.6-07 | Prospect approves | IMPLEMENTED | api/amc/[token]/route.ts:257-263 | — | — | — |
| 5.6-08 | Prospect rejects with a reason | IMPLEMENTED | [token]/route.ts:264-270 | — | — | — |
| 5.6-09 | Prospect requests a revision | PARTIAL | Reject is shown as "Changes requested" (app/amc/[token]/public-amc-document.tsx:199-205) | Separate action | — | G2 |
| 5.6-10 | Decision kept with version, date and time | PARTIAL | `client_decided_at`, name, audit | Version | — | G2 |
| 5.6-11 | Manual decision with evidence | NOT IMPLEMENTED | Only the token route sets client decisions | Staff route and evidence upload | — | G2 |
| 5.6-12 | Approved proposal locked | IMPLEMENTED | amc-types.ts:370; route.ts:590-597 (DB lock needs migration 20261005100000) | — | — | — |

## 5.7 Contract and signature

**Contract document**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-01 | Approval auto-creates the contract | PARTIAL | The document is built from proposal data with no retyping (X/amc/amc-document-model.ts). Issuing it is a manual "send contract" (api/amc-submissions/send/route.ts:230-242). The `amc_contracts` row is made by a manual Activate after signing (lib/server/amc/contracts.ts:334-460) | Automatic creation on client approval; a Draft contract | — | G2 |
| 5.7-02 | Residential and commercial templates | NOT IMPLEMENTED | One clause set (amc-settings.ts:375-396) | Template per model | — | G2 |
| 5.7-03 | Customer and property | IMPLEMENTED | amc-document-model.ts:220-241 | — | — | — |
| 5.7-04 | Scope text per service | IMPLEMENTED | amc-document-model.ts:515-517 | — | — | — |
| 5.7-05 | Frequency table | IMPLEMENTED | amc-document-model.ts:561 | — | — | — |
| 5.7-06 | Value | IMPLEMENTED | amc-document-model.ts:257-266, 695-705 | — | — | — |
| 5.7-07 | VAT | IMPLEMENTED | amc-document-model.ts:262-263 | — | — | — |
| 5.7-08 | Term of one year or more | PARTIAL | Period printed; default 12 months (lib/amc/contracts.ts:113) | No one-year minimum (contracts.ts:166-178) | — | G2 |
| 5.7-09 | Entitlements in the contract | PARTIAL | Services and frequencies printed | Entitlement schedule (labour, material, call-outs, limits) | — | G2 |
| 5.7-10 | Payment terms | IMPLEMENTED | "Terms of Payment" (amc-document-model.ts:267) | — | — | — |
| 5.7-11 | Payment plan | PARTIAL | Terms label only | Instalments, first amount, due dates | 5.8 | G3 |
| 5.7-12 | Terms and conditions | IMPLEMENTED | amc-document-model.ts:647-678 | — | — | — |
| 5.7-13 | Bank details | IMPLEMENTED | amc-document-model.ts:679-694 | — | — | — |

**Entitlements per contract** (`amc_contract_entitlements`, M/20261006100000:117-160)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-14 | Visit frequency per service | IMPLEMENTED | `frequency`, `included_quantity`, `entitlement_type`; usage ledger | — | — | — |
| 5.7-15 | Asset quantities | PARTIAL | `units` stored, ignored for the allowance (lib/amc/contracts.ts:96-110) | Quantities drive entitlements | Allowance scaling rule (open since Oct) | G2 |
| 5.7-16 | Labour coverage | NOT IMPLEMENTED | Clause text only | Field | — | G2 |
| 5.7-17 | Material coverage | NOT IMPLEMENTED | Clause text only | Field | — | G2 |
| 5.7-18 | Call-out allowances | IMPLEMENTED | `call_out_class`; emergency unlimited, non-emergency counted (lib/amc/contracts.ts:91) | — | — | — |
| 5.7-19 | Value limits | NOT IMPLEMENTED | none | Monetary cap | — | G2 |
| 5.7-20 | Exclusions | PARTIAL | Global clause text | Per contract | — | G2 |
| 5.7-21 | Covered/chargeable check uses the entitlements | PARTIAL | checkCoverage, coverageVerdict (lib/amc/contracts.ts:540-640, 844-881); api/amc-contracts/coverage | Uses type and quantity only | — | G5 |

**Identity and versions**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-22 | Unique contract number | PARTIAL | Contract reuses the proposal number; no `contract_number` anywhere | Own number | — | G2 |
| 5.7-23 | Linked to the enquiry | NOT IMPLEMENTED | No enquiry | Link | 5.1 | G2 |
| 5.7-24 | Linked to every proposal version | NOT IMPLEMENTED | No versions | Link | 5.4 | G2 |
| 5.7-25 | Amendments after signing versioned with a reason | NOT IMPLEMENTED | Only cancel and renew | Amendments | — | G2 |

**Signature**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-26 | Zoho Sign or internal signing tool | PARTIAL | Internal typed-name signing by link (api/amc/[token]/route.ts:250-256); immutable signed archive with hash (lib/server/amc/signed-archive.ts) | Zoho Sign; internal signers | Zoho Sign choice | G2 |
| 5.7-27 | Signed scan uploaded with its date | NOT IMPLEMENTED | Archive takes the system document only | Upload | — | G2 |
| 5.7-28 | Client signatory tracked | IMPLEMENTED | `signed_by_name`, `signed_at`, audit | — | — | — |
| 5.7-29 | Each internal signatory tracked separately | NOT IMPLEMENTED | Blank company lines only (amc-document-model.ts:712-718) | Signatories | — | G2 |
| 5.7-30 | Configurable signing order | NOT IMPLEMENTED | none | Order | — | G2 |
| 5.7-31 | Reminder after N unsigned days | NOT IMPLEMENTED | Reminders cover expiry only; resend is manual | Reminder | — | G2 |
| 5.7-32 | Signing date | IMPLEMENTED | `signed_at` | — | — | — |
| 5.7-33 | Commencement date separate from signing | IMPLEMENTED | `start_date` set at activation (activate-contract-dialog.tsx:44-63) | — | — | — |
| 5.7-34 | Commencement and term set the expiry | PARTIAL | End date prefilled start + 12 months, editable (lib/amc/contracts.ts:160, 380) | Term-driven; feeds no PPM schedule | — | G2/G4 |
| 5.7-35 | Signed contract linked to FSM for Finance | PARTIAL | Manual FSM contact link (lib/server/amc/fsm-integration.ts:113-155) | Contract pushed to FSM | Zoho FSM/Finance | G2 |

**Statuses.** Proposals: draft … signed (M/20260916100000:48-59). Contracts: stored active/cancelled; derived pending_activation, not_started, active, expiring, expired, cancelled (lib/amc/contracts.ts:7-35).

| ID | BRD status | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.7-36 | Draft | PARTIAL | Proposal draft only | Draft contract | — | G2 |
| 5.7-37 | Pending Client Signature | IMPLEMENTED | `contract_sent` | — | — | — |
| 5.7-38 | Pending Internal Signature | NOT IMPLEMENTED | — | Status | — | G2 |
| 5.7-39 | Signed | IMPLEMENTED | `signed` / pending_activation | — | — | — |
| 5.7-40 | Pending Initial Payment | NOT IMPLEMENTED | — | Status and gate | — | G3 |
| 5.7-41 | Active | IMPLEMENTED | `active` (manual activation) | — | — | — |
| 5.7-42 | On Hold | NOT IMPLEMENTED | — | Status | — | G6 |
| 5.7-43 | Expired | IMPLEMENTED | Derived from end date | — | — | — |
| 5.7-44 | Renewed | PARTIAL | `renewed_from_contract_id` chain | Status value | — | G6 |
| 5.7-45 | Cancelled | IMPLEMENTED | Reason, user, date (M/20261006100000:89-96) | — | — | — |
| 5.7-46 | Terminated | NOT IMPLEMENTED | Not distinguished from cancelled | Status | — | G6 |

## 5.8 Payment plan and collection

**There is no payments module.** Searching installment, instalment, cheque, paytabs, nomupay, ageing, invoice and payment_plan finds only contract wording and the `paymentTerms` label. There is no Zoho Finance client.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.8-01 | Plan proposed from value bands (below AED 4,000 single) | NOT IMPLEMENTED | none | Bands | BRD: bands to confirm | G3 |
| 5.8-02 | Single payment | PARTIAL | "annual" label | Schedule | — | G3 |
| 5.8-03 | 50/50 | NOT IMPLEMENTED | none | Plan | — | G3 |
| 5.8-04 | Quarterly | PARTIAL | Label | Schedule | — | G3 |
| 5.8-05 | Monthly | PARTIAL | Label | Schedule | — | G3 |
| 5.8-06 | Another permitted plan | NOT IMPLEMENTED | none | Custom plan | — | G3 |
| 5.8-07 | Plan outside the rule needs approval | NOT IMPLEMENTED | none | Trigger | — | G2/G3 |
| 5.8-08 | Schedule created on activation (number, due date, amount, VAT, mode, received date/amount/reference) | NOT IMPLEMENTED | Activation creates contract and entitlements only (M/20261006140000) | Instalments | — | G3 |
| 5.8-09 | Statuses Not Due … Waived | NOT IMPLEMENTED | none | Statuses | — | G3 |
| 5.8-10 | Cash: receipt, collector, handover | NOT IMPLEMENTED | none | Mode | — | G3 |
| 5.8-11 | Bank transfer: reference, value date, proof | NOT IMPLEMENTED | none | Mode | — | G3 |
| 5.8-12 | PayTabs / NomuPay link per instalment, status returned | NOT IMPLEMENTED | none | Integration | PayTabs/NomuPay accounts and API | G3 |
| 5.8-13 | Cheque: number, bank, date, amount, custody, deposit, clearance, bounce reason and charges, replacement | NOT IMPLEMENTED | none | Cheque register | — | G3 |
| 5.8-14 | Alert before a cheque date | NOT IMPLEMENTED | none | Alert | — | G3 |
| 5.8-15 | Alert on a bounce | NOT IMPLEMENTED | none | Alert | — | G3 |
| 5.8-16 | Initial payment gate: no visit until the first instalment | NOT IMPLEMENTED | Activation needs only a signed proposal (lib/amc/contracts.ts:277-305) | Gate | — | G3 |
| 5.8-17 | Authorised override keeps user and reason | NOT IMPLEMENTED | none | Override | — | G3 |
| 5.8-18 | Late first payment alert | NOT IMPLEMENTED | none | Alert | — | G3 |
| 5.8-19 | Zoho Finance invoices shown in the portal | NOT IMPLEMENTED | none | Integration | Finance: trigger and direction | G3 |
| 5.8-20 | Receipts | NOT IMPLEMENTED | none | Integration | Same | G3 |
| 5.8-21 | Outstanding balance | NOT IMPLEMENTED | none | Calculation | — | G3 |
| 5.8-22 | Ageing | NOT IMPLEMENTED | none | Report | — | G3 |
| 5.8-23 | Resend to the client | NOT IMPLEMENTED | none | Action | Finance integration | G3 |
| 5.8-24 | Overdue instalment creates a to-do | NOT IMPLEMENTED | `todos.related_type 'amc_contract'` used for renewals only | To-do | — | G3 |
| 5.8-25 | Client reminder | NOT IMPLEMENTED | none | Message | WhatsApp/SMS provider | G3 |

## 5.9 Client profile, access rules and documents

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.9-01 | Individual or company | PARTIAL | Free-text `customers.company` (M/20261006130000:40) | Type flag | — | G1 |
| 5.9-02 | Trade licence | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.9-03 | TRN | NOT IMPLEMENTED | none | Field | — | G1 |
| 5.9-04 | Contacts: primary, alternate, accounts, tenant | PARTIAL | One email/phone on customers; proposal contacts owner/tenant/representative | Contact roles on the profile | — | G1 |
| 5.9-05 | Properties | IMPLEMENTED | `customer_properties`; customer-property-views.tsx:235-262 | — | — | — |
| 5.9-06 | Services | IMPLEMENTED | Via contract entitlements (customer-property-views.tsx:345-393) | — | — | — |
| 5.9-07 | Schedule | NOT IMPLEMENTED | No visits | Schedule view | 5.10 | G4 |
| 5.9-08 | Contracts | IMPLEMENTED | customer-property-views.tsx:230, 395 | — | — | — |
| 5.9-09 | Payments and cheques | NOT IMPLEMENTED | No payments | View | 5.8 | G3 |
| 5.9-10 | Service history | PARTIAL | Per-contract usage ledger and FSM links | Consolidated visit history | — | G4/G5 |
| 5.9-11 | Allowances | IMPLEMENTED | Property "Current AMC" table (customer-property-views.tsx:369-385) | — | — | — |
| 5.9-12 | Documents | PARTIAL | See 5.9-25/26 | — | — | G1 |
| 5.9-13 | Communication log | NOT IMPLEMENTED | Notifications are internal only | Log | — | G1 |
| 5.9-14 | Marketing consent separate | NOT IMPLEMENTED | none | Field and history | — | G1 |
| 5.9-15 | Prospect becomes client on signing and first payment | NOT IMPLEMENTED | Customers created by hand (lib/server/amc/business.ts:158-177) | Lifecycle | 5.1, 5.8 | G1/G3 |
| 5.9-16 | FSM customer linked behind the profile | PARTIAL | `customers.fsm_contact_id` exists but is never written; the contract-level link exists | Profile-level link | — | G1 |
| 5.9-17 | Access type: community gate pass | NOT IMPLEMENTED | Only Snagging's per-job gate pass | Access rule | — | G1 |
| 5.9-18 | Building permit | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-19 | Security clearance | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-20 | Lift booking | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-21 | Key collection | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-22 | Lead time | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-23 | Permitted hours | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-24 | Parking | NOT IMPLEMENTED | none | Same | — | G1 |
| 5.9-25 | Notes | PARTIAL | Generic property `notes` | Per access rule | — | G1 |
| 5.9-26 | Documents per prospect, client, contract and visit | PARTIAL | Signed-contract archive and assessment photos in private `amc-documents` | Per client/prospect/visit store | — | G1 |
| 5.9-27 | Document category, version, date, user, expiry | PARTIAL | created_at, created_by | Category, version, expiry | — | G1 |

## 5.10 PPM schedule and service windows

**There is no AMC visit or schedule entity.** Activation (M/20261006140000:31-64) inserts the contract and its entitlement rows only.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.10-01 | Tentative schedule generated on activation | NOT IMPLEMENTED | none | Visit table and generator | — | G4 |
| 5.10-02 | Per service line | NOT IMPLEMENTED | Entitlements per service exist | Visits | — | G4 |
| 5.10-03 | From the commencement date | NOT IMPLEMENTED | `start_date` unused for scheduling | Generator | — | G4 |
| 5.10-04 | Spread evenly | NOT IMPLEMENTED | `frequency` used for price and allowance only | Spreading | — | G4 |
| 5.10-05 | Configurable holiday calendar | NOT IMPLEMENTED | none | Calendar | — | G4 |
| 5.10-06 | Skips non-working days | NOT IMPLEMENTED | none | Rule | — | G4 |
| 5.10-07 | Service cycle | NOT IMPLEMENTED | none | Cycle | — | G4 |
| 5.10-08 | Service window, configurable per contract | NOT IMPLEMENTED | none | Window | — | G4 |
| 5.10-09 | Target date | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.10-10 | Preferred months or days set target dates | NOT IMPLEMENTED | none | Rule | 5.2-20 | G4 |
| 5.10-11 | Team adjusts dates | NOT IMPLEMENTED | none | UI | — | G4 |
| 5.10-12 | Add or remove visits with a reason | NOT IMPLEMENTED | none | UI and reason | — | G4 |
| 5.10-13 | Team confirms | NOT IMPLEMENTED | Scheduling day approval is per day, not an AMC plan | Confirmation | — | G4 |
| 5.10-14 | Confirmed schedule is the plan of record | NOT IMPLEMENTED | none | Baseline | — | G4 |
| 5.10-15 | Moving inside the window is not a reschedule | NOT IMPLEMENTED | none | Rule | — | G4 |
| 5.10-16 | Moving outside needs a reason | NOT IMPLEMENTED | none | Rule | — | G4 |
| 5.10-17 | Original date kept for adherence | NOT IMPLEMENTED | Generic scheduling audit `before_value` only | Field | — | G4 |
| 5.10-18 | Clubbing trades into one visit | NOT IMPLEMENTED | One live link per appointment to one entitlement (M/20261006120000:99-101) | Clubbing | — | G4 |
| 5.10-19 | Unclubbing | NOT IMPLEMENTED | none | Action | — | G4 |
| 5.10-20 | Completion tracked per trade | PARTIAL | Usage per entitlement | Per trade inside a visit | — | G4/G5 |
| 5.10-21 | Visits completed | PARTIAL | "X of Y used" (lib/amc/contracts.ts:402-415) | Delivered visits (manual FSM confirmation) | — | G4 |
| 5.10-22 | Visits remaining | IMPLEMENTED | `remainingQuantity`, summarizeContract (lib/amc/contracts.ts:366-371, 695-745) | Based on allowance | — | — |
| 5.10-23 | Visits overdue | NOT IMPLEMENTED | Only renewal overdue | Overdue visits | — | G4 |

## 5.11 Appointment confirmation, scheduling board and assignment

**Confirmation**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-01 | Coordinator to-do N days before the window | NOT IMPLEMENTED | Todos used for renewal only | To-do | — | G4 |
| 5.11-02 | Configurable lead days (7 in the meeting) | NOT IMPLEMENTED | none | Setting | — | G4 |
| 5.11-03 | Client confirmation request by WhatsApp, SMS or email | NOT IMPLEMENTED | AMC channels are in-app and staff email | Client message | WhatsApp/SMS provider | G4 |
| 5.11-04 | Answer stored on the visit | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.11-05 | Attempts logged (date, channel, outcome) | NOT IMPLEMENTED | none | Log | — | G4 |
| 5.11-06 | Configurable number of attempts | NOT IMPLEMENTED | none | Setting | — | G4 |
| 5.11-07 | Configurable minimum interval | NOT IMPLEMENTED | none | Setting | — | G4 |
| 5.11-08 | Escalation recipient | NOT IMPLEMENTED | none | Setting | — | G4 |
| 5.11-09 | Two no-shows count as a consumed visit | NOT IMPLEMENTED | Manual usage only | Rule | — | G4 |

**Scheduling board.** The existing board (`components/dashboard/scheduling/**`) works for any FSM work order. Its bars carry no AMC visit identity.

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-10 | Drag and drop | PARTIAL | daily-schedule/index.tsx:778-873 | AMC visits on the board | — | G4 |
| 5.11-11 | Change team | PARTIAL | Team leader attribute | AMC visit team | — | G4 |
| 5.11-12 | Change technician | PARTIAL | index.tsx:846-873 | Same | — | G4 |
| 5.11-13 | Reschedule | PARTIAL | Day board; publish reschedules FSM (lib/server/publish-schedule.ts) | Reason, window logic | — | G4 |
| 5.11-14 | Update several in one action | NOT IMPLEMENTED | Single-entry edits | Bulk update | — | G4 |
| 5.11-15 | Job details travel with the visit | PARTIAL | Entry copies FSM work order client, contact, address | AMC contract, scope, access | — | G4 |
| 5.11-16 | Original date kept | NOT IMPLEMENTED | Audit only | Field | — | G4 |

**Assignment**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-17 | Suggest trade and headcount from scope | NOT IMPLEMENTED | none | Engine | BRD: standard durations to confirm | G4 |
| 5.11-18 | Only confirmed-competent technicians | NOT IMPLEMENTED | Single role/service type plus tags | Competency model | — | G4 |
| 5.11-19 | Filter by shift | PARTIAL | `technician_reference.shift` | Suggestion filter | — | G4 |
| 5.11-20 | Location | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.11-21 | Existing workload | NOT IMPLEMENTED | none | Filter | — | G4 |
| 5.11-22 | Team composition | PARTIAL | `team_leader_fsm_id` | Rules | — | G4 |
| 5.11-23 | Vehicle | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.11-24 | Driver | NOT IMPLEMENTED | Free tag only | Field | — | G4 |
| 5.11-25 | Tools | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.11-26 | Access permissions | NOT IMPLEMENTED | none | Field | — | G4 |
| 5.11-27 | Prevents double booking | PARTIAL | Leave overlaps blocked; job overlaps flagged (api/scheduling/schedule/entries/route.ts:82-115) | Hard prevention | — | G4 |
| 5.11-28 | Shows the day's workload | PARTIAL | Per-technician rows | Picker metric | — | G4 |
| 5.11-29 | Accept or override with a reason | NOT IMPLEMENTED | none | Override | — | G4 |
| 5.11-30 | FSM appointment created | PARTIAL | Board creates an appointment for an existing work order | From an AMC visit | — | G4 |

**Access**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.11-31 | Visit shows the property access rule | NOT IMPLEMENTED | none | Rules (5.9) | — | G4 |
| 5.11-32 | Access status: not required, pending, approved, rejected, expired | NOT IMPLEMENTED | none | Status | — | G4 |
| 5.11-33 | Alert when a visit is near without access | NOT IMPLEMENTED | none | Alert | — | G4 |
| 5.11-34 | Client reminder the day before | NOT IMPLEMENTED | none | Message | WhatsApp/SMS provider | G4 |
| 5.11-35 | Technician reminder on the day | NOT IMPLEMENTED | none | Message | FSM dispatch notification (check) | G4 |

## 5.12 Job execution and closure

The technician side is the Zoho FSM mobile app (BRD §3). FSM rows still need AMC configuration in FSM: asset checklist, allowance flag, additional work, pending works, client signature (§3, §5.17).

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.12-01 | Technician gets the job | FSM | FSM app | — | — | — |
| 5.12-02 | Client, property, contact, access notes | FSM | FSM work order | AMC access rules not pushed to FSM | — | G5 |
| 5.12-03 | Scope | FSM | FSM service lines | AMC scope not pushed | — | G5 |
| 5.12-04 | Property history | FSM | — | Needs FSM Assets per property | FSM config | G5 |
| 5.12-05 | Arrival time | FSM | `Actual_Start` captured in `amc_fsm_sync_events` | Mapping as arrival | — | G5 |
| 5.12-06 | Completion time | FSM | `Actual_End` | — | — | — |
| 5.12-07 | Before/after photos per asset | FSM | — | Per-asset structure in FSM | FSM config | G5 |
| 5.12-08 | Checklist per asset | FSM | Portal checklist is pre-sale only | FSM job-sheet checklist | FSM config | G5 |
| 5.12-09 | Faults | FSM | — | FSM field | FSM config | G5 |
| 5.12-10 | Consumables (link to Inventory) | FSM | — | Inventory link | Inventory process | G5 |
| 5.12-11 | Additional work found | PARTIAL | `amc_additional_quotes` (contract page) | Raised from a visit | — | G5 |
| 5.12-12 | Pending works with a reason | NOT IMPLEMENTED | none | Record and FSM field | — | G5 |
| 5.12-13 | Client signature | FSM | FSM native | — | — | — |
| 5.12-14 | Works offline | FSM | FSM native | — | — | — |
| 5.12-15 | Syncs when online | FSM | App to FSM native; portal check manual | — | — | — |
| 5.12-16 | Submitting does not close the visit | NOT IMPLEMENTED | Portal mirrors FSM status | Submitted state | — | G5 |
| 5.12-17 | Supervisor reviews and closes | PARTIAL | Usage confirmation step (api/amc-contracts/[id]/fsm/appointments/[appointmentId]) | Job-sheet review and close | — | G5 |
| 5.12-18 | Mandatory review rules | NOT IMPLEMENTED | none | Rules | — | G5 |
| 5.12-19 | Return workflow | NOT IMPLEMENTED | none | Return | — | G5 |
| 5.12-20 | Not Scheduled | NOT IMPLEMENTED | — | Status | — | G4 |
| 5.12-21 | Scheduled | PARTIAL | Mirrored FSM status (lib/scheduling/appointment-status.ts) | AMC visit status | — | G4 |
| 5.12-22 | Confirmed | NOT IMPLEMENTED | — | Status | — | G4 |
| 5.12-23 | In Progress | PARTIAL | Mirrored | AMC visit status | — | G5 |
| 5.12-24 | Submitted | NOT IMPLEMENTED | — | Status | — | G5 |
| 5.12-25 | Completed | PARTIAL | Mirrored | AMC visit status | — | G5 |
| 5.12-26 | Completed with Additional Work | NOT IMPLEMENTED | — | Status | — | G5 |
| 5.12-27 | Partially Completed | NOT IMPLEMENTED | — | Status | — | G5 |
| 5.12-28 | Pending Access | NOT IMPLEMENTED | — | Status | — | G4 |
| 5.12-29 | Rescheduled | NOT IMPLEMENTED | — | Status | — | G4 |
| 5.12-30 | Not Completed | PARTIAL | "Cannot complete" mirrored | Reason | — | G5 |
| 5.12-31 | Cancelled | PARTIAL | Mirrored | AMC visit status | — | G5 |
| 5.12-32 | Five non-completion reason groups | NOT IMPLEMENTED | none | Reasons | — | G5 |
| 5.12-33 | Partial clubbed visit: remaining trade rescheduled without reopening | NOT IMPLEMENTED | none | Rule | — | G5 |
| 5.12-34 | Report to the client within 48 hours | NOT IMPLEMENTED | Clause wording only (amc-contract-content.ts:213) | Report and clock | — | G5 |

## 5.13 Call outs and reactive maintenance

**There is no call-out entity.**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.13-01 | Logged from call, WhatsApp or email | NOT IMPLEMENTED | none | Call-out record | — | G5 |
| 5.13-02 | Against the contract | PARTIAL | Manual FSM link with `requested_at` (M/20261006120000:71-89) | Call-out record | — | G5 |
| 5.13-03 | Property | PARTIAL | Contract property | Per call-out | — | G5 |
| 5.13-04 | Reported issue | NOT IMPLEMENTED | none | Field | — | G5 |
| 5.13-05 | Photos | NOT IMPLEMENTED | none | Field | — | G5 |
| 5.13-06 | Contact on site | NOT IMPLEMENTED | none | Field | — | G5 |
| 5.13-07 | Priority emergency / non-emergency | PARTIAL | `call_out_class`; coverage dialog request type | On a call-out | — | G5 |
| 5.13-08 | Entitlement check before confirming | IMPLEMENTED | api/amc-contracts/coverage/route.ts:40-84; checkCoverage | — | — | — |
| 5.13-09 | Covered/chargeable told to coordinator and client | PARTIAL | coverageVerdict; stored at link time | Client not told | — | G5 |
| 5.13-10 | Emergency logged within 60 minutes | NOT IMPLEMENTED | Clause wording only | Clock | — | G5 |
| 5.13-11 | Emergency attended within 120 minutes | EXT BLOCKED | lib/amc/sla.ts defines 120 min; `arrivedAt` FSM field unmapped (lib/amc/fsm-sync.ts:479), so always UNKNOWN | FSM arrival field | Zoho FSM: arrival timestamp | G5 |
| 5.13-12 | Non-emergency scheduled within 48 hours | PARTIAL | SLA definition exists but uses **6 hours** (lib/amc/sla.ts:39-44); the contract says 48 h; no booking time from FSM | Set 48 h per BRD; booking timestamp | FSM booking time | G5 |
| 5.13-13 | Minor fix up to 2 hours | NOT IMPLEMENTED | Wording only | Rule | — | G5 |
| 5.13-14 | Becomes an FSM appointment | PARTIAL | Generic board only | From the call-out | — | G5 |
| 5.13-15 | Same assignment rules as PPM | PARTIAL | As 5.11 | — | — | G4/G5 |
| 5.13-16 | Emergencies ahead of planned work | NOT IMPLEMENTED | none | Priority | — | G5 |
| 5.13-17 | Attendance time | FSM | `Actual_Start` | SLA mapping | — | G5 |
| 5.13-18 | Diagnosis | FSM | — | FSM field | FSM config | G5 |
| 5.13-19 | Resolution | FSM | — | FSM field | FSM config | G5 |
| 5.13-20 | Pending works | NOT IMPLEMENTED | none | Record | — | G5 |
| 5.13-21 | Parts needed | FSM | — | Inventory link | — | G5 |
| 5.13-22 | Over 2 h or parts: quoted as additional work | PARTIAL | `amc_additional_quotes` | Link to a call-out | — | G5 |
| 5.13-23 | Stays open until that work is done or declined | NOT IMPLEMENTED | none | Rule | — | G5 |
| 5.13-24 | Statuses Logged … Closed | NOT IMPLEMENTED | none | Statuses | — | G5 |
| 5.13-25 | SLA misses flagged for reporting | NOT IMPLEMENTED | Reports have no SLA; per-visit SLA UNKNOWN | Report | FSM timestamps | G5/G6 |
| 5.13-26 | Misuse of the emergency line flagged | NOT IMPLEMENTED | none | Flag | — | G5 |

## 5.14 Additional works and entitlements

**Additional works** (`amc_additional_quotes`, M/20261006130000:287-347; lib/server/amc/business.ts:1156-1331)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.14-01 | Raised from a PPM visit or call out | NOT IMPLEMENTED | Raised from the contract page only | Visit/call-out origin | 5.10, 5.13 | G5 |
| 5.14-02 | Linked to the contract | IMPLEMENTED | `contract_id NOT NULL` | — | — | — |
| 5.14-03 | Linked to the property | IMPLEMENTED | `property_id` (business.ts:1165-1171) | — | — | — |
| 5.14-04 | Linked to the technician | NOT IMPLEMENTED | none | Field | — | G5 |
| 5.14-05 | Technical finding kept apart from the commercial part | NOT IMPLEMENTED | none | Finding record | — | G5 |
| 5.14-06 | Photos | NOT IMPLEMENTED | Assessments only | Photos | — | G5 |
| 5.14-07 | Risk | NOT IMPLEMENTED | none | Field | — | G5 |
| 5.14-08 | Commercial quotation | PARTIAL | Frozen eligibility/discount calculation; FSM estimate linked by number | Quote built by hand in FSM | FSM estimate fields | G5 |
| 5.14-09 | Requester, approver, payer, invoice recipient, report recipient | NOT IMPLEMENTED | none | Five parties | — | G5 |
| 5.14-10 | Status Identified | NOT IMPLEMENTED | Statuses are draft / estimate_linked / cancelled | Status | — | G5 |
| 5.14-11 | Quotation Prepared | PARTIAL | `draft` | Status | — | G5 |
| 5.14-12 | Shared | PARTIAL | `estimate_linked` nearest | Client sharing | — | G5 |
| 5.14-13 | Approved with evidence | NOT IMPLEMENTED | none | Approval and evidence | — | G5 |
| 5.14-14 | Rejected | NOT IMPLEMENTED | `cancelled` with reason only | Status | — | G5 |
| 5.14-15 | Scheduled | NOT IMPLEMENTED | none | Status | — | G5 |
| 5.14-16 | Completed | NOT IMPLEMENTED | none | Status | — | G5 |
| 5.14-17 | Invoiced | NOT IMPLEMENTED | none | Status | Zoho Finance | G5/G3 |
| 5.14-18 | Paid | NOT IMPLEMENTED | none | Status | Zoho Finance | G5/G3 |
| 5.14-19 | 20% material handling fee | NOT IMPLEMENTED | Contract wording only (amc-contract-content.ts:432) | Calculation | — | G5 |
| 5.14-20 | Totals roll up to contract and client | PARTIAL | Per-contract totals (business.ts:1301-1331) | Client roll-up; quotes excluded from report revenue | — | G5/G6 |

**Entitlements and allowances** (ledger M/20261006100000:165-276; corrections M/20261006110000)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.14-21 | Contract defines what is included | IMPLEMENTED | Entitlements created at activation | — | — | — |
| 5.14-22 | Checked when a call out or service is booked | PARTIAL | Coverage API; read-only notice in the scheduling dialog (amc-work-order-notice.tsx) | Run on call-out logging; never blocks | — | G5 |
| 5.14-23 | Used | IMPLEMENTED | `used_quantity` kept by trigger | — | — | — |
| 5.14-24 | Reserved | NOT IMPLEMENTED | none | Reserved count | — | G5 |
| 5.14-25 | Remaining | IMPLEMENTED | remainingQuantity / summarizeContract | — | — | — |
| 5.14-26 | Booking reserves one unit | NOT IMPLEMENTED | none | Reservation | — | G5 |
| 5.14-27 | Consumed only on completion | PARTIAL | Consumption on confirmed FSM completion (fsm-integration.ts:872-928); auto off | Automatic on supervisor closure | FSM "Completed" meaning | G5 |
| 5.14-28 | Cancelled visit releases the unit | NOT IMPLEMENTED | No reservation | Release | — | G5 |
| 5.14-29 | Failed visit releases the unit | NOT IMPLEMENTED | none | Release | — | G5 |
| 5.14-30 | Reversals possible | IMPLEMENTED | Correction entries (contract-operations.ts:196-280) | — | — | — |
| 5.14-31 | Corrections possible | IMPLEMENTED | api/amc-contracts/[id]/usage/[usageId]/correction | — | — | — |
| 5.14-32 | With a reason | IMPLEMENTED | Required reason (M/20261006110000:49-55) | — | — | — |
| 5.14-33 | Every movement in an audit trail | IMPLEMENTED | Append-only ledger + `amc_audit_events` | — | — | — |
| 5.14-34 | Warns near zero | IMPLEMENTED | entitlement_low/exhausted at ≤25% (notifications.ts:426-463) | Email off by default | — | — |
| 5.14-35 | Blocks chargeable recorded as free without authorisation | PARTIAL | Over-allowance usage refused (DB CHECK) | Authorised override path | — | G5 |
| 5.14-36 | Balance shown at booking so the client hears first | PARTIAL | "(N left)" on the scheduling notice | Client told | — | G5 |
| 5.14-37 | Reset basis | NOT IMPLEMENTED | none | Rule | BRD: to confirm | G5 |

## 5.15 Reports and dashboard

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.15-01 | Client report per contract, on demand | NOT IMPLEMENTED | none | Report | — | G6 |
| 5.15-02 | — scope | NOT IMPLEMENTED | none | Section | — | G6 |
| 5.15-03 | — visits completed with dates | NOT IMPLEMENTED | none | Section | 5.10 | G6 |
| 5.15-04 | — photos | NOT IMPLEMENTED | none | Section | FSM photos | G6 |
| 5.15-05 | — call outs attended | NOT IMPLEMENTED | none | Section | 5.13 | G6 |
| 5.15-06 | — additional works and cost | NOT IMPLEMENTED | none | Section | 5.14 | G6 |
| 5.15-07 | — allowances used and remaining | PARTIAL | Internal contract page | In a client report | — | G6 |
| 5.15-08 | — visits remaining | PARTIAL | Internal contract page | In a client report | — | G6 |
| 5.15-09 | Residential and commercial templates | NOT IMPLEMENTED | none | Templates | — | G6 |
| 5.15-10 | Sent by email | NOT IMPLEMENTED | none | Send | — | G6 |
| 5.15-11 | Sent by WhatsApp | NOT IMPLEMENTED | none | Prepared message | — | G6 |
| 5.15-12 | Schedule adherence against windows | NOT IMPLEMENTED | none | Report | 5.10 | G6 |
| 5.15-13 | Visits due | NOT IMPLEMENTED | none | Report | 5.10 | G6 |
| 5.15-14 | Visits overdue | NOT IMPLEMENTED | none | Report | 5.10 | G6 |
| 5.15-15 | Pending by reason group | NOT IMPLEMENTED | none | Report | 5.12 | G6 |
| 5.15-16 | Call outs by priority, SLA met or missed | NOT IMPLEMENTED | SLA always UNKNOWN (lib/amc/sla.ts) | Report | FSM timestamps | G6 |
| 5.15-17 | Contracts at risk of ending incomplete | NOT IMPLEMENTED | none | Report | — | G6 |
| 5.15-18 | Technician utilisation | NOT IMPLEMENTED | none | Report | — | G6 |
| 5.15-19 | Allowance use | IMPLEMENTED | serviceAnalytics (lib/amc/business.ts:499-522); Services tab (amc-reports.tsx:448) | — | — | — |
| 5.15-20 | Access failures by community | NOT IMPLEMENTED | none | Report | 5.11 | G6 |
| 5.15-21 | Proposals and conversion | NOT IMPLEMENTED | Proposal list with filters only | Report | — | G6 |
| 5.15-22 | Discounts by level | NOT IMPLEMENTED | none | Report | 5.5 levels | G6 |
| 5.15-23 | Signed value by period and category | PARTIAL | In-force value (business.ts:458-481) | By period and category | — | G6 |
| 5.15-24 | Collections and ageing | NOT IMPLEMENTED | none | Report | 5.8 | G6 |
| 5.15-25 | Cheques by status | NOT IMPLEMENTED | none | Report | 5.8 | G6 |
| 5.15-26 | Additional work revenue | NOT IMPLEMENTED | none | Report | 5.14 | G6 |
| 5.15-27 | Renewals | IMPLEMENTED | Renewal pipeline (business.ts:357-422; amc-reports.tsx:294) | — | — | — |
| 5.15-28 | Profitability: contract revenue | PARTIAL | `grand_total` per contract | Profitability view | — | G6 |
| 5.15-29 | — additional work revenue | NOT IMPLEMENTED | none | Data | 5.14 | G6 |
| 5.15-30 | — actual labour hours | NOT IMPLEMENTED | none | Data | FSM timesheets | G6 |
| 5.15-31 | — material cost | NOT IMPLEMENTED | none | Data | Inventory | G6 |
| 5.15-32 | — subcontractor cost | NOT IMPLEMENTED | none | Data | Finance | G6 |
| 5.15-33 | — other direct costs | NOT IMPLEMENTED | none | Data | Finance | G6 |
| 5.15-34 | — per contract and client | NOT IMPLEMENTED | none | View | — | G6 |
| 5.15-35 | Dashboard: pipeline | PARTIAL | Proposal list by status | Pipeline dashboard | 5.1 | G6 |
| 5.15-36 | Dashboard: contracts | IMPLEMENTED | `amc_contracts_dashboard` (M/20261006140000:84-171); contracts-summary.tsx | — | — | — |
| 5.15-37 | Dashboard: approvals | PARTIAL | Approval notice queue | Escalation, levels | — | G6 |
| 5.15-38 | Dashboard: delivery | NOT IMPLEMENTED | none | Panel | 5.10 | G6 |
| 5.15-39 | Dashboard: workforce | NOT IMPLEMENTED | none | Panel | 5.11 | G6 |
| 5.15-40 | Dashboard: commercial | PARTIAL | In-force value stat | Collections, conversion | — | G6 |
| 5.15-41 | Dashboard: renewals in 30, 60, 90 days | IMPLEMENTED | Expiry buckets (business.ts:322-345; amc-reports.tsx:204) | — | — | — |

## 5.16 Renewal, amendments and termination

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 5.16-01 | Reminder 30 days before expiry, configurable 30–60 | PARTIAL | Thresholds configurable (default 60/30/15); sweep in lib/server/amc/reminders.ts | Auto off, no scheduler; range not limited to 30–60 | Reminder schedule decision | G6 |
| 5.16-02 | Owner reminded | PARTIAL | Recipient `owner` | Same gating | — | G6 |
| 5.16-03 | Management reminded | PARTIAL | `approvers` option | Not default; same gating | — | G6 |
| 5.16-04 | Renewals-due view | IMPLEMENTED | Expiry and pipeline tabs | — | — | — |
| 5.16-05 | Escalation if nothing happens | NOT IMPLEMENTED | none | Escalation | — | G6 |
| 5.16-06 | Renewal proposal drafted from the expiring contract | IMPLEMENTED | lib/amc/contracts.ts:674-781; renewal.ts:51-97 | — | — | — |
| 5.16-07 | Configurable escalation percent | NOT IMPLEMENTED | Old base prices kept (renewal.ts:13-16) | Escalation % | — | G6 |
| 5.16-08 | Past year's visits, call outs, additional works, allowance use beside the draft | PARTIAL | Previous total only (contract-renewal.tsx:181-187) | History panel | 5.10–5.14 | G6 |
| 5.16-09 | Sent through the normal flow | IMPLEMENTED | Renewal is a normal proposal | — | — | — |
| 5.16-10 | New contract linked to the old | IMPLEMENTED | `renewed_from_contract_id` | — | — | — |
| 5.16-11 | Outcome: Renewed | IMPLEMENTED | Derived stage | — | — | — |
| 5.16-12 | Outcome: Renewed with Revised Scope | NOT IMPLEMENTED | none | Outcome | — | G6 |
| 5.16-13 | Outcome: Under Negotiation | PARTIAL | Proxy stages | Explicit outcome | — | G6 |
| 5.16-14 | Outcome: Not Renewed with a reason | PARTIAL | Client rejection reason only | Staff-recorded outcome | — | G6 |
| 5.16-15 | Outcome: Lapsed | IMPLEMENTED | `expired_without_renewal` (business.ts:419) | — | — | — |
| 5.16-16 | Scope change with approval | NOT IMPLEMENTED | none | Flow | — | G6 |
| 5.16-17 | Property change with approval | NOT IMPLEMENTED | none | Flow | — | G6 |
| 5.16-18 | Hold with approval | NOT IMPLEMENTED | none | Flow and status | — | G6 |
| 5.16-19 | Transfer to a new owner or tenant | NOT IMPLEMENTED | none | Flow | — | G6 |
| 5.16-20 | Early termination | NOT IMPLEMENTED | none | Flow and status | — | G6 |
| 5.16-21 | Cancellation with approval | PARTIAL | Approver-only, reason, audited (api/amc-contracts/[id]/cancel) | Notice and refund logic | — | G6 |
| 5.16-22 | 30 days' notice | NOT IMPLEMENTED | none | Rule | — | G6 |
| 5.16-23 | Pro-rata refund with a valid reason | NOT IMPLEMENTED | none | Calculation | Finance | G6 |
| 5.16-24 | Reason handling | PARTIAL | Free-text reason | Valid-reason classification | — | G6 |

## 6.1 Emails

**Email 1: Proposal shared** (api/amc-submissions/send/route.ts:111-154, 448-475)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-01 | Subject "… proposal {no} {version} for {property}" | PARTIAL | "Your AMC proposal {no}" | Version, property | — | G2 |
| 6.1-02 | Prospect name | IMPLEMENTED | Body | — | — | — |
| 6.1-03 | Proposal number | IMPLEMENTED | As "Reference" | — | — | — |
| 6.1-04 | Version | NOT IMPLEMENTED | none | Versions | 5.4 | G2 |
| 6.1-05 | Property address | IMPLEMENTED | Body | — | — | — |
| 6.1-06 | Service list | NOT IMPLEMENTED | none | Line | — | G2 |
| 6.1-07 | Visit count | NOT IMPLEMENTED | none | Line | — | G2 |
| 6.1-08 | Final price including VAT | PARTIAL | "Annual fee (excl. VAT)" | Including VAT | — | G2 |
| 6.1-09 | Payment plan | NOT IMPLEMENTED | none | Line | 5.8 | G2 |
| 6.1-10 | Validity date | NOT IMPLEMENTED | Link expiry shown instead | Validity | 5.4-07 | G2 |
| 6.1-11 | Approval link | IMPLEMENTED | Token link | — | — | — |
| 6.1-12 | Coordinator phone | NOT IMPLEMENTED | none | Line | — | G2 |
| 6.1-13 | Coordinator name | NOT IMPLEMENTED | none | Line | — | G2 |
| 6.1-14 | Recipients: selected prospect contacts | PARTIAL | One address | Several | — | G2 |
| 6.1-15 | Copy to coordinator | NOT IMPLEMENTED | No cc | cc | — | G2 |
| 6.1-16 | Renewal opening line | NOT IMPLEMENTED | none | Variant | — | G2 |
| 6.1-17 | Proposal attached | IMPLEMENTED | Optional PDF | — | — | — |

**Email 2: Contract for signature** (send/route.ts:111-154, 447-475)

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-18 | Trigger: contract issued for signature | IMPLEMENTED | Owner sends contract | — | — | — |
| 6.1-19 | Subject "… contract {Contract no} is ready to sign" | PARTIAL | "Your AMC contract {proposal no}" | Wording, contract number | — | G2 |
| 6.1-20 | Client name | IMPLEMENTED | Body | — | — | — |
| 6.1-21 | Proposal number | IMPLEMENTED | "Reference" | — | — | — |
| 6.1-22 | Contract number | PARTIAL | Same as proposal number | Own number | 5.7-22 | G2 |
| 6.1-23 | Property address | IMPLEMENTED | Body | — | — | — |
| 6.1-24 | Signing link | IMPLEMENTED | 30-day token | — | — | — |
| 6.1-25 | Start and end date | NOT IMPLEMENTED | none | Line | — | G2 |
| 6.1-26 | Value including VAT | PARTIAL | Excl. VAT shown | Including VAT | — | G2 |
| 6.1-27 | Payment plan | NOT IMPLEMENTED | none | Line | 5.8 | G2/G3 |
| 6.1-28 | First instalment amount | NOT IMPLEMENTED | none | Line | 5.8 | G3 |
| 6.1-29 | Recipient: client signatory | PARTIAL | Confirmed or customer address | Signatory | — | G2 |
| 6.1-30 | Copy to coordinator | NOT IMPLEMENTED | none | cc | — | G2 |
| 6.1-31 | Copy to Finance | NOT IMPLEMENTED | none | cc | — | G2 |
| 6.1-32 | Resent after N unsigned days | NOT IMPLEMENTED | Manual resend | Reminder | — | G2 |
| 6.1-33 | PDF attached for paper signature | PARTIAL | Optional browser PDF | Record a paper signature (5.7-27) | — | G2 |

**Email 3: Service report; instalment reminder**

| ID | Requirement | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.1-34 | Email 3 sent when the supervisor approves the job sheet | NOT IMPLEMENTED | No job sheet review | Trigger and email | 5.12 | G5 |
| 6.1-35 | Within 48 hours of the visit | NOT IMPLEMENTED | none | Clock | — | G5 |
| 6.1-36 | Values: service, seq of total, done/remaining, free visits used of allowed, additional-work line | NOT IMPLEMENTED | none | Template | — | G5 |
| 6.1-37 | Instalment reminder email (due and overdue) | NOT IMPLEMENTED | none | Template and trigger | 5.8 | G3 |

## 6.2 Notifications

Existing events: `amc_notifications` (M/20261006150000:35-40); policy in lib/amc/notifications.ts:58-72.

| ID | Notification | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.2-01 | New enquiry assigned | NOT IMPLEMENTED | No enquiries | Event | 5.1 | G2 |
| 6.2-02 | Follow-up due | NOT IMPLEMENTED | — | Event | 5.1 | G2 |
| 6.2-03 | Enquiry idle | NOT IMPLEMENTED | — | Event | 5.1 | G2 |
| 6.2-04 | Site visit assigned | NOT IMPLEMENTED | Assessments notify nobody | Event | — | G1 |
| 6.2-05 | Proposal pending approval, with escalation | PARTIAL | `proposal_submitted` to approvers | Escalation | — | G2 |
| 6.2-06 | Approved, rejected or returned | PARTIAL | approved, sent back | Rejected | 5.5-09 | G2 |
| 6.2-07 | Validity expiring | NOT IMPLEMENTED | — | Event | 5.4-07 | G2 |
| 6.2-08 | Prospect decision recorded | IMPLEMENTED | client_approved / client_rejected | — | — | — |
| 6.2-09 | Contract unsigned | NOT IMPLEMENTED | Only `contract_sent` | Reminder | — | G2 |
| 6.2-10 | Initial payment pending | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-11 | Instalment due | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-12 | Instalment overdue | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-13 | Cheque date near | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-14 | Cheque bounced | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-15 | Payment received | NOT IMPLEMENTED | — | Event | 5.8 | G3 |
| 6.2-16 | PPM confirmation due | NOT IMPLEMENTED | — | Event | 5.11 | G4 |
| 6.2-17 | No client answer after the set attempts | NOT IMPLEMENTED | — | Event | 5.11 | G4 |
| 6.2-18 | Access or gate pass pending | NOT IMPLEMENTED | — | Event | 5.11 | G4 |
| 6.2-19 | Call out logged | NOT IMPLEMENTED | — | Event | 5.13 | G5 |
| 6.2-20 | SLA at risk | NOT IMPLEMENTED | — | Event | 5.13 | G5 |
| 6.2-21 | Job sheet not submitted | NOT IMPLEMENTED | — | Event | 5.12 | G5 |
| 6.2-22 | Job sheet awaiting review | NOT IMPLEMENTED | — | Event | 5.12 | G5 |
| 6.2-23 | PPM overdue | NOT IMPLEMENTED | — | Event | 5.10 | G4 |
| 6.2-24 | Allowance near limit or used up | IMPLEMENTED | entitlement_low / entitlement_exhausted | — | — | — |
| 6.2-25 | Quotation waiting for client approval | NOT IMPLEMENTED | — | Event | 5.14 | G5 |
| 6.2-26 | Contract expiring in 60 and 30 days | PARTIAL | `contract_expiring` sweep | Scheduler; auto off | Reminder schedule decision | G6 |
| 6.2-27 | Expiry near with no renewal activity | NOT IMPLEMENTED | Sweep ignores renewal activity | Rule | — | G6 |
| 6.2-28 | Shown on the portal home until opened, then inbox | PARTIAL | Bell on AMC screens only (amc-section-nav.tsx:68) | Home placement, inbox | — | G6 |

## 6.3 SMS and WhatsApp messages

No WhatsApp or SMS provider exists. "Prepared" means the portal builds the text and the coordinator sends it from WhatsApp. "Automatic" means the portal sends it.

| ID | Message | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.3-01 | Proposal shared (prepared, sent by coordinator) | PARTIAL | Bare link to copy (amc-link-dialog.tsx) | Prepared text, wa.me | — | G2 |
| 6.3-02 | Contract ready to sign | PARTIAL | Same link copy | Prepared text | — | G2 |
| 6.3-03 | Appointment confirmation request (attempts per contract) | NOT IMPLEMENTED | none | Message | Provider if automatic | G4 |
| 6.3-04 | Appointment reminder the day before | NOT IMPLEMENTED | none | Message | Provider | G4 |
| 6.3-05 | Call-out acknowledgement | NOT IMPLEMENTED | none | Message | Provider | G5 |
| 6.3-06 | Instalment due with payment link | NOT IMPLEMENTED | none | Message | PayTabs/NomuPay, provider | G3 |
| 6.3-07 | Service report link | NOT IMPLEMENTED | none | Message | 5.12 | G5 |
| 6.3-08 | Renewal proposal | PARTIAL | Normal proposal link copy | Prepared renewal text | — | G2/G6 |
| 6.3-09 | WhatsApp main channel, SMS fallback | NOT IMPLEMENTED | none | Provider and fallback | WhatsApp Business / SMS provider | G4 |

## 6.7 Roles

| ID | Rule | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.7-01 | Roles configurable | IMPLEMENTED | roles / role_access; AMC and AMC Operations resources (types/types.ts) | — | — | — |
| 6.7-02 | Only department head and Finance edit rate card, floors, promotions | PARTIAL | AMC Settings admin-only | Department-head / Finance permission; rate card | — | G2 |
| 6.7-03 | Only management sets thresholds and value bands | NOT IMPLEMENTED | No thresholds or bands | Permission | — | G2/G3 |
| 6.7-04 | Approval levels per trigger | NOT IMPLEMENTED | Flat approver list | Levels | — | G2 |
| 6.7-05 | Nobody approves their own proposal | NOT IMPLEMENTED | `AMC_SELF_APPROVAL_ALLOWED = true` (lib/amc/workflow.ts:34) | Switch off | — | G2 (first) |
| 6.7-06 | Initial payment override: named role, reason kept | NOT IMPLEMENTED | none | Role and override | 5.8 | G3 |
| 6.7-07 | Allowance override: named role, reason kept | NOT IMPLEMENTED | Usage API accepts consumption only | Override | — | G5 |
| 6.7-08 | Technicians see their own jobs only | FSM | FSM app | — | — | — |
| 6.7-09 | Coordinators see all AMC prospects, clients and contracts | PARTIAL | AMC Operations View sees all contracts (lib/amc/access.ts) | Proposals visible to approvers only | — | G2 |
| 6.7-10 | Only a supervisor closes a visit with pending works or gaps | NOT IMPLEMENTED | none | Rule | 5.12 | G5 |
| 6.7-11 | Only an authorised role reverses an allowance movement | PARTIAL | canCorrectUsage (approver, AMC Operations Approve) | Owner can also correct (`AMC_CORRECTIONS_APPROVER_ONLY = false`) | — | G5 |
| 6.7-12 | Prospects and clients act by link, no login | IMPLEMENTED | api/amc/[token] | — | — | — |

## 6.8 To-dos

Only renewal reminders create Todos today (lib/server/amc/contract-operations.ts:669-740). `todos.related_type 'amc_contract'` exists (M/20261006110000:143-147).

| ID | To-do | Status | Shown / actions / assignee / escalation today | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.8-01 | Proposal approval | PARTIAL | Pending-approvals queue: proposal and price; Approve, Send back; approvers; no escalation | A to-do with version, discount, plan, trigger crossed; Reject; level assignee; escalation after set hours | 5.5 | G2 |
| 6.8-02 | Contract follow-up | NOT IMPLEMENTED | — | Everything | 5.7, 5.8 | G2/G3 |
| 6.8-03 | PPM confirmation | NOT IMPLEMENTED | — | Everything | 5.10, 5.11 | G4 |
| 6.8-04 | Access or gate pass | NOT IMPLEMENTED | — | Everything | 5.9, 5.11 | G4 |
| 6.8-05 | Job closure review | NOT IMPLEMENTED | — | Everything | 5.12 | G5 |
| 6.8-06 | Instalment overdue | NOT IMPLEMENTED | — | Everything | 5.8 | G3 |
| 6.8-07 | Renewal due | PARTIAL | Todo with title, deadline, owner (switched off) | Last-year summary, draft link, outcome actions, management after 15 idle days | — | G6 |
| 6.8-08 | Call out | NOT IMPLEMENTED | — | Everything | 5.13 | G5 |

## 6.9 Expected metrics

| ID | Metric | Status | Evidence | Missing | Blocker | Next |
|---|---|---|---|---|---|---|
| 6.9-01 | Enquiries by source, owner, month; conversion; lost reasons | NOT IMPLEMENTED | none | Data | 5.1 | G6 |
| 6.9-02 | Visits by status, technician, month; reasons; attempts | NOT IMPLEMENTED | none | Data | 5.10–5.12 | G6 |
| 6.9-03 | Allowance use; visits that became chargeable | PARTIAL | serviceAnalytics, ledger | Chargeable conversion | — | G6 |
| 6.9-04 | Additional works raised, approved, rejected; revenue | PARTIAL | Draft/issued/cancelled per contract | Approved, rejected, revenue | 5.14 | G6 |
| 6.9-05 | Call outs by priority, SLA, covered or chargeable | NOT IMPLEMENTED | none | Data | 5.13 | G6 |
| 6.9-06 | Contract profitability | NOT IMPLEMENTED | none | Data | Costs | G6 |
| 6.9-07 | Who changed each status and when | PARTIAL | `amc_audit_events` for proposals, contracts, quotes, usage | Enquiries, visits, call-outs, payments | — | all |

## 6.10 Project deliverables checklist

Test evidence below refers to `tests/amc/*.test.ts` (179 unit tests in all, including other modules) and the PostgreSQL harness `scripts/amc-db-harness/9*_verify_*.sql`.

**1. Enquiry pipeline, property, asset register, combined units, scope and site visit (5.1, 5.2): PARTIAL**
- **Implemented:** property category and size; frequency and duration; site visit with date, assessor, condition checklist, photos, recommended services.
- **Missing:** the whole enquiry pipeline (20 items); asset register; combined units; floors/zones; access constraints; preferred months; per-property exclusions; priced lines from the visit.
- **Business blockers:** site-visit rule, block or flag (BRD: to confirm).
- **External blockers:** none.
- **Code:** M/20261006130000 (customers, properties, assessments), M/20261006150000 (photos), X/amc-contracts/assessments.tsx, customer-pickers.tsx.
- **Tests:** business-operations.test.ts (10), business-completion.test.ts (photo rules), harness 96 and 97b.

**2. Governed rate card with floor rates, history and packages (5.3): NOT STARTED**
- **Implemented:** a priceless service catalogue in AMC Settings (admin-edited, audited).
- **Missing:** rates, floor rates, units, allowed frequencies, model pricing, price history with effective dates, packages, promotions, locked rates in the wizard, discount authority.
- **Business blockers:** none.
- **External blockers:** none.
- **Code:** X/amc/amc-settings.ts.
- **Tests:** pricing.test.ts and server-pricing.test.ts cover the typed-price calculation, not a rate card.

**3. Wizard linked to the prospect, versions, team visibility (5.4): PARTIAL**
- **Implemented:** unique numbers; payment terms label; proposal from a completed assessment with property prefill.
- **Missing:** prospect origin; proposal versions V1..Vn, locked versions and PDFs, reasons, summaries, active version; validity date; structured payment plan; team visibility.
- **Business blockers:** validity period (to confirm).
- **External blockers:** none.
- **Code:** api/amc-submissions/route.ts, lib/amc/business.ts.
- **Tests:** validation-and-numbers.test.ts, workflow.test.ts.

**4. Approval ladder; link by email or WhatsApp; decision recorded (5.5, 5.6): PARTIAL**
- **Implemented:** single-step approve and send back with audit; no sharing while pending; email link; client approve and reject with reason; locked after approval.
- **Missing:**
  - the four triggers, thresholds, levels, sequence, internal reject, escalation;
  - **no self-approval**;
  - prepared WhatsApp text and channel defaults;
  - multiple recipients; version in the send log;
  - a request-revision action; manual decision with evidence.
- **Business blockers:** thresholds and approvers per level (not decided).
- **External blockers:** none.
- **Code:** lib/amc/workflow.ts, api/amc-submissions/approval, send, api/amc/[token].
- **Tests:** workflow.test.ts (which still pins self-approval on), tokens.test.ts, public-payload.test.ts.

**5. Contract with commencement date and entitlements, signing routes, statuses; client profile with access rules, consent and documents (5.7, 5.9): PARTIAL**
- **Implemented:** contract document from data with scope, frequency, value, VAT, T&C, bank details; separate commencement date; entitlements for frequency and call-outs; typed-name client signing with an immutable archive; six of eleven statuses; customer profile with properties, contracts, services, allowances.
- **Missing:**
  - automatic contract creation; residential and commercial templates; contract number;
  - labour, material, value-limit and exclusion entitlements;
  - Zoho Sign or internal signatories, signing order, scan upload, unsigned reminders;
  - Pending Internal Signature, Pending Initial Payment, On Hold, Terminated;
  - amendments;
  - trade licence, TRN, contact roles, consent, communication log;
  - all access rules; a document store with category, version and expiry.
- **Business blockers:** Zoho Sign or internal tool; allowance scaling.
- **External blockers:** Zoho Sign if chosen; FSM contract visibility for Finance.
- **Code:** X/amc/amc-document-model.ts, lib/server/amc/contracts.ts, signed-archive.ts, M/20261006100000.
- **Tests:** active-contracts.test.ts (13), contract-operations.test.ts (17), harness 93, 94, 97b.

**6. Payment bands, schedule, cheques, initial payment gate, Zoho Finance view (5.8): NOT STARTED**
- **Implemented:** nothing beyond a payment-terms label.
- **Missing:** all 25 items.
- **Business blockers:** value bands (to confirm).
- **External blockers:** Zoho Finance integration (Finance: trigger and direction); PayTabs/NomuPay.
- **Code:** none.
- **Tests:** none.

**7. PPM schedule per service line with service windows and clubbing, adherence kept (5.10): NOT STARTED**
- **Implemented:** remaining-allowance counts only.
- **Missing:** a visit entity, generator, windows, holiday calendar, confirmation, adherence, clubbing.
- **Business blockers:** none.
- **External blockers:** none.
- **Code:** lib/amc/contracts.ts (counts).
- **Tests:** contract-operations.test.ts (counts only).

**8. Confirmation to-do, scheduling board, competency-based assignment, access status (5.11): NOT STARTED**
- **Implemented:** nothing for AMC visits. The generic scheduling board (drag and drop, technician change, publish to FSM) exists and shows an AMC coverage notice, but it has no AMC visit, attempt, competency or access model.
- **Missing:** 25 items not implemented, 10 partial through the generic board.
- **Business blockers:** standard durations (to confirm).
- **External blockers:** WhatsApp/SMS provider for automatic requests.
- **Code:** components/dashboard/scheduling/**, amc-work-order-notice.tsx.
- **Tests:** none for AMC.

**9. Offline FSM job with AMC checklist, supervisor closure, non-completion groups, partial completion per trade (5.12): NOT STARTED**
- **Implemented:** offline working, signature and timestamps are FSM-native; the portal has a manual completed-visit review that confirms usage.
- **Missing:** the AMC job-sheet fields in FSM; Submitted state; supervisor review and return; mandatory review rules; visit statuses; reason groups; per-trade partial completion; the 48-hour report.
- **Business blockers:** none.
- **External blockers:** FSM job-sheet configuration; the meaning of FSM "Completed".
- **Code:** lib/server/amc/fsm-integration.ts.
- **Tests:** fsm-integration.test.ts (13), harness 95.

**10. Reactive call outs with priority, SLA, coverage check and statuses (5.13): PARTIAL**
- **Implemented:** coverage check (covered / chargeable / no AMC); SLA definitions.
- **Missing:** a call-out record with intake, issue, photos, contact, priority, statuses and open-until-resolved; SLA clocks (non-emergency is coded as 6 h, the BRD says 48 h); emergency priority; SLA and misuse reporting.
- **Business blockers:** none (the BRD fixes 48 h).
- **External blockers:** FSM arrival and booking timestamps.
- **Code:** api/amc-contracts/coverage, lib/amc/sla.ts.
- **Tests:** active-contracts.test.ts (coverage), fsm-integration.test.ts (SLA).

**11. Additional work parties and findings, entitlement check, allowance reserve and consume with audit trail (5.14): PARTIAL**
- **Implemented:** quotes linked to contract and property with frozen discount; FSM estimate link; append-only usage ledger with corrections, reasons, audit; near-zero warning; over-use refused.
- **Missing:** origin from a visit or call-out; technician; finding versus commercial; photos; risk; the five parties; the full status flow; the 20% fee; client roll-up; reserve, release and consume-on-completion; authorised free/chargeable override; reset basis.
- **Business blockers:** reset basis (to confirm).
- **External blockers:** FSM estimates; Zoho Finance for invoiced/paid.
- **Code:** M/20261006100000, 110000, 130000; lib/server/amc/contract-operations.ts, business.ts.
- **Tests:** contract-operations.test.ts, business-operations.test.ts, harness 93, 94, 96.

**12. Client report, operational, commercial and profitability reports, dashboard (5.15): PARTIAL**
- **Implemented:** allowance use, renewals pipeline, contracts dashboard, 30/60/90-day expiry, in-force value, CSV/Excel export.
- **Missing:** the client report (all of it); 8 of 9 operational reports; 5 of 7 commercial; all profitability; delivery and workforce panels.
- **Business blockers:** none.
- **External blockers:** cost data (FSM labour hours, inventory, Finance).
- **Code:** lib/amc/business.ts, X/amc-contracts/amc-reports.tsx, contracts-summary.tsx.
- **Tests:** business-operations.test.ts, database-review.test.ts (dashboard figures).

**13. Renewal reminder, draft with history, outcomes, edge cases with approval (5.16): PARTIAL**
- **Implemented:** renewal draft from the contract through the normal flow; old/new link; renewals-due view; Renewed and Lapsed; reminder sweep (switched off); cancellation by approvers with a reason.
- **Missing:** a scheduled reminder and escalation; escalation percent; last-year history; three outcomes; hold, transfer, scope or property change, termination with 30-day notice and pro-rata refund.
- **Business blockers:** reminder schedule.
- **External blockers:** none.
- **Code:** lib/server/amc/renewal.ts, reminders.ts, contract-renewal.tsx.
- **Tests:** contract-operations.test.ts, business-completion.test.ts (reminders).

**14. Emails, notifications, messages, to-dos and roles (6.1, 6.2, 6.3, 6.7, 6.8): PARTIAL**
- **Implemented:** Emails 1 and 2 exist with partial content; 2 of 28 notifications complete and 4 partial; no-login client links; configurable roles.
- **Missing:**
  - Email 3 and the instalment email;
  - 22 notifications;
  - all prepared or automatic WhatsApp/SMS texts;
  - 6 of 8 to-dos;
  - department-head/Finance and override roles;
  - **no self-approval**.
- **Business blockers:** none.
- **External blockers:** WhatsApp Business / SMS provider (for automatic sending only).
- **Code:** lib/server/amc/notifications.ts, api/amc-submissions/send.
- **Tests:** business-completion.test.ts (notifications), security.test.ts.

---

## Comparison with `docs/amc-master-status-report.md`

The master report measured a different scope: the proposals-extension FRD, the brochure and the internal operational goals. Against BRD v0.3 it overstates completion in these places. Each has been corrected in that report (6 Oct 2026).

| # | Where | What it said | What the BRD audit shows |
|---|---|---|---|
| 1 | §4 headline | "26 of 34 implemented (76%)", "87%" counting halves | 78 of 524 BRD requirements (14.9%); 0 of 14 deliverables |
| 2 | §4 headline | "Proposal workflow 13 of 14 (93%)" | BRD 5.4–5.6: 11 of 48 implemented (23%) |
| 3 | §4 "No row is waiting on development that can be done without a decision or an FSM answer" | — | Most gaps need development with no blocker: enquiries, rate card, versions, approval ladder, payments, PPM, call-outs, client report |
| 4 | §1 "covers the whole commercial and operational life of an AMC" | — | No enquiry, rate card, payments, PPM schedule, visit confirmation or call-out record |
| 5 | §1 "What it cannot do yet is mostly not code" | — | Most of what is missing is code |
| 6 | §4 row 9 and §7 C2: self-approval a pending decision | IMPLEMENTED / decision | BRD 5.5 and 6.7 decide it: NOT IMPLEMENTED (switch is on) |
| 7 | §7 A10: 6 h vs 48 h a pending decision | decision | BRD 5.13 sets 48 h for scheduling. The code's 6 h is wrong |
| 8 | §4 row 10: client links "email/link" IMPLEMENTED | IMPLEMENTED | Single recipient, no prepared WhatsApp text, no request-revision action, no version |
| 9 | §4 rows 15–16, 27: notifications IMPLEMENTED | IMPLEMENTED | 2 of 28 BRD notifications |
| 10 | §4 row 18: entitlements IMPLEMENTED | IMPLEMENTED | Labour, material, value limits, exclusions missing; quantities ignored |
| 11 | §4 row 21: assessment IMPLEMENTED | IMPLEMENTED | Asset count, exclusions, access notes missing; lines unpriced |
| 12 | §4 row 22: contract lifecycle IMPLEMENTED | IMPLEMENTED | 6 of 11 statuses; no contract number, internal signatories, payment gate |
| 13 | §4 row 23: usage and coverage IMPLEMENTED | IMPLEMENTED | No reservation or release; no authorised override |
| 14 | §4 rows 25–26: renewals IMPLEMENTED | IMPLEMENTED | No escalation %, outcomes, edge cases, inactivity escalation; reminder unscheduled |
| 15 | §4 row 32: reporting IMPLEMENTED | IMPLEMENTED | 4 of 41 BRD report items |
| 16 | §11 "What remains in code is creating FSM estimates … and the final layout" | — | Six major goals remain (§Roadmap) |
| 17 | §12 "TOTAL MAJOR PROMPTS REMAINING: 2" | 2 | 6 |

## Roadmap

Derived only from the verified gaps above. Every goal assumes the security fixes and the 16 branch migrations are carried along. Their deployment (staging, UAT, production) is part of G6, and can be brought forward on its own at any point.

| Goal | Scope | Closes | Depends on |
|---|---|---|---|
| **G1 Client, property and asset foundation** | Property types and unit address, floors/zones, owner/tenant; asset register with service history; combined (parent/child) units; access rules per property; client profile (individual/company, trade licence, TRN, contact roles, marketing consent, communication log, FSM link); document store (category, version, expiry); site-visit asset count, exclusions, access notes; site-visit-assigned notification | 5.2, 5.9, parts of 6.2 | — |
| **G2 Lead-to-contract commercial engine** | Enquiry pipeline (stages, owners, follow-up log, idle alerts, lost reasons); governed rate card (rates, floors, units, frequencies, model, history with effective dates, packages, promotions, department head/Finance role); proposal from the prospect with priced lines; validity; versions V1..Vn with locked PDFs, reasons and summaries; **no self-approval (first change)**; four approval triggers, configurable levels, sequence, reject, escalation; sharing per version to several recipients, prepared WhatsApp texts, channel defaults, request revision, manual decision with evidence; Emails 1 and 2 in BRD form; contract number, templates, entitlement fields, internal signatories and order, scan upload, unsigned reminders, contract statuses, amendments; proposal/contract notifications and the approval to-do | 5.1, 5.3–5.7, 6.1 (1–2), 6.3 (1–2), 6.7 (2–5, 9), 6.8 (1–2) | G1 |
| **G3 Payments and Finance** | Value bands and plans with approval; instalment schedule on activation; statuses; cash, transfer, cheque register (custody, deposit, clearance, bounce, replacement); payment links; initial payment gate with named override; alerts, overdue to-do, client reminder, instalment email; Zoho Finance invoices, receipts, balance, ageing, resend | 5.8, 6.1 (instalment), 6.2 (payments), 6.3-06, 6.7-06, 6.8-06 | G2; Finance integration; PayTabs/NomuPay |
| **G4 PPM schedule, confirmation and assignment** | Visit entity and generator per service line from commencement; holiday calendar; cycles, windows, target and preferred dates; plan confirmation and adherence (original date); clubbing; confirmation to-dos, attempts, client requests, no-show rule, escalation; AMC visits on the scheduling board with bulk update; technician competency, location, vehicle, driver, tools, access; suggestion, double-booking prevention, override reason; FSM appointment creation; access status and reminders | 5.10, 5.11, 6.2 (schedule), 6.3-03/04/09, 6.8-03/04 | G1, G2 (entitlements), G3 (payment gate releases visits) |
| **G5 Execution, call outs, additional work and allowances** | FSM job-sheet AMC fields; Submitted state, supervisor review/return/close, mandatory rules; visit statuses, reason groups, partial per trade; Email 3 within 48 h; call-out record with intake, priority, SLA clocks (48 h), coverage told to client, statuses, open-until-resolved, misuse flag; additional work from visit/call-out with finding, parties, full status flow, 20% fee, roll-up; allowance reserve/consume/release, authorised overrides, reset basis | 5.12–5.14, 6.1 (3), 6.2 (visits, call outs, quotes), 6.3-05/07, 6.7-07/10/11, 6.8-05/08 | G4; FSM configuration and timestamps |
| **G6 Reporting, renewals and release** | Client report (templates, email, WhatsApp); operational, commercial and profitability reports; dashboard panels; renewal reminders scheduled with escalation, escalation %, last-year history, outcomes, edge cases (hold, transfer, scope/property change, termination with notice and pro-rata refund); notifications on portal home and inbox; metrics; then staging, UAT, production migrations, deployment and approved merge | 5.15, 5.16, 6.2 (renewals, placement), 6.8-07, 6.9; release | G1–G5 |

**Order.** Dependency order is G1 → G2 → G3 → G4 → G5 → G6, matching the original requirements document (commercial first). BRD 5.17 records that the AMC team recommends the operational core first, with management to confirm. That order is G1 → G4 → G5 → G2 → G3 → G6, with the payment gate added to G4's visits when G3 lands. Either order works with these goal boundaries. **Removing self-approval should be done first whichever order is chosen:** it is a one-line switch plus one test.

## Business decisions required

1. **Build order:** operational core first or commercial first (BRD 5.17).
2. **Approval thresholds and approvers per level** for each of the four triggers (BRD 5.5: "not decided").
3. **Payment value bands** and permitted plans (BRD 5.8: "to confirm").
4. **Proposal validity period** (BRD 5.4: "to confirm").
5. **Site-visit rule:** block or flag when a commercial visit is missing (BRD 5.2).
6. **Standard durations** per trade for assignment suggestions (BRD 5.11).
7. **Allowance reset basis** (BRD 5.14).
8. **Threshold metric values** (BRD 6.5, companion workbook).
9. **Signing route:** Zoho Sign or an internal signing tool (BRD 5.7).
10. **Allowance scaling:** do entitlements scale with asset quantities and term (open since October).
11. **Renewal escalation percent** default and the renewal reminder schedule (BRD 5.16).
12. **Who holds the department head, Finance, supervisor and override roles** (BRD 6.7).
13. Still open from earlier: final document layout sign-off; 5% VAT; existing signed rows AMC-2026-6886/6890/6891.

**No longer open (decided by the BRD):** self-approval is not allowed (5.5, 6.7). Non-emergency visits are scheduled within 48 hours (5.13).

## FSM / Zoho dependencies

- FSM job sheet AMC fields: per-asset checklist and photos, allowance flag, additional work, pending works with reason, client signature (BRD 3, 5.12).
- FSM timestamps for SLA: arrival and booking times; the meaning of "Completed" and whether appointments reopen.
- Creating FSM appointments from AMC visits and call-outs, with emergencies ahead of planned work.
- Creating the FSM customer on signing; making the signed contract visible to Finance in FSM (5.7, 5.9).
- FSM estimate creation for additional work (existing one-time quotation flow).
- FSM Assets per property, if property history is to come from FSM.
- Inventory link for consumables and parts.
- Zoho Sign, if chosen.

## Finance dependencies

- Zoho Finance integration: invoices and receipts per instalment, the trigger and direction (Finance is building it).
- PayTabs / NomuPay merchant setup, payment-link API and status callbacks.
- Cheque custody, deposit and clearance process ownership.
- Value bands, non-standard plan approvals, pro-rata refund rules.
- Cost data for profitability: labour hours (FSM), material cost (inventory), subcontractor and other direct costs.
- Finance co-ownership of the rate card.
