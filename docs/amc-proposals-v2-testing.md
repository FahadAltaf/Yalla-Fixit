# AMC Proposals v2 — Testing Guide

How to test the v2 build end to end before it goes to production. Every test
maps to an acceptance criterion in §13 of the FRD, so a completed run of this
guide is also the sign-off record.

Allow **about 90 minutes** for a first full pass.

---

## 0. Test locally, not on production

The database in `.env` (`sxzpigyphjotuubxpooj`) is **production**. Do not run
this guide against it.

Five migrations are untested against real data, and two of them rewrite
existing rows — one remaps every submission's status, one renumbers
proposals. The repo already has the rule for this in
[`LOCAL-SUPABASE.md`](LOCAL-SUPABASE.md): *test migrations locally before
applying them to production.* This guide follows it.

> **Email is the one thing that is not local.** AMC mail goes out through
> **Resend**, not Supabase, so the local inbox at `http://127.0.0.1:54324`
> will **not** catch it — anything you email is really sent. Either email a
> test inbox you own, or use **Copy link** instead (tests below use it
> wherever email is not the thing being tested). The local inbox *is*
> useful for one thing: the sign-up confirmation emails in §1.

---

## 1. Setup

### 1.1 Start the local stack

Docker Desktop must be running.

```powershell
npm run supabase:start
npm run supabase:status
```

Copy the local **anon** and **service_role** keys from the status output into
`.env.local`:

```env
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<local anon key>
SUPABASE_SERVICE_ROLE_KEY=<local service role key>
NEXT_PUBLIC_APP_URL=http://localhost:3032
APP_URL=http://localhost:3032
```

`localhost:3032` is correct **for local testing only** — the client links
open in your own browser. It must change before production (§5).

### 1.2 Apply every migration

```powershell
npm run supabase:reset
```

This rebuilds the database from `supabase/migrations/` in filename order,
including the five AMC v2 migrations:

| Order | File | Phase |
|---|---|---|
| 1 | `20260915120000_amc_harden_submissions.sql` | 0 — row-level security |
| 2 | `20260915130000_amc_settings_and_audit.sql` | 3 — settings and audit trail |
| 3 | `20260916100000_amc_approval_flow.sql` | 4 — nine statuses, approver policy |
| 4 | `20260916105000_amc_proposal_numbers.sql` | 1.7 — server-allocated numbers |
| 5 | `20260916110000_amc_client_links.sql` | 5 — tokens, decisions, signature |

**Stop here if the reset prints any error.** A migration that fails locally
will fail in production too.

### 1.3 Run the app

```powershell
npm run dev
```

Open `http://localhost:3032`. Supabase Studio (for the SQL below) is at
`http://127.0.0.1:54323` → **SQL Editor**.

### 1.4 Create two test users

You need **two** people, because the approver must be a different person
from the one who writes the proposal (see finding **K1** in §6).

1. Sign up twice at `http://localhost:3032/auth/signup`, e.g.
   - `amc.writer@test.local` — writes proposals
   - `amc.approver@test.local` — approves them
2. Confirm both from the local inbox at `http://127.0.0.1:54324`.

### 1.5 Let them into the AMC module

Access to the module is an email allowlist held in code (FRD §4 keeps it out
of scope). Add both test addresses **locally only — do not commit this**:

`components/dashboard/extensions/amc/amc-constants.ts` →
`AMC_CONTRACTS_ALLOWED_EMAILS`

```ts
  "amc.writer@test.local",
  "amc.approver@test.local",
```

### 1.6 Give them roles

In Studio → SQL Editor:

```sql
-- The writer is an admin, so they can also reach AMC Settings.
update public.user_profile
   set role_id = (select id from public.roles where name = 'admin')
 where email = 'amc.writer@test.local';

-- The approver is deliberately NOT an admin: admins pass every permission
-- check, which would hide whether the AMC approve permission works at all.
insert into public.roles (name, description)
values ('amc_approver', 'AMC approver (test)')
on conflict do nothing;

insert into public.role_access (role_id, resource, action, enabled)
select r.id, v.resource, v.action, true
  from public.roles r
 cross join (values ('extensions','view'), ('amc','view'), ('amc','approve'))
        as v(resource, action)
 where r.name = 'amc_approver'
on conflict (role_id, resource, action) do nothing;

update public.user_profile
   set role_id = (select id from public.roles where name = 'amc_approver')
 where email = 'amc.approver@test.local';
```

