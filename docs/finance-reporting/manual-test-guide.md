# Manual test guide — Finance & Reports (P0–P4)

How to check by hand what is built so far on `feature/yfi-finance-reporting`. Each step says what to do and
what you should see. Automated tests are at the end.

## Before you start: what is safe

The branch runs against the **production database**, so be careful what you save.

| Area | Safe to test? | Why |
|---|---|---|
| Finance queue (FQ-1001 … 1006) | **Yes** | Marked test items; every one shows a *Test item* badge and is removed before go-live |
| Reporting Settings | Yes, **change a value back afterwards** | Only this branch reads them; History keeps every change |
| Zoho FSM | Yes | The branch can only read FSM (GET only); nothing is written there |
| Email | Yes | Blocked by the safety rail on this branch: no email leaves |
| In-app notifications | Yes | Delivered only to the allowlisted user in the worktree `.env` (`NOTIFY_INAPP_ALLOWLIST`); everyone else is skipped |
| Leave, employment status, leaving date, rest days on a **real technician** | **No: look, don't save** | Live scheduling reads the same leave records |
| Hide from lists | Only on a **test account**, and switch it off afterwards | — |

## 0. Setup (once)

1. Open the branch folder `C:\Users\Technisia\Documents\Prohelp-Work\_wt\finance-reporting` in a terminal.
2. Start the dev server on its own port (the main checkout uses 3032):

   ```bash
   npm run dev -- -p 3034
   ```

3. Open <http://localhost:3034> and sign in with your normal account.
4. **Give your role the Finance permissions.** Admins do not get the two approval acts automatically.
   Go to **Permissions**, pick your role, and tick:
   - *Ready-to-invoice queue*: View, Edit, **Approve** (Approve = record invoice)
   - *Not-invoiceable requests*: Create, **Approve** (Approve = verify)
   - *Reporting settings*: View, Edit

   Save, then reload the page. A **Finance** group appears in the menu.

## 1. Security (P0)

| # | Do | Expect |
|---|---|---|
| 1.1 | In a private window (signed out), open `http://localhost:3034/api/role-access` | `401` / Unauthorized, no data |
| 1.2 | Sign in as a non-admin user without the Roles permission and open `/roles` and `/permissions` | Not shown in the menu; the page refuses |

## 2. Platform (P1)

### Reporting Settings (DEV-461)

| # | Do | Expect |
|---|---|---|
| 2.1 | **Settings → Reporting** | Tabs: Invoicing, Quotations, Check-in alerts, Compliance, Capacity and exceptions, Change history, FSM data |
| 2.2 | Invoicing tab: change *Item aged after* (days in Pending) by one, e.g. 7 → 8 and save | Saved; the tab shows a change count |
| 2.3 | **Change history** tab | One row: who, when, the setting, old → new value |
| 2.4 | Enter an invalid value (e.g. a negative number) and save | Refused with a message; nothing saved |
| 2.5 | Set it back and save | History shows the second change |

### Notifications

| # | Do | Expect |
|---|---|---|
| 2.6 | Open **Notifications** in the menu | The inbox; finance notices from the queue tests appear here (allowlisted user only) |
| 2.7 | Open the **Home** page | The notifications panel shows the same open items |

### People (DEV-456, 457, 458)

