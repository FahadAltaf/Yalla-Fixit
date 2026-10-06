# AMC business operations: report

**Date:** 6 October 2026. **Branch:** `active-amc` (fourth commit, after `cad560e`, `2fc3159`, `8ea3775`). Not pushed or merged.
**Production:** not modified. Migration `20261006130000` is created, not applied. I ran read-only SELECTs only (row counts of `snagging_clients`, `snagging_properties`, `amc_submissions`).

This phase adds the AMC business management that does not depend on the open Zoho FSM questions:
- customers and properties;
- property assessments;
- additional services and the AMC discount;
- commercial history;
- reporting.

## 1. Customer architecture

**What exists:**
- **`snagging_clients`** (11 rows): name, email, phone, company, `crm_contact_id` (empty everywhere).
  - Reached only through `/api/snagging/clients`, gated by **Snagging** permissions.
  - Built for handover inspections.
- **AMC proposals** keep the customer as typed JSON on each proposal: customer name, Customer ID (free text), phone, email.
- **Contracts** snapshot that JSON.
- **Quotations** (FSM estimates) and **scheduling** identify customers by FSM contact and free-text names. Neither keeps a portal customer record.

**Decision:** Snagging's records are not reused for AMC.

**Why:**
- AMC users would need Snagging access to see or create a customer.
- The property side carries handover fields (developer, title deed, NOC, external areas), and its property types (apartment, villa, townhouse, commercial) do not match AMC's (villa, apartment, office).

Forcing AMC into them would bind two modules to the wrong model.

**Built:** shared, module-neutral **`customers`** (not `amc_customers`):
- name, Customer ID (unique, case-insensitive), company, email, phone, notes;
- `fsm_contact_id` (unique);
- `snagging_client_id` (unique, optional).

The last is the **convergence path**: when the same person exists in Snagging, the shared record points at it, rather than becoming an unrelated second customer.

**Migration path (not done here):**
1. Snagging adopts `customers`.
2. `snagging_clients` gains `customer_id` (or is replaced by a view).
3. Quotations and scheduling store `customer_id` when an FSM contact is matched (by `fsm_contact_id`, never by name).

**BUSINESS DECISION REQUIRED:** which module owns customer records, and who may edit them. Today any AMC user can create and edit them.

## 2. Property architecture

**`customer_properties`:**
- belongs to a customer;
- label ("Villa 12, Street 4"), address, community;
- category (residential/commercial), unit type (villa/apartment/townhouse/office/other), bedrooms, size;
- `snagging_property_id` (unique, optional): the same convergence path.

A property keeps its history: contracts and assessments point at it and are never moved.

## 3. Snapshot vs live relationship

`amc_contracts` and `amc_submissions` gain optional `customer_id` and `property_id`.

| | Snapshot (`customer`, `property` JSON) | Live link (`customer_id`, `property_id`) |
|---|---|---|
| Means | What was signed | Who and where they are today |
| Changes | Never | Re-linked or edited on the record |
| Shown | "As signed" on the contract | "Today", with links to the customer and property pages |

How links are set:
- **On a contract:** **Link** with an existing record, or **Create from the signed customer/property**. Customers are never matched by name automatically.
- **From an assessment:** proposals created from one carry the links.
- **Activation and renewal:** activation copies a proposal's links to the contract; a renewal proposal inherits the contract's.

Editing a customer or property never touches a signed contract. This is tested in code, and on Postgres: renaming the customer leaves the contract snapshot as signed.

## 4. Assessment workflow

`amc_assessments` (number `ASM-YYYY-NNNN`) links a customer, a property, the proposal created from it and, optionally, the contract it was made for.

**Recorded:**
- date, assessor;
- unit type, category, bedrooms, size, occupancy;
- summary, findings, notes;
- recommended services (AMC catalogue ids).

**Lifecycle: DRAFT → COMPLETED.**
- **Draft:** editable by its assessor or an AMC approver, and deletable.
- **Completed:** needs a date, a property, and an answer for every checklist item ("Not applicable" counts).
- **Afterwards:** the database refuses any change or deletion, except linking the proposal created from it.

**Attachments and photos: not built.** The portal's existing upload bucket is public, a known security finding, so it is not used for customers' properties. The page says so.

## 5. Assessment checklist

`amc_assessment_checklist`:
- category, item, order, active;
- editable by AMC approvers on **AMC contracts → Settings**;
- seeded with 12 short starting items: Air conditioning, Electrical, Plumbing, Handyman / general, Property condition.

