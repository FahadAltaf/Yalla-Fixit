# Active AMC: user-testing checklist

Run on **staging or a local database**, never production, with migrations `20261006100000` and `20261006110000` applied and the `active-amc` branch deployed. Use two accounts: an **AMC user** (owns some proposals, not an approver) and an **AMC approver**. Check each item at desktop width and at phone width (about 375 px).

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
