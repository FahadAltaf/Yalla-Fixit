# Live change plan: FR-15 copy an appointment to later days (Zoho FSM write test)

Status: AUTHORIZED for the three named test work orders only. Updated 9 Oct 2026.

## 1. Authorization

- Requested by: Sami Farah (product owner), in this session on 9 Oct 2026.
- Words used: "Go ahead with these three answers", replying to the question
  whether to build the feature with (1) a price confirmation that shows the
  amount every time, (2) no dispatch by the portal, (3) copies up to 14 days
  ahead, and to run the FSM write tests on WO2361, WO1928 and WO758 only.
- Scope of the authorization: create work orders and appointments in the
  production Zoho FSM tenant **only as copies of WO2361, WO1928 or WO758**,
  then cancel them. No other record may be written.

## 2. Exact target

| Item | Value |
|---|---|
| System | Zoho FSM, production tenant (the only one the portal has) |
| API base | `https://fsm.zoho.com/fsm/v1` |
| Credential | the portal's own OAuth token in `settings.oauth_access_token` (never printed) |
| Territory | one only: "Yalla Fix It" (`33246000000331358`) |
| Source records | WO2361 (`33246000001629781`), WO1928 (`33246000001488519`), WO758 (`33246000000901078`) |
| Database | production Supabase; one additive migration `20261009120000_schedule_entry_work_order_copy.sql`, run by hand by the owner |

## 3. Current-state evidence (read-only probe, 9 Oct 2026)

- All three work orders are in status **New**, billing status **Not yet
  Invoiced**, with free service lines (status New, no live appointment).
  Grand totals: WO2361 AED 1,847.75, WO1928 AED 2,826.30, WO758 AED 1,363.55.
- WO1928 and WO758 carry part line items tied to a service line; none of the
  three has service task line items.
- Work order blueprint transitions available: Manage Appointment, **Cancel**
  (`33246000000169090`, Notes mandatory), Terminate (`33246000000169093`).
- Rate limit headers are returned (`x-ratelimit-limit` 5000 per window);
  about 4,960 calls remained at probe time.
- Earlier in this session: an empty POST to `/Work_Orders` and to
  `/Service_Appointments` was refused with `MANDATORY_NOT_FOUND`, so the
  token holds both CREATE scopes.

## 4. Proposed delta

Per copied day, on approval of that day in the portal:

1. GET the source work order (fresh read).
2. POST `/Work_Orders`: Summary, Type, Contact, Company, Territory,
   Service_Address, Billing_Address, Due_Date = the copied day, and the
   service lines the source appointment covered (Service, Quantity,
   Sequence, Description, List_Price, Discount), with their tasks and parts.
   Sent **without retry** so a timeout can never create two work orders.
3. GET the new work order to read its name (WOxxxx) and line ids; the new
   ids are saved on the portal entry **before** step 4, so a retry never
   creates a second work order.
4. POST `/Service_Appointments` on the new lines, same technicians, same
   clock times, `$allow_overlapping` true. **Not dispatched.**
5. GET the appointment to store its name, status and Modified_Time.

The tests run exactly this path through the portal code (`syncEntryToFsm`)
from a scratchpad script, on copies of the three test work orders.

## 5. Impact and risks

- A new work order and a new appointment per test; they use up record
  numbers and count toward the monthly appointment quota even after cancel.
- Zoho runs a function on every appointment create; org workflow rules may
  notify the contact ("Test Sami Farah" / "Sami UAT Testing", both test
  contacts) or the technician chosen for the test.
- Price: each copy repeats the price of the covered lines on a new work
  order (the feature shows the amount and asks before copying).
- Partial failure: a work order created but the appointment refused leaves
  a work order in status New; the audit event and the entry carry its id.

## 6. Execution steps

1. Owner runs the migration on production Supabase.
2. Script: create a draft day copy of a test appointment on each of the
   three work orders for a day 1 to 3 days ahead, approve through
   `syncEntryToFsm`, record ids and responses in the scratchpad.
3. Verify (section 8).
4. Rollback (section 7) straight after verification.

## 7. Rollback