Each new assessment copies the active items with their wording (`amc_assessment_items`), so later edits never rewrite a past assessment. Answers are OK, Attention required or Not applicable, each with notes.

This reuses Snagging's pattern of copying a checklist onto each job, but not its tables or jobs.

## 6. Proposal creation from assessment

**Create AMC proposal** on a completed assessment makes a normal **draft** in AMC proposals and opens it in the existing wizard. It pre-fills only:
- **Customer:** name, Customer ID, phone, email.
- **Property:** category, unit type, address, detail.
- **Services:** the recommended ones that the catalogue offers on that unit type are ticked, units 1, with the catalogue frequency. Others are listed as "not offered".

Not pre-filled:
- **Prices:** base prices are entered in the wizard, as for every proposal. The assessment's findings never set a price.
- **Dates:** agreed in the wizard.

It works once per assessment. A property whose unit type is not villa, apartment or office is refused with a clear message. Approval is unchanged.

## 7. Additional-service eligibility

`additionalServiceEligibility` takes a contract, a requested service, a date and a standard price. Outcomes:

| Outcome | When |
|---|---|
| `included_in_amc` | The service is on the contract with allowance left (or unlimited / included) on that date. Final price 0, no discount; no quote is saved ("record it as usage") |
| `amc_discount_eligible` | Contract in force, discount switched on with a rate, and the service key or category is on the discount list. A used-up AMC service falls through to here |
| `standard_charge` | Contract not in force (expired, cancelled, not started), or the service is not on the list |
| `not_configured` | Contract in force, but no discount is switched on (the default) |

The rate is configuration (**Settings → Additional-service discount**): off by default, no rate, listed services/categories only. **No 25% is assumed.**

## 8. Quotation integration

**The existing quotation workflow is Zoho FSM Estimates.**
- The portal reads them (Quotation templates) and clones them for revisions.
- It does not create new estimates, and it does not read FSM's service price list.

Creating estimates from the portal would require guessing FSM's required fields (territory, contact, catalogue services, prices, tax). So I didn't build it.

**Smallest safe integration:** **Additional service** on a contract:
1. Checks eligibility and shows the figures.
2. Saves an **additional-service quote** (`amc_additional_quotes`, number `AQ-YYYY-NNNN`) with the customer, property, service, the AMC contract and the calculation.
3. Staff create the estimate in Zoho FSM with those figures.
4. **Link FSM estimate**: the number is checked in FSM before linking.

Nothing is sent from the portal, and no second quotation system exists. **ADDITIONAL SERVICE FLOW: PARTIAL.** Creating the FSM estimate itself is manual.

## 9. Discount handling

The dialog, the quote list and the link dialog show the figures in full: standard price, AMC discount %, the saving, the final price. Rounding is half up to the fil.

The quote stores:
- the figures;
- the configuration used (enabled, rate, lists);
- the reasons;
- the time.

**The database freezes the calculation:**
- only the status, the FSM estimate link and notes can change;
- standard = final + discount is enforced;
- to change the figures, cancel the quote and make another.

Audit: `additional_quote_created`, `amc_discount_applied` (with the figures), `additional_quote_estimate_linked`, `additional_quote_cancelled`.

## 10. Dashboard

The contracts page keeps its cards: in force (with value), pending activation, expiring soon, expired, allowance used up, recent usage. It now links to **Reports**, which adds:
- active contract value, renewed, renewals in progress;
- low remaining (≤25% left on a visit/hour allowance);
- usage events (30 days);
- **customers with an AMC** and **properties covered**.

Customers and properties are counted once each, by their linked record. Contracts not linked to a customer or property are shown as a separate number, never guessed into the total. Cancelled contracts are excluded.

## 11. Analytics

**Services**, over contracts in force: one row per service **and unit**. It shows contracts that include it, included and used (visits or hours, in that unit), and exhausted count. Unlimited services show their use count only; included services show neither. Visits and hours are never added together.

## 12. Expiry reporting

Buckets:
- Expired
- 0–30 days
- 31–60 days
- 61–90 days
- 90+ days

Cancelled contracts are excluded. Filters: account manager, customer (name or Customer ID), property. Each row links to its contract and customer, with its renewal stage. Exportable.

## 13. Renewal pipeline

Stages are derived from the contract and its renewal proposal's status, so there is **no second status to maintain**:

