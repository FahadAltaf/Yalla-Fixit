# Active AMC: user-testing checklist

Run on **staging or a local database**, never production, with the AMC migrations through `20261006130000` applied (runbook 7.1–7.10) and the `amc-hardening` branch deployed. Use two accounts: an **AMC user** (owns some proposals, not an approver) and an **AMC approver**. Check each item at desktop width and at phone width (about 375 px).

Tick the box when the result matches. Note anything that doesn't, with the contract number.

## Setup

- [ ] A signed proposal with dates, a recorded signature and at least: one PPM service (visits), handyman (hours), emergency call-out (unlimited), helpdesk (included).
- [ ] A second signed proposal owned by a different user.
- [ ] A legacy signed proposal (service rows without a base price), if one exists.

## 1. Contracts list

- [ ] Menu: Extensions → AMC contracts opens the list, with dashboard cards above it.
- [ ] Tabs show counts; each tab shows only its contracts; **All** shows pending proposals first, then contracts, and paging through All has no empty pages.
- [ ] Search finds a contract by customer name, Customer ID, property, contract number and account manager.
- [ ] The account-manager filter narrows the list; **Clear filters** resets search, filter and tab.
- [ ] Clicking the Contract, Customer, Property, Start, End and Value headers sorts the list (both directions).
- [ ] Coverage column shows the number of services and "N exhausted" in red when an allowance is used up.
- [ ] The AMC user sees only contracts from their own proposals; the approver sees all.
- [ ] Loading shows skeleton rows; an empty filter shows "No matching contracts".

## 2. Dashboard cards

- [ ] In force, Pending activation, Expiring soon, Expired and Allowance used up match the list's tabs.
- [ ] The value in force equals the sum of the in-force contracts' values (incl. VAT).
- [ ] Each card opens its filter. Recent usage lists the latest entries with links.

## 3. Activation

- [ ] From a pending row (kebab → Activate AMC) and from the signed proposal's page (Activate AMC).
- [ ] The dialog shows customer, Customer ID, property, value incl. and before VAT, signer and time, account managers, and every service with its allowance.
- [ ] The dates say they come from the signed proposal; changing one says "Changed from the proposal's dates".
- [ ] **Activate contract** stays disabled until the confirmation box is ticked and the period is valid.
- [ ] After activation the contract page opens; the proposal page now shows **Open contract**.
- [ ] Opening Activate AMC again for the same proposal (another tab) says it is already activated, with a link.
- [ ] A one-off short period (e.g. 6 to 20 of a month) activates without an error.
- [ ] Legacy proposal: the Commercial card's subtotal and discount add up to the fee; service prices are not 0.

## 4. Contract page: summary and coverage

- [ ] Status card shows the expiry label ("Expires in N days", etc.).
- [ ] Usage card shows visits left and hours left **separately**.
- [ ] Coverage table: every service with type, included, used, remaining, frequency, call-out class and state. Unlimited and included services show no progress bar or percentage.
- [ ] A future-start contract shows "Not started" states and a banner; Record usage is not offered.

## 5. Recording usage

- [ ] Record usage: the preview shows Included / Already used / Recording / Remaining after, and updates as the quantity changes.
- [ ] Unlimited service: Included and Remaining after read "Unlimited".
- [ ] Helpdesk (included) is not in the service list; a used-up service is disabled.
- [ ] More than what is left is refused with "Only N visits left on this service."
- [ ] Half a visit is refused; 1.5 hours is accepted.
- [ ] A date outside the contract period is refused.
- [ ] Choosing Work order without a reference keeps the button disabled.
- [ ] Recording the same work order twice against one service is refused.
- [ ] After saving, the table, the summary cards and the history update.

## 6. History and corrections

- [ ] History shows date and when entered, service, quantity, source, FSM reference, recorded by and notes; it pages and filters by service.
- [ ] There is no edit or delete anywhere.
- [ ] **Correct** on an entry: the dialog shows the entry; the reason is required; more than the entry is refused.
- [ ] After a partial correction the entry shows "N after corrections", and the correction row is amber, says what it corrects and shows the reason.
- [ ] After correcting everything, Correct no longer shows on that entry.
- [ ] The history timeline shows "Usage corrected" with the person and the reason.