- Cancel each created appointment: PUT
  `/Service_Appointments/{id}/actions/blueprint` with the Cancel transition
  and a Notes text ("Portal copy test, cancelled").
- Cancel each created work order: PUT `/Work_Orders/{id}/actions/blueprint`
  with transition `33246000000169090` and the same Notes (this also cancels
  its appointments).
- There is no DELETE endpoint; if the owner wants the records gone entirely,
  delete them in the FSM UI afterwards.
- Portal side: remove the test entries and versions created by the script.
- Database columns are additive; dropping them reverses the migration.

## 8. Verification

- New work order: Contact, Company, addresses, Territory and lines match
  the source lines; price per line as expected; Due_Date is the copied day.
- New appointment: start and end in Asia/Dubai as scheduled; technicians
  and Lead correct; **Status is Scheduled, not Dispatched**.
- Source work orders unchanged (re-read after the test).
- Portal entry carries both the new ids and names; a forced retry after a
  simulated appointment failure creates no second work order.

## 9. Result (9 Oct 2026, 16:10 to 16:25 Gulf time)

**What FSM required that the docs do not say.** The documented minimal body
was refused with `INVALID_DATA: Unable to Update Grand Total` ("pre
processing line item amount and aggregate fields"). Two things fixed it:

1. each service line (and part) must carry its `Tax` map
   (`Tax_Id`, `Tax_Name`, `Tax_Percentage`), copied from the source line;
2. the work order's `Phone` is mandatory on this org's layout (copied with
   Email and Mobile from the source).

`List_Price` on a line is accepted, so the copy repeats the source price.
`Due_Date` and `Priority` are accepted. Variants were tried on WO758 only;
two work orders from those trials (WO3399, WO3400) were cancelled at once.

**Full run through the portal modules** (`quoteFsmWorkOrderCopy`,
`createFsmWorkOrderCopy`, `createFsmAppointment`), test date 11 Oct 2026,
10:00 to 12:00:

| Source | New work order | Lines and price | Appointment | Status |
|---|---|---|---|---|
| WO2361 | WO3401 | 2 lines, AED 200.00 | AP-4053, Tech 2 Test (lead) + Tech 1 Test | Scheduled |
| WO1928 | WO3402 | 2 lines + part Dettol, AED 382.75 incl. tax | AP-4054, Sami Farah Agent | Scheduled |
| WO758 | WO3403 | 1 line, AED 650.00 | AP-4055, Sami Farah Agent | Scheduled |

- Contact, Company, Territory, addresses, Asset (WO1928) and Priority
  (WO2361) matched the source; Due_Date was the copied day.
- No appointment was dispatched (`Dispatched` empty, status Scheduled).
- Failure path (WO758): an appointment with an invalid technician was
  refused by FSM (`Invalid Resource specified`); the work order survived and
  the second appointment landed on that same work order, so no duplicate.
- The three source work orders were re-read afterwards: Modified_Time,
  line count, totals and status unchanged.
- The first price quote left out WO1928's part (AED 26.25 incl. tax); the
  quote now includes parts tied to the copied lines.

**Rollback done.** AP-4053, AP-4054, AP-4055 cancelled through the
blueprint Cancel transition, then WO3401, WO3402, WO3403 cancelled the same
way (all read back as Cancelled). WO3399 and WO3400 were cancelled during
the variant trials. Nothing was deleted; the owner may delete the eight
cancelled records in the FSM UI.

**Guards added after code review (same day).** The entry is claimed
(`sync_status = syncing`) before anything is sent; the attempt time is
saved just before the POST, and while it is set with no id saved, FSM's
recent work orders are searched (same contact, summary, due date, created
after the attempt) and a single match is adopted instead of creating again;
only a definite FSM refusal clears that marker. The confirmed price is sent
back with the copy and checked again at approval. The new work order's lines
are no longer mapped by Sequence: the appointment takes every line on it.

**Not tested here.** The database side of approval (saving the new work
order id on the entry before the appointment, and the retry reusing it)
needs migration `20261009120000_schedule_entry_work_order_copy.sql` on
production first; it was not applied during this session.