| # | Do | Expect |
|---|---|---|
| 2.8 | **Scheduling** → open any technician | An *Employment* section (status Active/Resigned, leaving date) and rest-day buttons Mon–Sun. **Don't save on a real technician.** |
| 2.9 | Scheduling → start adding leave (don't save) | *Leave type* is a dropdown of fixed categories, not free text |
| 2.10 | **Users** → edit a **test** account → switch on *Hide from lists* → save | The account stays in the Users list but is gone from people pickers (e.g. the To-do assignee picker, scheduling technician lists) |
| 2.11 | Switch *Hide from lists* off again | It is back in the pickers |

## 3. FSM data (P2)

| # | Do | Expect |
|---|---|---|
| 3.1 | **Settings → Reporting → FSM data** | One row each for quotations, work orders, appointments (and their details): records held, last successful sync, how far behind, last error if any |
| 3.2 | Press **Refresh** | The panel reloads; nothing is fetched from FSM by this button |

The sync itself runs by hand on this branch (it is scheduled only at go-live):

```bash
node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs scripts/finance/fsm-sync-run.ts estimates incremental 5
```

Expect a JSON summary (records read, written, calls used). Run it twice: the second run finds nothing new and
uses one call. Refresh 3.1 and the last-sync time moves.

## 4. Finance queue (P3, P4)

Current test items:

| Item | Status now | Use it for |
|---|---|---|
| FQ-1001 | Invoiced | Read-only view of an invoiced item (TEST-MAH-1001, AED 280 against 285) |
| FQ-1002 | Pending | Full workflow, then invoice at the exact value |
| FQ-1003 | Pending | Exclusion: reject, then verify |
| FQ-1004 | In progress | Two-tab conflict test |
| FQ-1005 | Pending | Invoice with a difference |
| FQ-1006 | Excluded | Read-only view of an excluded item |

### Queue list (DEV-435)

| # | Do | Expect |
|---|---|---|
| 4.1 | **Finance → Ready to invoice** | Five cards (Pending, In progress, On hold, Excluded value, Average days to invoice) and the list showing *Awaiting action*: FQ-1002, 1003, 1004, 1005 |
| 4.2 | Status filter → *All statuses* | All six items |
| 4.3 | Search `17969` | Only FQ-1002 |
| 4.4 | Filter by client, then clear it | The list narrows, then returns |
| 4.5 | Click a row | The item screen opens |

### Item screen and workflow (DEV-436, 437)

Use **FQ-1002**:

| # | Do | Expect |
|---|---|---|
| 4.6 | Open it | Sections: Commercial reference (quotation, work order, client, coordinator), Value (this item, invoiced before, cumulative, remaining, completion %), Line items, Delivery evidence (appointments and crew), Activity. A *Test item* badge. |
| 4.7 | **Pick up** | Status *In progress*, "with <your name>"; Activity gets a row |
| 4.8 | **Put on hold** with a reason | Status *On hold*; the reason shows on the page |
| 4.9 | **Raise query** with a question | Status *Query raised*; "Waiting for the coordinator" shows the question; the allowlisted user gets a notification |
| 4.10 | **Answer query** with an answer | Back to *On hold* **with the hold reason still shown** (this was the bug fixed on 21 Oct); the query notification closes |
| 4.11 | **Resume** | *In progress* |
| 4.12 | **Release** | Back to *Pending*, no one assigned. Pick it up again for 4.16. |

### Two people at once (FQ-1004)

| # | Do | Expect |
|---|---|---|
| 4.13 | Open FQ-1004 in two browser tabs | Both show *In progress* |
| 4.14 | Tab 1: **Put on hold** | Works |
| 4.15 | Tab 2 (not refreshed): **Release** | Refused: someone else changed the item; nothing changes. Refresh shows *On hold*. |

### Record invoice (DEV-440)

| # | Do | Expect |
|---|---|---|
| 4.16 | FQ-1002 → **Record invoice**: number `TEST-MAH-1002`, today, amount = the item value | Saved with no reason asked; status *Invoiced*; completion % on the quotation goes up |
| 4.17 | FQ-1005 → **Record invoice** with an amount 10 lower and **no reason** | Refused: a reason is required when the amount differs |
| 4.18 | Same, now with a reason | Saved; the invoice block shows the difference (−10) and the reason |
| 4.19 | Try to record a second invoice on FQ-1005 | No *Record invoice* button: an item is invoiced once |

Please start MAHER numbers with `TEST-` so they are easy to remove.

### Not invoiceable (DEV-438) — FQ-1003

| # | Do | Expect |
|---|---|---|
| 4.20 | **Mark not invoiceable**, reason and notes | "It cannot be invoiced until this is decided"; *Record invoice* disappears; a notification goes to the verifier |
| 4.21 | **Reject** with a note | The request closes; item back to *Pending*; notification closes |
| 4.22 | **Mark not invoiceable** again, then **Verify exclusion** | Status *Excluded*; its value appears in *Excluded value* on the list |

### Metrics (DEV-441)

| # | Do | Expect |
|---|---|---|
| 4.23 | **Finance → Invoicing metrics** | Awaiting invoice (AED), average days to invoice, invoices with a variance (now 2 of 3), excluded value; ageing bands; days to invoice by user; on hold list; excluded by reason |
| 4.24 | Check one number by hand | e.g. *Awaiting invoice* = the sum of the values of items not invoiced or excluded |

### Daily digest (DEV-439)

1. **Settings → Reporting → Invoicing**: add yourself as a digest recipient and save.
2. Run it by hand (the time check is skipped):

   ```bash
   node --env-file=.env --env-file=.env.local --import ./tests/setup/register.mjs scripts/finance/run-digest.ts --ignore-time
   ```

| # | Expect |
|---|---|
| 4.25 | Today it answers `"already sent today (2026-10-21)"`: the digest goes once per Dubai day. Run it again tomorrow to see a real send. |
| 4.26 | On a sending day: an in-app *Ready to invoice* notification for the allowlisted user; the email is counted as *suppressed* (blocked by the rail) |
| 4.27 | Remove yourself as a recipient afterwards |

## 5. Automated tests

Run from the branch folder:

```bash
npm test
```

Expect `# pass 106`, `# fail 0` (sync engine, queue rules, metrics, digest, safety rails).

```bash
bash scripts/db-harness/run.sh
```

Needs the local PostgreSQL 15 the harness uses. It builds a throwaway database, applies every migration twice,
runs 137 checks (including Q-1042 giving 41.7 / 75.0 / 100 %, double invoicing refused, append-only history)
and a rollback round trip. Expect `== all checks passed`.

## What is not built yet (don't look for it)

- The automatic trigger that puts completed work into the queue (DEV-433): waits on decisions D-01..D-03.
  Until then the queue holds only the six test items.
- Uploading evidence files for an exclusion; the completion report link (B-01).
- Any report page under **Reports**: that is P5 onwards.
