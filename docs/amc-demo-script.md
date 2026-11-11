# AMC demo script (BRD v0.3)

The click-by-click story of the client demo (implementation plan §2), on the demo portal (branch `amc-hardening`) against the database the demo uses. Every step is done through the app; nothing is seeded with SQL (plan §1.8).

**Before the demo:** apply migrations rows 19 to 29 in order (`docs/production-migration-log.md`, checks in `docs/production-migration-checks.md` §11 to §21). Then work through "Prepare" below.

---

## People

Sign in as each role in its own browser profile, so you can switch without signing out. The names are whoever plays them. Approvers, supervisors and Finance are named in AMC configuration; roles are set in Permissions.

| Role | What their role needs | Used in steps |
|---|---|---|
| **Coordinator** (owner of the proposal and contract) | AMC Proposals, Contracts, Clients, Site visits, Visit board, Call outs, Additional work, Renewals (View, Create, Edit) | 1–3, 5–15 |
| **Level 1 approver** (AMC department head) | AMC (Approve); named as level 1 in AMC configuration → Approvals | 4, 15 (amendment), 11 (supervisor fallback) |
| **Level 2 approver** (management) | Named as level 2 | 4, 15 (renewal escalation) |
| **Supervisor** | AMC Visits (Approve), or named in AMC configuration → Scheduling → Supervisors | 11 |
| **Finance** | AMC Payments (View, Create, Edit, Approve); named in AMC configuration → Payments | 8 |

The email redirect must be on, so every client email lands in the test inbox (AMC operations settings / environment). WhatsApp texts are prepared and opened with a link, never sent by the portal.

---

## Prepare (through the app, the day before)

1. **AMC configuration:**
   - Approvals: level 1 and 2 approvers and the discount thresholds, so a 12% discount goes to level 2.
   - Payments: the value band and plans, and the Finance users.
   - Calendar: weekend and holidays.
   - Scheduling: service window days, confirmation lead days, attempts, and the supervisors.
   - SLA, Allowances, Renewals (lead time 30 days, escalation 5%), Additional work (20%), Client report.
2. **Rate card:** publish a card with floor rates and one package.
3. **Technicians:** give two technicians the AC trade (competent) and one the plumbing trade.
4. **A contract near its end:** to show the renewal live (step 15), activate one contract whose end date falls inside the renewal lead time (any start date; for example 11 months ago to 20 days from now).
5. **Run the daily jobs once:** AMC configuration → Roles and jobs → "Run now". This creates the renewal to-do and the 30-day notice for that contract.

**Records worth having, so every stage shows (BRD 6.10):**
- one enquiry in each stage, one marked Lost with a reason, one idle;
- one proposal at each status (draft, awaiting approval, sent back, sent, rejected, approved, signed);
- contracts in each status (pending signature, pending initial payment, active, on hold, expired);
- one paid instalment, one overdue instalment, one bounced cheque;
- one confirmed schedule;
- one call out closed;
- one renewal outcome recorded.

---

## The story

Each step names who acts, where, what to click, and what the audience should see.

### 1. Enquiry (Coordinator)
1. AMC → **Enquiries** → New enquiry. Enter source Website, contact name, phone, WhatsApp, need "AC and plumbing upkeep", owner yourself. Save.
   - *See:* "New enquiry assigned" in the bell.
2. Move it through the stages, add a follow-up date and a note.
   - *See:* the stage history.
3. Point at the idle one prepared earlier.
   - *See:* the Idle flag (BRD 5.1).

### 2. Prospect (Coordinator)
1. On the enquiry, create the client and the property (or pick the Snagging client and address: one client master).
2. AMC → **Clients** → the client → the property:
   - add two assets (AC split units, water heater);
   - add an access rule (gate pass, community security).
3. For a commercial prospect: AMC → **Site visits** → New, assign the assessor, record findings and recommended services, then Complete.

### 3. Proposal (Coordinator)
1. From the enquiry or client, **Create proposal**. The wizard opens with the client and property filled in.
2. Choose the package from the rate card, set units and frequencies, and add a 12% discount.
   - *See:* the rate card price and the floor warning.

### 4. Approval (Level 1, then Level 2)
1. Coordinator: **Submit for approval**.
   - *See:* the triggers crossed (discount above the level 1 and level 2 thresholds).
2. Level 1 approver: bell → approve.
   - *See:* "approved at level 1, waits for level 2".
3. Level 2 approver: approve.
4. Show that the coordinator cannot approve their own proposal (BRD 5.5).

### 5. Sharing (Coordinator)
1. Proposal → **Share**: email to two contacts (Email 1) and **WhatsApp** (prepared text, opens wa.me).
   - *See:* the Send log rows (email sent, WhatsApp prepared) and the email in the test inbox.

### 6. Decision (client link)
1. Open the approval link from the test inbox. Choose **Request revision** with a reason.
   - *See:* the coordinator gets "prospect decision recorded"; V2 is created, and V1 stays locked with its PDF.
2. Share V2. The client **Approves**.

