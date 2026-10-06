# AMC progress summary

*6 October 2026. For management and the client. Technical detail: `docs/amc-master-status-report.md`.*

## What is done

- **Proposals, start to signature:**
  - per-service prices, discounts and 5% VAT;
  - services included at no charge (such as the 24/7 helpdesk);
  - monthly price based on the contract length;
  - account managers chosen from a saved list;
  - internal approval, then sending by email or link;
  - the client approves or rejects online, then signs the contract online;
  - proposal and contract in PDF and Word.
- **Active contracts:** a signed proposal becomes a live contract with fixed dates and a frozen copy of what was signed. Each service's allowance is tracked: visits, hours, unlimited, or included.
- **Day-to-day operations:**
  - recording visits;
  - correcting mistakes, with full history;
  - checking whether a request is covered;
  - expiry tracking, cancellation and renewals.
- **Customers and properties:** a customer record, the property record, and a free property assessment that can start a proposal.
- **Additional services:** a check for whether a request is covered or discounted, and a quote record with the price breakdown.
- **Zoho FSM connection:** FSM work can be linked to a contract, and completed visits are reviewed and recorded as usage.
- **Reports:** expiring contracts, the renewal pipeline, account-manager portfolios and service usage, all exportable to Excel/CSV.
- **Quality:** 128 automated tests and database checks; all pass. The database design was reviewed for speed and safety at about 10,000 contracts, and the database changes were tested against the live system's own queries.

## What is in progress

- Final security tightening before go-live.
- Notifications: telling approvers, the team and customers at key moments.

## What is blocked

- **Fully automatic visit counting from Zoho FSM:** needs confirmation of what "Completed" means in FSM, whether visits can be reopened, and how handyman hours are approved.
- **Response-time tracking** (2 hours emergency, 6 hours non-emergency): FSM does not yet supply request and arrival times.
- **Assessment photos and a stored signed-contract file:** wait for private file storage.

## What needs business confirmation

1. Whether allowances grow with the number of units and with contracts longer or shorter than a year.
2. The renewal-reminder schedule and who receives the reminders.
3. Renewal pricing: last year's prices or a rate card.
4. The discount on additional services: whether, how much, and on which services.
5. Who may record and correct usage.
6. Who owns customer and property records.
7. Assessment rules, and whether photos are required.
8. The meaning of "additional fixed-price services" (clause 6.3).
9. 5% VAT, self-approval, typed-name signature, the 30-day link validity, and the final document layout.
10. Whether the three early signed proposals are real or test data.

## What remains before release

1. Security tightening (about one development cycle).
2. Remaining business features: notifications, stored documents, and the rules from the confirmations above.
3. Automatic FSM visit counting, once FSM confirmations arrive.
4. A test round on a staging copy, then installing the database changes and releasing.

**Four major development steps remain.** Steps 1 and 2 can start now.
