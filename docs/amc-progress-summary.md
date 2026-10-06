# AMC progress summary

*6 October 2026. For management and the client. Technical detail: `docs/amc-master-status-report.md`.*

## Where we are

- **Measured against the BRD v0.3 (23 Sep 2026), AMC is not functionally complete.** None of its 14 deliverable groups is complete: 9 are partly built and 5 are not started (rate card, payments, PPM schedule, visit confirmation and assignment, job closure). Of 524 individual requirements in our scope, 78 are built (15%) and 130 partly built. Details: `docs/amc-brd-v0.3-gap-analysis.md`.
- The earlier figures ("26 of 34 requirements", "proposal process 13 of 14") measured the older proposals specification, not the BRD, and are withdrawn.
- **Six major development goals remain** (master report §12). What is built today covers proposals, approval, client links and signing, contract activation, allowances and usage, renewal drafts, customers, assessments and reports.
- **Nothing is live yet.** The database changes are prepared and tested, but they have not been installed on the live system.

## What is done

- **Proposals, start to signature:**
  - per-service prices, discounts and 5% VAT;
  - services included at no charge (such as the 24/7 helpdesk);
  - monthly price based on the contract length;
  - account managers chosen from a saved list;
  - internal approval, then sending by email or link;
  - the client approves or rejects online, then signs the contract online;
  - proposal and contract in PDF and Word.
- **Notifications:**
  - approvers hear when a proposal needs their approval;
  - the owner hears when it is approved or sent back (with the reason), and when the client approves, rejects (with the reason) or signs.

  Each person sees their AMC notifications under a bell in the AMC screens; the main ones also arrive by email.
- **Signed contracts are kept:** when a client signs, the contract is stored privately, exactly as signed, with the client's typed name, date and time. It is marked as a typed-name acceptance, not a digital certificate. Contracts signed before this can be stored by hand.
- **Active contracts:** a signed proposal becomes a live contract with fixed dates and a frozen copy of what was signed. Each service's allowance is tracked, and the owner is alerted when an allowance runs low or runs out.
- **Day-to-day operations:**
  - recording visits;
  - correcting mistakes, with full history;
  - checking whether a request is covered;
  - expiry tracking, cancellation and renewals.
- **Contract-expiry reminders** at 60, 30 and 15 days: ready, but switched off until the schedule and recipients are agreed.
- **Customers, properties and free property assessments**, with private photos that are kept once the assessment is completed.
- **Additional services:** a check for whether a request is covered or discounted, and a quote record with the price breakdown.
- **Zoho FSM connection:** FSM work can be linked to a contract, and completed visits are reviewed and recorded as usage.
- **Reports:** expiring contracts, the renewal pipeline, account-manager portfolios and service usage, all exportable to Excel/CSV.
- **Quality:** 179 automated tests (including 25 security tests) and all database checks pass. The database design was checked for speed at about 10,000 contracts, and the database changes were tested against the live system's own behaviour.

## What is blocked

- **Fully automatic visit counting from Zoho FSM:** needs confirmation of what "Completed" means in FSM, whether visits can be reopened, and how handyman hours are approved.
- **Response-time tracking:** FSM does not yet supply request and arrival times.
- **Creating FSM estimates from the portal:** needs the FSM estimate fields.

## What needs business confirmation

1. **Non-emergency response time:** the BRD v0.3 now says scheduling within 48 hours, as the contract does. The brochure's 6 hours needs aligning.
2. Who receives contract-expiry reminders and allowance alerts by email, and whether reminders go out automatically.
3. Whether allowances grow with the number of units and with contracts longer or shorter than a year.
4. Renewal pricing: last year's prices or a rate card.
5. The discount on additional services: whether, how much, and on which services.
6. Who may record and correct usage, and who owns customer and property records.
7. Assessment rules, and whether photos are required.
8. The meaning of "additional fixed-price services" (clause 6.3).
9. 5% VAT, typed-name signature, the 30-day link validity, and the final document layout.
10. Whether the three early signed proposals are real or test data.
11. That the support phone numbers in AMC Settings are the real ones before contracts go out.

## What remains

The BRD v0.3 sets out much more than is built. Six major development goals remain, in dependency order:
1. Client, property and asset records: asset register, access rules, client profile and documents.
2. Lead-to-contract: enquiry pipeline, rate card, proposal versions, approval ladder (nobody approves their own proposal), sharing, and contract signing and statuses.
3. Payments and Finance: instalments, cheques, the first-payment gate, and Zoho Finance invoices and receipts.
4. PPM schedule: visits with service windows, client confirmation and technician assignment.
5. Visit execution and closure, call-outs with SLAs, additional work and allowance reservations.
6. Client and management reports, renewals, then a staging test round and release.

The security tightening is done in code (6 October). It goes live with the first release. The AMC team suggested building the operational core first (goals 1, 4, 5); management to confirm the order.
