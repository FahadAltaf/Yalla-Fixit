# Request: read access to FSM Attendance, Trips, Time Off and Service Line Items for the portal (blocker B-01)

**To:** the Zoho FSM administrator who manages the Yalla Fixit portal's Zoho connection
**From:** portal development, 23 Oct 2026
**Ask:** add **read-only** scopes for four FSM modules to the portal's Zoho OAuth client and issue a new token. Nothing in FSM is changed, and the portal will only read these modules.

## Why

The portal's reports need data that FSM already holds but the portal's Zoho login is not allowed to read:

| FSM module (Workforce menu) | What the portal needs it for |
|---|---|
| **Attendance** | Real shift check-in and check-out per technician per day (first check-in, last check-out, status, working duration) for the **Attendance** and **Compliance** reports. Today they use appointment start and end times as a stand-in. |
| **Trips** | Travel time for the **Utilization** report (its Travel card is empty today). |
| **Time Off** | Leave as recorded in FSM, to compare with the portal's own leave records when working out available hours. |
| **Service Line Items** | The line items of many work orders in a few calls, for **Ready to invoice**: how many lines are completed, shown and filtered in the list. Today a work order's lines can only be read one work order at a time (a call each), so the list cannot show them. |

On 22 and 23 Oct 2026 the portal asked FSM for each of these with a simple read (`GET /Attendance`, `/Trips`, `/Time_Off`, `/Service_Line_Items`). Every one was refused with **`401 OAUTH_SCOPE_MISMATCH` (invalid oauth scope to access this URL)**. The current login can read only Work Orders, Service Appointments, Estimates and Users.

## What to add

Read scopes only, as the Zoho API Console lists them for Zoho FSM. Zoho names FSM scopes in the form `ZohoFSM.modules.<Module>.READ`; please take the exact names from the console's scope list for:

1. **Attendance**: read
2. **Trips**: read
3. **Time Off**: read
4. **Service Line Items**: read

Optional, for other blocked report items (same rule: read only):

5. **Service reports / attachments**: read. Gives the job completion report link on the invoicing pages.
6. **Ratings or feedback**, if the module exists: read. Needed for technician ratings.
7. **Field metadata / settings**: read. Gives the real list of status values (for example quotation statuses).

Do **not** add any create, update or delete scopes for these modules.

## Important: keep every scope the portal has now

The portal uses **one** Zoho token for everything. Scheduling, Snagging and AMC also **write** to FSM (work orders, appointments, quotations, contacts). When the new grant is generated it must include **every scope the current token already has**, plus the new read scopes. A token generated with only the new scopes would stop scheduling, snagging and AMC from working.

## Steps

1. In the Zoho API Console (api-console.zoho.com), open the client the portal uses.
2. Note the scopes of the current token.
3. Generate a new grant with **those scopes plus the read scopes above**, and exchange it for a new refresh token.
4. Put the new refresh token wherever the job that refreshes the portal's access token keeps it. That job runs outside this code repository and writes the access token to `settings.oauth_access_token` in the portal's database.
5. Tell portal development when it is done. We will re-run the same read-only check (a call per module) to confirm each one answers, and send back the result.

## After the change

- **Nothing changes** in the portal until the reports are switched over; scheduling, snagging and AMC carry on as before, provided their existing scopes were kept.
- The check-in times in FSM are shown in each user's profile time zone (one profile shows GMT‑07:00). The portal reads FSM's times and shows them in Dubai time, so that setting does not affect the reports.
