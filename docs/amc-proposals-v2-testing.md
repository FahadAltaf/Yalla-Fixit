# AMC Proposals v2 — Testing Guide

How to test the v2 build end to end before it goes to production. Every test
maps to an acceptance criterion in §13 of the FRD, so a completed run of this
guide is also the sign-off record.

Allow **about 2 hours** for a first full pass (90 minutes for §1–§4, plus
the hardening checks in §3J–§3O and §4.6–§4.13).

> **Updated 5 Oct 2026** for the production-hardening phase (branch
> `amc-hardening`, report in
> [`amc-proposals-v2-hardening-report.md`](amc-proposals-v2-hardening-report.md)).
> **No box in this guide has been ticked by a real run.** A tick means a
> person ran the step and saw the expected result; record who and when next
> to it. The automated tests (`npm test`) cover the pricing, workflow,
> token, payload and validation rules, but not the screens, the database
> policies or email delivery, which is what this guide is for.

---

## 0. Test locally, not on production

The database in `.env` (`sxzpigyphjotuubxpooj`) is **production**. Do not run
this guide against it.

The seven v2 AMC migrations are already reflected in production (checked
read-only on 5 Oct 2026), but production's migration history does not record
them, and two new hardening migrations are **not applied anywhere yet**
(§1.2). The repo's rule is in [`LOCAL-SUPABASE.md`](LOCAL-SUPABASE.md):
*test migrations locally before applying them to production.* This guide
follows it.

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

This rebuilds the database from `supabase/migrations/` in filename order.
The AMC migrations, in order:

| Order | File | What it does | In production? |
|---|---|---|---|
| 1 | `20260721120000_create_amc_submissions.sql` | The table | Yes |
| 2 | `20260915120000_amc_harden_submissions.sql` | Row-level security | Yes |
| 3 | `20260915130000_amc_settings_and_audit.sql` | Settings and audit trail | Yes |
| 4 | `20260916100000_amc_approval_flow.sql` | Nine statuses, approver policy | Yes |
| 5 | `20260916105000_amc_proposal_numbers.sql` | Server-allocated numbers | Yes |
| 6 | `20260916110000_amc_client_links.sql` | Tokens, decisions, signature | Yes |
| 7 | `20260922130000_amc_contract_settings_snapshot.sql` | The contract's own settings copy | Yes |
| 8 | `20261005100000_amc_close_direct_writes.sql` | No direct writes from browser sessions (hardening) | **No** |
| 9 | `20261005110000_amc_proposal_number_beyond_9999.sql` | Numbers past 9999 (hardening) | **No** |

**Stop here if the reset prints any error.** A migration that fails locally
will fail in production too.

> **Known problem with a full local reset.** No tracked migration creates
> `snagging_clients` or renames `snagging_tasks` to `snagging_jobs` (both
> were done in production by hand), so a reset from scratch is expected to
> stop at the snagging migrations, before it reaches the AMC ones. See
> [`database-migration-reconciliation.md`](database-migration-reconciliation.md).
> Until that is fixed, test against a local copy restored from a production
> schema dump, then apply files 8 and 9 to it by hand.

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

Access is by role permission; there is no email allowlist in the code any
more. A user can open the module with **AMC Proposals → View** (or
**Approve**); admins pass every check. §1.6 grants these.

Who may **approve** is decided in two places:

- **AMC Settings → Approvers** (Settings → AMC). If this list has any
  emails, only those people can approve or send back, admins included.
- If the list is empty, the role permission **AMC Proposals → Approve**
  decides (and admins can always approve).

Section §3J tests both.

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
| C9 | As admin: **Settings → AMC**, replace the contact numbers and both coordination emails with real values, save. Preview again | No **"XXX"** anywhere | ☐ 6 |
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
| E0 | **Before** filling in AMC Settings (C9): on an Approved row, **Copy proposal link** | Refused: *"This proposal still contains placeholder text (XXX)… Fix: AMC Settings > Provider > contactNo …"* naming where each placeholder is. Status stays **Approved** — nothing with XXX can reach a client. History shows a *send refused* entry | ☐ 6 |
| E1 | Writer: on the Approved row, **Copy proposal link** | Toast confirms it copied. Status **Proposal sent** | ☐ |
| E2 | Open the link in a private window | The proposal shows, with no login prompt and no dashboard | ☐ 10 |
| E2a | Look below the action bar | The whole proposal is shown on the page, laid out as in the Review & Submit preview and dated the day it was **sent**. **Download PDF** saves the same document as a PDF | ☐ |
| E2b | Same link on a phone (or DevTools device mode) | The document fits the screen width with no sideways scrolling; pinch to zoom in | ☐ |
| E2c | **Approve proposal** | Asks **Who is responding?** first, then **Confirm approval** — the same two steps as a snagging quotation | ☐ |
| E3 | **Request changes**, try to submit with name or reason blank | Blocked until both are filled | ☐ |
| E4 | Instead: enter a name, **Approve proposal** | *"Proposal approved — thank you"*. Status **Proposal approved** | ☐ 10 |
| E5 | Reload the same link and try again | Shows the outcome only (*Proposal approved*), with **no document** below it and no buttons. There is no way to answer twice | ☐ |
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
| G8 | Sign in as **amc.approver** (not an admin) | **AMC** is not under **Settings**, and opening `/settings/amc` directly shows no settings | ☐ |
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