| Stage | Derived from |
|---|---|
| Upcoming | No renewal proposal, within 90 days of the end (`RENEWAL_PIPELINE_WINDOW_DAYS`, a default) |
| Renewal proposal created | Proposal draft or sent back |
| Awaiting internal approval | `awaiting_approval` |
| Approved, not sent | `approved` |
| Sent to customer | `proposal_sent` |
| Rejected by customer | `proposal_rejected` |
| Approved by customer | `proposal_approved` |
| Contract sent | `contract_sent` |
| Signed, not activated | `signed` |
| Renewed | A successor contract exists |
| Expired without renewal | Past the end date, no proposal |

Past-the-end-date cases with a proposal in progress are flagged. Each row shows the old contract, customer, property, expiry, renewal proposal and account manager.

## 14. Account-manager reporting

Per manager named on the signed contract:
- active contracts;
- expiring within 90 days;
- renewals in progress;
- contract value in force;
- properties covered (plus unlinked contracts).

A contract with two managers counts for each. Contracts with none are grouped as "Unassigned". No commission is calculated.

**Customer view** (§19 of the brief): per linked customer, it shows:
- contracts, in force and historical;
- active properties;
- current AMC value;
- renewals;
- additional-service quotes, issued and draft.

It is not called lifetime value: the portal does not hold all revenue.

## 15. Exports

These use the portal's existing CSV/Excel export (`lib/snagging/export-table.ts`):
- active contracts (with customer, property, record links, coverage);
- expiry;
- renewal pipeline;
- account managers;
- service usage.

Each exports the rows on screen, filters applied.

## 16. Tests

`npm test`: **110 passed**. That is the 100 existing tests plus 10 new ones in `tests/amc/business-operations.test.ts`:
- **Customer and property:** the snapshot is unchanged when the live record changes; unknown unit types are not guessed.
- **Assessments:** draft, completion rules, summary.
- **Assessment → proposal:** customer, property and recommended services only; no prices or dates; once only; dropped services; unit type.
- **Discount:**
  - eligible, figures, rounding, by category, no price;
  - inactive or cancelled contract, included service, used-up service falling through;
  - standard charge, not configured.
- **Renewals:** every expiry bucket boundary; every pipeline stage, renewed, expired, overdue, cancelled.
- **Analytics:**
  - customers and properties counted once, unlinked counted apart, cancelled and expired excluded;
  - hours and visits separate, unlimited use only;
  - account-manager portfolio.

**Database rules,** checked on local Postgres with all migrations applied twice:
- customer ID uniqueness, and one Snagging client per customer;
- unit-type check;
- the snapshot does not follow customer edits;
- checklist seeded, assessment numbers;
- completed assessments: no completion without a date, then locked against change and deletion (proposal link still allowed);
- discount config: one row, needs a rate to switch on;
- quote figures add up, are frozen, and need an estimate number to be marked linked;
- new audit entity types;
- browser roles locked out.

## 17. Migrations

`20261006130000_amc_business_operations.sql`, **NOT APPLIED**. Apply after `20261006120000`. It is additive:
- new tables;
- nullable columns on `amc_contracts` / `amc_submissions`;
- triggers;
- one extended audit CHECK.

It changes no existing rows, except seeding the checklist and the one discount row (off). RLS is on, with no browser grants. Rollback notes are in the file.

Before the migration, the new screens show "Needs migration 20261006130000". Existing contract screens keep working.

## 18. Business decisions remaining

1. Which module owns customer and property records, who may edit them, and when Snagging adopts them.
2. The AMC discount on additional services: whether it exists, the rate, and which services or categories.
3. Whether creating the FSM estimate from the portal is wanted (it needs FSM's required estimate fields and catalogue prices).
4. Assessment: who may perform and complete one; whether every item must be answered (as now); whether photos are required once a private bucket exists.
5. The renewal pipeline window (90 days) and the low-remaining threshold (25%).
6. Whether "approved, not sent" and "rejected by customer" renewals need follow-up rules.

## 19. Deferred FSM automation

Unchanged from `docs/amc-fsm-integration-report.md`:
- automatic visit, hours and unlimited usage;
- automatic reversal;
- SLA attendance mapping;
- a scheduled FSM check.

All are off pending the business meaning of FSM completion and timestamps.

## 20. Deferred security work

- The public `uploads` bucket (also blocks assessment photos).
- `settings` exposing the Zoho token (fixed only by the unapplied `20261005160000`).
- Writable role tables, the Zoho edge functions, `/api/graphql` without authentication.
- New in this area:
  - any AMC user can create and edit shared customer records, and see every customer (not only those on their contracts);
  - contracts on customer and property pages are still limited to the user's own unless they approve.
