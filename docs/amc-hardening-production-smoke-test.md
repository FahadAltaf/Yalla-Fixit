# AMC hardening: production smoke test

Run **after** the deployment in `amc-hardening-production-runbook.md` (step 10). About 45 minutes.

**Rules:**
- Use your own account and your own email address as the "customer".
- Use **Copy link** wherever email is not the thing being tested.
- Name test proposals `SMOKE TEST <date>`, so they can be found and marked afterwards. Ask before deleting anything; there is no delete in the app.
- Record who ran each check, and when.

**Notation:**
- **PASS** means you saw exactly the expected result.
- Anything else is **FAIL**: stop, then follow the rollback in the runbook.

**Placeholders in the commands:**
- `<project-ref>` is `sxzpigyphjotuubxpooj`.
- `<anon key>` is the public anon key.
- `<your access token>` is the `access_token` inside your own `sb-…-auth-token` cookie (DevTools → Application → Cookies).

---

## 1. AMC workflow

| # | Step | Expected | Result |
|---|---|---|---|
| A1 | AMC Proposals → New. Fill property and customer | Wizard opens on step 1; the services in step 2 match **Settings → AMC → Services** | |
| A2 | Tick one service. Base 100, units 2, frequency 4. Discount 10% | Row price **800.00**. Final **720.00**. VAT **36.00**. Total **756.00** | |
| A3 | Close the tab, reopen from My Submissions | Same values, same proposal number | |
| A4 | Submit for approval | Status **Awaiting approval** | |
| A5 | As an approver (a second person), open it | Total **756.00** in the list, the approval notice and the details page | |
| A6 | Approve | Status **Approved** | |
| A7 | Owner: **Copy proposal link** | Status **Proposal sent**. The link opens in a private window without login | |
| A8 | On the link: the annual fee, and the document's totals | Fee **720.00** excl. VAT. The document total is **756.00**, and the words read *SEVEN HUNDRED FIFTY SIX DIRHAMS ONLY (VAT INCLUDED)* | |
| A9 | Approve on the link, with a name | *Proposal approved*. Reload: outcome card only, **no document** | |
| A10 | Owner: **Copy contract link**, open it privately | The contract shows, with **Sign contract** | |
| A11 | Sign with a typed name | *Contract signed*. Reload: card only | |
| A12 | Open the proposal's **History** | `submitted_for_approval → approved → proposal_sent (outcome link_created) → proposal_approved_by_client → contract_sent → contract_signed` | |
| A13 | **Email proposal** on a second approved test proposal, to your own inbox | The email arrives with the PDF attached, named `Proposal-AMC-….pdf`. History shows outcome **emailed** | |

## 2. Security

| # | Check | How | Expected | Result |
|---|---|---|---|---|
| S1 | Direct AMC write as a signed-in user fails | `curl.exe -X PATCH "https://<project-ref>.supabase.co/rest/v1/amc_submissions?id=eq.<your draft id>" -H "apikey: <anon key>" -H "Authorization: Bearer <your access token>" -H "Content-Type: application/json" -d '{"status":"approved"}'` | 401/403 *permission denied*. Row unchanged | |
| S2 | Direct AMC insert fails | Same, with `-X POST` and a body with your own `owner_id` and `"status":"signed"` | permission denied | |
| S3 | Anonymous send-email fails | Private window, Console: `fetch("/api/send-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:"you@example.com",subject:"x",html:"x"})}).then(r=>r.status)` | **401** | |
| S4 | Signed-in email still works | Snagging: deliver a report link by email to yourself; or Quotation Templates → send to yourself | The email arrives | |
| S5 | Server-side email still works | Todos: assign a todo to yourself | The assignment email arrives | |
| S6 | Public quotation review still notifies the owner | Approve a test quotation through `/quotations/review?id=…` | The owner's company mailbox gets the notification | |
| S7 | No internal approvers in the client payload | On a sent proposal link, DevTools → Network → `/api/amc/<token>` → search the response for `@yallafixit` and `approvers` | No approver emails. `approvers` is an empty list | |
| S8 | Consumed link fails safely | Re-open the link from A9 | Outcome card; the response has `"document": null` | |
| S9 | Superseded link fails | On a proposal link, **Send again / Get a new link**, then open the old link | *This link is not available* (404) | |
| S10 | Zoho token not readable with public credentials | `curl.exe "https://<project-ref>.supabase.co/rest/v1/settings?select=oauth_access_token" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"` | permission denied, or no `oauth_access_token` field. **Never a token** | |
| S11 | Zoho token not readable as a signed-in user | The same request with `Authorization: Bearer <your access token>` | Same as S10 | |
| S13 | Password reset tokens not readable | `curl.exe "https://<project-ref>.supabase.co/rest/v1/password_resets?select=token" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"` | permission denied. **Never a token** | |
| S14 | Password reset still works | Log out → Forgot password → your own email → follow the link → set a new password → sign in | Works (this flow could not set a password before this release) | |
| S15 | Estimate tables closed | `curl.exe "https://<project-ref>.supabase.co/rest/v1/estimate_revisions?select=id" -H "apikey: <anon key>" -H "Authorization: Bearer <anon key>"` | permission denied | |
| S16 | Estimate APIs need sign-in | Private window: `fetch("/api/estimates/revision",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}).then(r=>r.status)` | **401** | |
| S12 | Public site settings still load | Log out; open the login page | The logo and theme render as before | |

## 3. Existing modules

| # | Module | Check | Expected | Result |
|---|---|---|---|---|
| M1 | Scheduling | Open today's schedule; edit an entry; publish | Works; audit history shows the change | |
| M2 | Scheduling → FSM | Create or update an appointment that syncs to Zoho FSM | Syncs without auth errors (the Zoho token is still usable server-side) | |
| M3 | Snagging | Open a job; approve or deliver a report | Works; the report email or link arrives | |
| M4 | Snagging (mobile) | Inspector app: sign in, sync, open a job | Works | |
| M5 | Quotations / estimates | Open a quotation in Quotation Templates; preview; create a revision | Loads; the revision saves; images show | |
| M6 | Public quotation review | Open `/quotations/review?id=…` | The quotation renders; approve/reject works | |
| M7 | Todos | Create a todo with a reminder; wait for the reminder job (or trigger it with `CRON_SECRET`) | The reminder email arrives | |
| M8 | Settings → Appearance | Change the theme colour, then change it back | Saves and applies | |

## 4. After the test

- Mark the test proposals as test data (the business decision on early test rows covers these too).
- Record the results in the hardening report §16.