### J. Who may approve (Settings approver list)

| # | Steps | Expected |
|---|---|---|
| J1 | Admin: Settings → AMC → **Approvers**: leave empty. Approver (role has AMC Approve) opens an awaiting proposal | **Approve** and **Send back** offered |
| J2 | Admin: add only `amc.writer@test.local` to Approvers, save. Approver reloads | Approve / Send back gone; a direct `POST /api/amc-submissions/approval` returns **403** |
| J3 | Same list: writer (admin, on the list) opens someone else's awaiting proposal | Approve / Send back offered |
| J4 | Clear the list again | J1 behaviour returns |

### K. Resubmitting after the client asks for changes

| # | Steps | Expected |
|---|---|---|
| K1 | Send a proposal (Copy link). In a private window: **Request changes** with a reason | Status **Proposal rejected**; the link now shows *Changes requested* and **no document** |
| K2 | Writer: edit the proposal (change a price), **Submit** | Status **Awaiting approval**. The old link still shows only the outcome card, never the edited prices |
| K3 | Approve, then **Copy link** again | A **new** link. The old one now says *This link is not available* |
| K4 | Open the submission's history / record | The previous *changes requested* answer is not shown as the current client decision; the new link waits for a fresh answer |

### L. Services come from AMC Settings

| # | Steps | Expected |
|---|---|---|
| L1 | Admin: Settings → AMC → Services: **add a service** offered on apartments, default frequency 4. New apartment draft | The new service is a row in step 2, frequency **4** |
| L2 | Tick it, price it, save, reopen | It is still there with its price |
| L3 | Admin: **switch it off**. Reopen the draft | A warning says it was removed; it is no longer ticked or charged; totals drop accordingly |
| L4 | A proposal already **sent** that included a service later switched off: open **View contract** | Still lists it (the sent document keeps its snapshot) |
| L5 | Apartment draft | The hidden-services notice names the villa-only services by their Settings labels |

### M. Pricing: server is the authority, and the fils agree

| # | Steps | Expected |
|---|---|---|
| M1 | Base 100, units 2, frequency 4 | Row price **800.00** |
| M2 | Rows totalling **513.00**, discount **10%** | Discount 51.30, final **461.70**, VAT **23.09**, total **484.79** in the wizard, the list, the approval notice, the contract and the client page — the same figure everywhere |
| M3 | Base price **3,500.50**, no discount → proposal (brochure) | Annual fee prints **3,500.50** (not 3,501); monthly **291.71** |
| M4 | Contract with total **525.53** | Words read *… FIVE HUNDRED TWENTY FIVE DIRHAMS AND FIFTY THREE FILS ONLY (VAT INCLUDED)* |
| M5 | DevTools: `PUT /api/amc-submissions` on your draft with `final_price: 1` and a row `price: 1` | Saved row's `final_price` equals base × units × frequency less discount, **not 1** |
| M6 | Same, with a ticked service id Settings does not offer on this property | **400** naming the service |

### N. When an email fails

| # | Steps | Expected |
|---|---|---|
| N1 | Approved proposal with **no customer email**, choose **Email proposal** | Warning: link created, nothing sent. Status **Proposal sent**. History shows *proposal sent* with outcome **no recipient** |
| N2 | (Local only) temporarily blank `NEXT_PUBLIC_RESEND_API_KEY`, email a proposal | Warning that delivery failed; link valid; history shows outcome **email failed** with a short reason and no key or full provider response |
| N3 | Proposal whose account manager phone is `05X XXX XXXX` | Send refused naming *Proposal > Account manager 1 phone*; history shows *send refused* |

### O. Link lifecycle

| # | Steps | Expected |
|---|---|---|
| O1 | Approve the proposal from a link, then open the same link | Outcome card only, no document |
| O2 | Send the contract, open the **proposal** link | Outcome card only; it cannot sign |
| O3 | Sign the contract, open the contract link | *Contract signed* card, no document |
| O4 | Studio: set a sent proposal's `proposal_token_expires_at` to yesterday, open its link | *This link has expired* (410) |
| O5 | **Send again** a proposal, open the previous link | *This link is not available* |

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