Sign out and back in as each user so their role is picked up.

---

## 2. Check the migrations landed correctly

Run each in Studio. **Every expected value must match** before you continue.

**2.1 Exactly one status rule, with all nine statuses.** If the old
`('draft','generated')` rule survived alongside the new one, every Submit
for Approval fails — both rules apply, and the old one forbids every new
status.

```sql
-- Both the old and the new status rules list 'draft'; nothing else does.
select conname,
       pg_get_constraintdef(oid) ilike '%awaiting_approval%' as is_new_rule,
       pg_get_constraintdef(oid) ilike '%generated%'         as is_old_rule
  from pg_constraint
 where conrelid = 'public.amc_submissions'::regclass
   and contype = 'c'
   and pg_get_constraintdef(oid) ilike '%''draft''%';
```
Expect **exactly 1 row**, with `is_new_rule = true` and `is_old_rule = false`.

**2.2 The public cannot read the table.**

```sql
select count(*) as anon_policies
  from pg_policies
 where tablename = 'amc_submissions' and 'anon' = any(roles);
```
Expect **0**.

**2.3 Every proposal has a unique number.**

```sql
select count(*) - count(distinct proposal_number) as duplicates,
       count(*) filter (where proposal_number is null) as missing
  from public.amc_submissions;
```
Expect **0 and 0**.

**2.4 Settings and audit trail exist.**

```sql
select (select count(*) from public.amc_settings)                        as settings_rows,
       (select count(*) from pg_rules where tablename = 'amc_audit_events') as audit_rules;
```
Expect **1 and 2**.

**2.5 The audit trail cannot be rewritten.**

```sql
insert into public.amc_audit_events (entity_type, event_type) values ('settings', 'probe');
update public.amc_audit_events set event_type = 'tampered' where event_type = 'probe';
delete from public.amc_audit_events where event_type = 'probe';
select event_type from public.amc_audit_events where event_type in ('probe','tampered');
```
Expect **one row, still reading `probe`** — the update and delete were
silently refused. The probe row stays in your local audit table for good;
that is the point, and it is harmless locally. Never run this in production.

---

## 3. Functional tests

Sign in as **amc.writer** unless a step says otherwise. Go to
**Extensions → AMC Proposals**.

Mark each ☐ as you go. The **§13** column is the FRD acceptance criterion
the test signs off.

### A. The wizard

| # | Steps | Expected | §13 |
|---|---|---|---|
| A1 | Start a new proposal | The step indicator shows exactly three steps: **Property & Customer**, **Services & Pricing**, **Review & Submit** | ☐ 1 |
| A2 | Go through all three steps | No package picker anywhere. Step 2 opens straight on the service table | ☐ 2 |
| A3 | Step 1: leave **Customer ID** blank, press Continue | Blocked with *"Customer ID is required"* | ☐ |
| A4 | Step 1: look at **Proposal Number** | Read-only, reads *"Assigned automatically when saved"*. Continue to step 2, then back: it now shows **`AMC-2026-0001`** on a fresh database, and counts up from there | ☐ |
| A5 | Unit type **Apartment** | Water pump, roof drain and water tank rows are hidden, with a notice naming them | ☐ |

### B. Pricing — the FRD's own example

| # | Steps | Expected | §13 |
|---|---|---|---|
| B1 | Tick **AC PPM**. Base Price **100**, Units **5**, Frequency **5** | Price reads **2,500.00** the moment you type — no save needed | ☐ 3 |
| B2 | Tick a second service, leave Base Price **blank**, press Continue | Blocked: *"Enter a base price for every selected service"* | ☐ 4 |
| B3 | Set that blank Base Price to **0** | Accepted. Price reads 0.00 — zero is valid for a free service | ☐ 4 |
| B4 | Every other ticked row | No price shows 0 unless its base price is 0 | ☐ 4 |
| B5 | Discount **10%** | Subtotal, discount amount and final price all update, and final = subtotal − discount | ☐ |