## 7. Coverage check

- [ ] From the list: by Customer ID and by searching a contract. From a contract page: against that contract.
- [ ] Planned service on the contract with allowance left: **COVERED BY AMC**, with included, used, remaining.
- [ ] Service not on the contract: **CHARGEABLE**, Service: Not covered.
- [ ] Used-up service: **CHARGEABLE**, "allowance is used up".
- [ ] Date after the end: **NO ACTIVE AMC**, AMC status Expired. Before the start: Not started.
- [ ] Emergency call-out: shows the 2-hour attendance target with the status unknown.
- [ ] The AMC user cannot see another user's contract by entering that customer's ID (answers None).
- [ ] Nothing is recorded by a check (usage counts unchanged).

## 8. Cancellation (approver)

- [ ] The AMC user does not see Cancel contract.
- [ ] The dialog lists the consequences; Cancel stays disabled until there is a reason and the box is ticked.
- [ ] Afterwards: the cancellation banner with the reason; status Cancelled; Record usage gone; history and usage still visible; corrections still possible.
- [ ] Coverage check on the cancelled contract: **NO ACTIVE AMC**, AMC status Cancelled.

## 9. Renewal

- [ ] Renewal card timeline: This contract → Renewal proposal (Not started) → Renewed contract (Not yet).
- [ ] Create renewal proposal: the preview shows the new period starting the day after the end date, the services copied, any dropped services, both values and the pricing note.
- [ ] After creating: **Open renewal proposal** opens the draft in AMC proposals, pre-filled.
- [ ] Back on the contract, the button is replaced by **Open renewal proposal**; trying again (another tab) is refused.
- [ ] After the renewal is signed and activated: the old contract's timeline links the renewed contract; the new contract links back.
- [ ] A cancelled contract cannot be renewed.

## 10. Reminders, service levels, documents, account managers

- [ ] Renewal reminders card lists 60, 30 and 15 days before the end date as Planned, says reminders are switched off, and offers no Create button. No Todo appears.
- [ ] Service levels card shows the targets for the contract's call-out services with "Status unknown".
- [ ] Documents: View and PDF work for the proposal (brochure) and the contract; the card says no stored signed PDF is kept.
- [ ] Account managers on the contract match the signed proposal.

## 11. Phone width

- [ ] List: tabs scroll, the toolbar stacks, the table scrolls sideways inside its card.
- [ ] Contract page: header buttons wrap; cards stack; the coverage and history tables scroll inside their cards.
- [ ] Every dialog fits and scrolls; its buttons stay reachable.

## 12. Zoho FSM (needs migration 20261006120000 and a connected FSM)

- [ ] FSM service mapping page: everyone with AMC access sees it; only approvers can edit. **Find from a work order** lists the work order's FSM services; saving maps one; the same FSM service cannot be mapped to two AMC services.
- [ ] Contract → **Zoho FSM integration**: FSM customer Missing; **Link** with a real work order of this customer shows the FSM contact and its Customer ID, and warns if it differs from the proposal's Customer ID.
- [ ] **Link FSM work**: a work order of another FSM customer is refused; a line mapped to another AMC service is refused; the coverage verdict is shown; linking the same appointment twice is refused.
- [ ] The scheduling board's **Add entry**, after choosing a linked customer's work order, shows the AMC notice; for a customer without an AMC, nothing is shown.
- [ ] **Check FSM**: completed linked visits show **Needs review**; nothing is consumed.
- [ ] **Review** on a completed visit: Confirm records 1 visit; the usage history shows source **FSM (confirmed)** with the work order and read time. Confirming again (or **Check FSM** again) does not add a second entry.
- [ ] A handyman visit asks for the hours and shows FSM's duration only as a reference.
- [ ] An appointment recorded and later cancelled in FSM shows **Needs review**; Confirm adds an **FSM correction** referencing the original; the allowance returns.
- [ ] Upcoming visits lists future appointments of linked work that are on the scheduling board, with technicians.
- [ ] SLA column shows the target and **Unknown** with the reason.
- [ ] **Unlink** needs a reason; usage already recorded stays.


## 13. Customers and properties (needs migration 20261006130000)