### 7. Contract (Coordinator, client, internal signatory)
1. The contract is created with its number and entitlements (scope, frequencies, what each covers).
2. **Send for signature** (Email 2). The client signs on the link, then the internal signatory signs.
3. Show the unsigned reminder:
   - *See:* the Contract follow-up to-do.

### 8. Payments (Finance)
1. Contract → **Payments**: the plan from the value band, and the instalment schedule.
   - *See:* the contract is in Pending initial payment.
2. Record instalment 1 (or a cheque).
   - *See:* the contract becomes Active and the prospect becomes a client.
3. Show an overdue instalment:
   - *See:* the reminder (Email 4) and the Installment overdue to-do.
4. Show a bounced cheque.

### 9. PPM schedule (Coordinator)
1. Contract → **Schedule**: the tentative visits with service windows, and holidays skipped.
2. Move a visit inside its window, club two services, then **Confirm the schedule**.

### 10. Confirmation and assignment (Coordinator)
1. Visit → **Confirmation**: request confirmation (prepared WhatsApp) and log attempts.
   - *See:* the PPM confirmation to-do.
2. **Access**: mark the gate pass requested, then approved, with validity.
3. AMC → **Visit board**: place the visit.
   - *See:* the suggested competent technician, and blocked ones with their reasons (leave, double booking, missing skill).

### 11. Visit closure (Coordinator, then Supervisor)
1. Visit → **Job sheet**:
   - arrival and completion;
   - per-trade outcomes: AC completed, plumbing not completed with reason group "Access failure → Building";
   - checklist, before and after photos, consumables, an additional work found, and the client's signature name.
2. **Submit for review**.
3. Supervisor: AMC → **Job reviews**.
   - *See:* the review reasons (incomplete scope).
4. **Close**:
   - *See:* the visit is Partially completed;
   - *See:* a remainder visit for plumbing appears in the schedule;
   - *See:* the service report PDF is stored and Email 3 is in the test inbox.
5. Show **Return with comment** on another sheet.

### 12. Call out (Coordinator)
1. AMC → **Call outs** → Log call out: emergency, WhatsApp, "No cooling".
   - *See:* the coverage answer before confirming (covered, 2 of 4 left), the SLA deadline (120 min) and the acknowledgement text.
2. Schedule it.
   - *See:* the technician suggestion.
3. Record the attendance. Record the diagnosis with parts needed.
   - *See:* the prompt to raise additional work.
4. **Raise additional work**:
   - five parties (tenant requests and pays, owner approves);
   - a quotation with labour and material.
   - *See:* the 20% handling fee.
5. **Share** (quotation PDF to the approver), then **Approve** with evidence, **Complete**, **Invoice**, **Paid**.
   - *See:* the call out resolves, then close it.

### 13. Allowances (Coordinator)
1. Contract → **Call outs** tab.
   - *See:* each allowance's used, booked and remaining counts with the near-zero warning, and the movements: Booked at logging, Used at closing, Released on a cancelled call out.

### 14. Reporting (Coordinator or management)
1. AMC → **Reports** → **Dashboard**: pipeline, contracts, approvals, delivery, workforce, commercial, renewals 30/60/90.
2. **Operations** for this month: adherence, backlog by reason group, call outs SLA, contracts at risk, utilisation, allowance use, access failures. **Export** one table to Excel.
3. **Commercial**: enquiries by source and owner, conversion, discounts by level, signed value, ageing, cheques, additional-work revenue, renewals.
4. Contract → More → **Preview client report**, then **Send client report**.

### 15. Renewal (Coordinator, Level 1 and Level 2)
1. AMC → **Renewals**: the contract prepared earlier shows as Due.
   - *See:* the suggested total +5%.
   - *See:* the "Renewal due" to-do with last year's summary.
2. Contract → **Renewal**: last year beside the draft. **Start renewal**.
   - *See:* the draft escalated 5%, which goes through the normal flow (steps 3 to 8).
3. Record **Under negotiation**, then later show an outcome (Renewed is set when the new contract starts).
4. Contract → **Amendments** → request a **Hold** with a reason. Level 1 approves; the coordinator cannot approve their own. **Apply**.
   - *See:* the contract is On hold, and no confirmations go out.
5. Request an **Early termination**. The approver ticks "valid reason".
   - *See:* the effective date 30 days on and the pro-rata refund.

### 16. Throughout
- **Bell and home page:** notifications until opened, then the inbox.
- **Todos:** the eight AMC to-do kinds with their escalation.
- **Roles:** sign in as Finance to show the payment screens without the proposal approvals, and as the supervisor to show Job reviews.
- **Status history:** on any record, who changed each status and when (BRD 6.9).

---

## Not in the demo (Phase 15, blocked on external answers)

- Zoho Sign;
- PayTabs/NomuPay payment links;
- Zoho Finance invoices and receipts;
- pushing visits, call outs and contracts into Zoho FSM;
- the FSM job-sheet fields and offline behaviour;
- SLA times from FSM;
- profitability;
- automatic WhatsApp/SMS sending (the texts are prepared and opened by link).