### C. What the documents say

On step 3, use **Preview proposal** / **Preview contract**. Each opens a PDF in
a new tab.

| # | Steps | Expected | §13 |
|---|---|---|---|
| C1 | Tick exactly **3** services, preview both documents | Exactly those 3 appear. Nothing unticked is printed | ☐ 5 |
| C2 | Set AC PPM frequency to **5**, preview | Prints **5 per year** — not 1. *(This was the v1 bug in FR4.2.)* | ☐ 5 |
| C3 | Search both PDFs for **"package"** | No mention of an AMC package anywhere | ☐ |
| C4 | Fill both **Account Managers**, preview contract | Clause 1.1 names them with their numbers | ☐ |
| C5 | Untick **24/7 Technical Support Hotline**, preview contract | The 24/7 wording in clause 1.1 is gone | ☐ 7 |
| C6 | Leave **Supply and installation price list** off, preview contract | Clause 6.2 does not appear at all | ☐ 7 |
| C7 | Switch it on, fill **one** of the three rows, preview | Clause 6.2 appears with **only that one row** | ☐ |
| C8 | Search the contract PDF for **"XXX"** | See **C9** — this fails until Settings are filled | ☐ 6 |
| C9 | As admin: **Extensions → AMC Settings**, replace the contact numbers and both coordination emails with real values, save. Preview again | No **"XXX"** anywhere | ☐ 6 |
| C10 | Preview both documents | The proposal's *Services included* table and the contract's *6.1 Scope of work* table both have **Units** and **Price (AED)** columns. AC PPM at 100 × 2 units × 4 visits reads **800.00** | ☐ 5 |
| C11 | Tick **Free Handyman Service**, frequency **12**. Preview the contract | Clause 2.9 reads *"Up to **12 hours per year** of handyman service…"* — no mention of a package | ☐ |
| C12 | Tick **Non-Emergency Call-out**, frequency **6**. Preview the contract | Clause 3.2 ends *"(**6 free non-emergency visits per year** are included.)"* and clause 1.1 reads *"**6 free non-emergency call-outs per year**…"*. *(Non-emergency is now a counted service — its frequency box is editable.)* | ☐ |
| C13 | Untick **Emergency Call-out**, preview the contract | Clause 1.1 no longer promises *"Unlimited emergency call-outs"* | ☐ 5 |

### D. Internal approval

| # | Steps | Expected | §13 |
|---|---|---|---|
| D1 | Step 3 → **Submit for Approval** | Lands on My Submissions, status **Awaiting approval** | ☐ 8 |
| D2 | Open that row's menu | **Edit** is gone — it is locked while under review | ☐ |
| D3 | Sign in as **amc.approver**. Open AMC Proposals | The writer's submission is in the list, even though it is not theirs | ☐ 14 |
| D4 | Approver: **Send back…**, try to confirm with the reason empty | The Send back button stays disabled | ☐ 9 |
| D5 | Enter a reason, send back | Status **Sent back**, and the reason shows under the status | ☐ 9 |
| D6 | As **writer**: the row shows the reason and **Edit** is back. Fix it and resubmit | Status **Awaiting approval** again, reason cleared | ☐ |
| D7 | As **approver**: **Approve** | Status **Approved** | ☐ 9 |
| D8 | Before approving anything: is anything reachable by the client? | No send action exists on any row until it is Approved | ☐ 8 |

### E. The client's side

Use **Copy link** so nothing is emailed. Open each link in a **private /
incognito window** — that is what "without an account" means.