- [ ] **Customers** (section bar) lists shared customer records; search finds them by name, Customer ID, phone and email; **New customer** creates one; a duplicate Customer ID (any case) is refused.
- [ ] Contract → **Customer and property**: "As signed" shows the snapshot; "Today" shows **Link**. **Create from the signed customer** makes a record from the snapshot and links it.
- [ ] Link the property the same way (pick one of the customer's properties, or create from the signed property). A property of another customer is refused.
- [ ] Edit the customer's phone on the customer page: the contract's "As signed" section is unchanged; "Today" shows the new phone.
- [ ] **Unlink** removes the live link only; the contract is otherwise unchanged.

## 14. Customer and property views

- [ ] Customer page: cards (contracts in force, active properties, current AMC value, quotes), every contract listed separately with property, dates, status, account manager, coverage and renewal stage; properties; assessments; quotes. Each links onward.
- [ ] A customer with two contracts on two properties shows both, and counts the customer once on Reports.
- [ ] Property page: current AMC with services and usage; previous contracts (a renewed contract stays listed); assessments; quotes; a link back to the customer.

## 15. Assessments

- [ ] **Assessments → New assessment**: pick a customer, then a property (or add one); the assessment opens with the checklist copied from Settings.
- [ ] Draft: change answers (OK / Attention required / Not applicable), notes, details and recommended services; **Save** keeps them.
- [ ] **Complete** stays disabled until the date, the property and every item are answered; after completing, nothing can be edited and **Delete draft** is gone.
- [ ] Editing a checklist item in Settings does not change a completed assessment's wording.
- [ ] Assessment history shows on the customer and property pages with date, assessor, status, summary and the proposal created from it.

## 16. Assessment → proposal

- [ ] **Create AMC proposal** on a completed assessment opens the proposal wizard with the customer, property and recommended services ticked; prices and dates are empty; the proposal goes through the normal approval.
- [ ] A second **Create AMC proposal** is not offered; the assessment links to the proposal.
- [ ] A property with unit type Townhouse or Other is refused with a message to set villa, apartment or office.
- [ ] When the proposal is signed and activated, the contract's "Today" links point at the same customer and property.

## 17. Additional services and discount

- [ ] Settings → **Additional-service discount** is Off with no rate; only approvers can change it; switching On without a rate is refused.
- [ ] Contract → **Additional service** with the discount off: **Check** shows "No discount configured" and the standard price as final.
- [ ] Choose a service that is on the AMC with allowance left: "Included in AMC", **Save quote** is disabled ("record it as usage").
- [ ] Turn the discount on (e.g. 20%, key `painting`): a "painting" request at AED 1,000 shows Standard AED 1,000 · 20% · saves AED 200 · Final AED 800; **Save quote** records it.
- [ ] A service not on the list: "Standard charge". An expired or cancelled contract: "Standard charge" with the reason.
- [ ] **Link FSM estimate** with a number that does not exist in FSM is refused; a real one links; the same estimate cannot be linked to two quotes.
- [ ] **Cancel** keeps the quote listed as cancelled; the commercial history counts discounts only for quotes with a linked estimate.
- [ ] The contract's **Commercial history** shows the original proposal, value, renewal proposal and quotes.

## 18. Reports, exports, navigation

- [ ] **Reports** cards match the contracts list; customers and properties count once each, with unlinked contracts shown apart; cancelled contracts are not counted.
- [ ] **Expiry**: contracts appear in the right bucket (Expired, 0–30, 31–60, 61–90, 90+); filters by account manager, customer and property narrow every tab.
- [ ] **Renewal pipeline**: a contract within 90 days shows Upcoming; after **Create renewal proposal** it shows Renewal proposal created; each proposal status moves the stage; a renewed contract shows Renewed.
- [ ] **Account managers** and **Services** tabs: hours and visits are on separate rows; unlimited shows use only.
- [ ] **Export** (CSV and Excel) on each tab and **Active contracts** downloads exactly the rows on screen.
- [ ] The section bar (Contracts, Customers, Assessments, Reports, Settings, FSM mapping, AMC proposals) is on every page; customer ↔ property ↔ contract ↔ assessment ↔ proposal ↔ quote links work both ways; no page shows a database id where a number or name exists.
- [ ] Phone width: tables scroll inside their cards; dialogs scroll; the section bar scrolls sideways.