**4.6 A signed-in user cannot write AMC rows directly** (after migration
`20261005100000`). Take your own access token from the session cookie
(DevTools → Application → Cookies, the `sb-…-auth-token` value's
`access_token`), then in PowerShell:

```powershell
curl.exe -X PATCH "http://127.0.0.1:54321/rest/v1/amc_submissions?id=eq.<your draft id>" `
  -H "apikey: <local anon key>" -H "Authorization: Bearer <your access token>" `
  -H "Content-Type: application/json" -d '{"status":"approved"}'
```
Expect **permission denied** (401/403), and the row unchanged. Before the
migration this succeeded. ☐

**4.7 The email endpoint is not an open relay.** From a private window (not
signed in):

```js
await fetch("/api/send-email", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ to: "someone@example.com", subject: "x", html: "<p>x</p>" }) }).then(r => r.status);
```
Expect **401**. ☐ The same request signed in returns 200 (sends a real
email; use your own inbox). ☐

**4.8 The public quotation review page can still notify the owner.** On
`/quotations/review?id=<estimate>`, approve as the customer: the owner's
company mailbox receives the notification. ☐

**4.9 The client link does not leak internal data.** Open a sent proposal's
link, then in DevTools → Network inspect `/api/amc/<token>`:
- no `approvers` emails anywhere in the response ☐
- no switched-off clause text ☐
- no `owner_id`, token hashes or `customerId` ☐

**4.10 Oversized or malformed answers are refused.**

```js
await fetch(location.pathname.replace("/amc/", "/api/amc/"), { method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "sign", name: "x".repeat(500) }) }).then(r => r.status);
```
Expect **400**; with a 20 KB body expect **413**. ☐

**4.11 Submit is checked on the server.** Untick every service on a draft
via `PUT`, then `POST /api/amc-submissions/approval` with
`{ "action": "submit" }`: expect **400** *Tick at least one service*. ☐

**4.12 Self-approval follows the policy.** Today
`AMC_SELF_APPROVAL_ALLOWED = true` (`lib/amc/workflow.ts`), so an approver
can approve their own proposal. If the business decides otherwise and the
switch is set to `false`: own proposals show no Approve / Send back, and
the API returns **403**. ☐

**4.13 Re-check after any change:** run `npm test` — all tests pass. ☐

---

## 5. Going to production

Only once every box above is ticked.

Status on 5 Oct 2026: the v2 migrations (1–7 in §1.2) are in production,
AMC Settings holds real values, and approvals and client links are in use.
What remains for the hardening release:

1. **Merge** branch `amc-hardening` after review.
2. **Take a database backup** of the production project.
3. **Reconcile the migration history first** — a DevOps-approved step, see
   [`database-migration-reconciliation.md`](database-migration-reconciliation.md).
   Do **not** run `supabase db push` against production before that.
4. **Apply** `20261005100000_amc_close_direct_writes.sql` and
   `20261005110000_amc_proposal_number_beyond_9999.sql`, one at a time, and
   run each file's verification query.
5. **Deploy the code at the same time as step 4 or after it.** The code works
   with or without the migrations; the migrations remove database paths the
   code never used.
6. **Check `NEXT_PUBLIC_APP_URL`** in the production environment is the real
   domain (the local `.env` still says localhost; client links are built
   from it).
7. **Smoke test in production:** one proposal through to Signed, using
   **Copy link** and your own details as the customer; then 4.6, 4.7 and 4.9
   against production with your own account.

---

## 6. Known limitations

What the testing above will surface, and is expected:

| Ref | Behaviour | Status |
|---|---|---|
| **K1** | Anyone with approve rights — and every admin — can approve **their own** proposal. §9.1 intends a second person to review. | **Business decision required.** One switch, `AMC_SELF_APPROVAL_ALLOWED` in `lib/amc/workflow.ts`, changes the API and the buttons together |
| **K2** | Previews print `XXX` while AMC Settings or the proposal still hold placeholders. Sending is blocked and says where (E0, N3) | Expected |
| **K3** | The new document layout is built and in use, but no sign-off is recorded | FR4.8 — **business decision required** (Sharon) |
| **K4** | The PDF attached to the client email is built in the browser; the server checks it is a PDF of sane size but cannot prove it matches the approved data | Follow-up: server-side generation in the Signed Contract Archive phase |
| **K5** | A signed contract still prints blank signature lines; the typed name and time are recorded but not printed | **Business decision required** |