| # | Steps | Expected | §13 |
|---|---|---|---|
| E0 | **Before** filling in AMC Settings (C9): on an Approved row, **Copy proposal link** | Refused: *"AMC Settings still has placeholder values (XXX)…"*. Status stays **Approved** — nothing with XXX can reach a client | ☐ 6 |
| E1 | Writer: on the Approved row, **Copy proposal link** | Toast confirms it copied. Status **Proposal sent** | ☐ |
| E2 | Open the link in a private window | The proposal shows, with no login prompt and no dashboard | ☐ 10 |
| E2a | Look below the action bar | The whole proposal is shown on the page, laid out as in the Review & Submit preview and dated the day it was **sent**. **Download PDF** saves the same document as a PDF | ☐ |
| E2b | Same link on a phone (or DevTools device mode) | The document fits the screen width with no sideways scrolling; pinch to zoom in | ☐ |
| E2c | **Approve proposal** | Asks **Who is responding?** first, then **Confirm approval** — the same two steps as a snagging quotation | ☐ |
| E3 | **Request changes**, try to submit with name or reason blank | Blocked until both are filled | ☐ |
| E4 | Instead: enter a name, **Approve proposal** | *"Proposal approved — thank you"*. Status **Proposal approved** | ☐ 10 |
| E5 | Reload the same link and try again | Shows the outcome. There is no way to answer twice | ☐ |
| E6 | Writer: **Copy contract link**, open it privately | The whole contract is shown below **Sign contract**; signing asks for a full name, then **Confirm and sign** | ☐ |
| E7 | Type a name, **Sign the contract** | *"Signed — thank you"*. Status **Signed** | ☐ 10 |
| E8 | Open `http://localhost:3032/amc/not-a-real-token` | *"This link is not available"* — no document, no error details | ☐ |

**Email (optional, sends a real email).** On a fresh Approved submission
whose customer email is **an inbox you own**, choose **Email proposal to
client**. The email should arrive with a working **Review the proposal**
button.

### F. Statuses

| # | Steps | Expected | §13 |
|---|---|---|---|
| F1 | Across sections D and E, note each status shown | You saw, in order: Draft → Awaiting approval → (Sent back →) Approved → Proposal sent → Proposal approved → Contract sent → Signed | ☐ 11 |
| F2 | Run a second proposal to E3 and **reject** it with a reason | Status **Proposal rejected** | ☐ 11 |

### G. Settings — the text a sent document keeps

This is FR6.4, the most important behaviour in the release and the easiest
to get wrong. Follow the steps exactly.

| # | Steps | Expected | §13 |
|---|---|---|---|
| G1 | Admin: AMC Settings → **Clause 8 — Termination**, add **`TEST-ONE`** at the end, save | Toast confirms 1 field updated. The field shows **Customised** | ☐ |
| G2 | New draft → preview the **contract** | Clause 8 ends with **TEST-ONE** | ☐ 12 |
| G3 | Take that draft through to **Proposal sent** (sections D and E1) | — | ☐ |
| G4 | Admin: change `TEST-ONE` to **`TEST-TWO`**, save | — | ☐ |
| G5 | Open the **sent** submission → **View contract** | Still reads **TEST-ONE** — a sent document keeps its text | ☐ 12 |
| G6 | Start another new draft → preview the contract | Reads **TEST-TWO** — new proposals use the new text | ☐ 12 |
| G7 | Admin: **Reset** clause 8 | Back to the shipped wording, **Customised** badge gone | ☐ |
| G8 | Sign in as **amc.approver** (not an admin) | **AMC Settings** is not in the Extensions menu | ☐ |
| G9 | Admin: after G1 and G4, look at **Recent changes** at the bottom of AMC Settings | Two entries, newest first, each with your name, the time and a **Clause 8 — Termination** tag (FR6.5) | ☐ |
| G10 | Admin: **Clause 1.3 — Working hours**, change 6:00 PM to 7:00 PM, save; preview a new contract | Clause 1.3 prints 7:00 PM. Reset it afterwards | ☐ |
| G11 | New draft with **Emergency** unticked → preview the contract | Clause 1.1 has no “Unlimited emergency call-outs” line; tick it and the line returns | ☐ |

### H. Saved submissions

| # | Steps | Expected | §13 |
|---|---|---|---|
| H1 | Fill a draft completely, **close the browser tab** mid-step, reopen it from My Submissions | Everything is there, including every base price | ☐ 13 |
| H2 | Edit it and continue | Still one row in My Submissions — the same record was updated, not a copy made | ☐ 13 |
| H3 | Note the proposal number, edit and save several times | The number never changes | ☐ |

---

### I. Document design, PDF and Word

| # | Steps | Expected | §13 |
|---|---|---|---|
| I1 | Wizard → Review & Submit → Proposal and Contract tabs | Cover page first, then the Yalla Fix It logo with the ISO 14001 / 9001 / 45001 badges, red banner, red-headed striped tables | ☐ |
| I2 | **Preview contract** → **Download PDF** | A4 PDF: cover, then pages each with the logo/ISO header and the address footer reading *Page 1 of N* (the cover is not counted). No line of text is cut across two pages | ☐ |
| I3 | Same viewer → **Download Word** | An editable .docx that opens in Word with the same cover, header, footer, tables and text as the PDF | ☐ |
| I4 | AMC Settings: change **Clause 8 — Termination**, then preview a new contract as PDF and Word | Both show the new wording | ☐ |
| I5 | My AMC Submissions → **View contract** on a sent proposal | **Download PDF** and **Download Word** both offered | ☐ |
| I6 | Client link → **Download** | Menu offers **PDF document** and **Word document** | ☐ |

## 4. Security tests

These check the protections, not the features. Run them while signed in as
**amc.writer**, in the browser's DevTools **Console** on
`http://localhost:3032`. Your session cookie goes with each request.

Get a submission's `id` from Studio → Table Editor → `amc_submissions`.

**4.1 A writer cannot approve by editing the status directly.**

```js
await fetch("/api/amc-submissions", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "<a DRAFT id>", status: "approved" }),
}).then((r) => r.json()).then((row) => row.status);
```
Expect **`"draft"`** — the status field is ignored. ☐

**4.2 A locked submission cannot be edited.**

```js
await fetch("/api/amc-submissions", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ id: "<an AWAITING APPROVAL id>", discount_percent: 50 }),
}).then((r) => [r.status, r.statusText]);
```
Expect **`409`**. ☐

**4.3 The writer cannot approve without the approve permission.** Remove
the writer's admin role (`role_id` to any non-admin role), sign in again,
then:

```js
await fetch("/api/amc-submissions/approval", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "approve", id: "<an AWAITING APPROVAL id>" }),
}).then((r) => r.status);
```
Expect **`403`**. Restore the admin role afterwards. ☐

**4.4 The public key cannot read customer data.** In PowerShell, with the
local anon key from `npm run supabase:status`:

```powershell
curl.exe "http://127.0.0.1:54321/rest/v1/amc_submissions?select=id,customer" `
  -H "apikey: <local anon key>" -H "Authorization: Bearer <local anon key>"
```
Expect a **permission-denied error or `[]`** — never a list of customers.
*This is the defect that was open in production (audit finding F2).* ☐

**4.5 Users cannot see each other's work.** As **amc.approver**, a
**draft** belonging to the writer must **not** appear in their list — only
submissions sent for review do. ☐ **§13 criterion 14.**

---

## 5. Going to production

Only once every box above is ticked.

1. **Commit** — the proposal-number and settings fixes of 21 Sep are not yet
   committed, and the version already merged to `main` is missing them.
   Without them, sending a document fails outright.
2. **Take a database backup** of the production project.
3. **Apply the five migrations** in the order in §1.2, one at a time, and
   run the matching check from §2 after each.
4. **Grant approval.** Permissions → **AMC Proposals** → **Approve** for the
   approver's role (Behrouz, per §9.1 of the FRD).
5. **Fill AMC Settings** with the real TPH contact numbers and coordination
   emails. Until then every contract prints `XXX`.
6. **Set `NEXT_PUBLIC_APP_URL`** to the real domain. It is currently
   `http://localhost:3032`, so every client link would point at localhost
   and fail on the customer's phone.
7. **Remove the test addresses** added to the allowlist in §1.5, if any were
   committed.
8. **Smoke test in production:** one proposal through to Signed, using
   **Copy link** and your own details as the customer.

---

## 6. Known limitations

What the testing above will surface, and is expected:

| Ref | Behaviour | Status |
|---|---|---|
| **K1** | Anyone with approve rights — and every admin — can approve **their own** proposal. §9.1 intends a second person to review. | Open. A one-line check would block it; see the delivery report |
| **K2** | Previews print `XXX` until AMC Settings are filled (C8/C9). Sending is blocked until then (E0) | Expected. A data task, not a code task |
| **K3** | Document layout is unchanged | FR4.8 — waiting on Sharon's sign-off |
