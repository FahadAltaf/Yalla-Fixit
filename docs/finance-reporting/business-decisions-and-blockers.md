# Business decisions and blockers

Part of the [Finance & Reports plan](README.md). Nothing below is invented as a rule in code. Where work
must start before a decision lands, the setting is configurable and the default is stated as an
assumption, not a policy.

## Decisions needed

**Must be settled before the phase that needs it starts.** "Assumption" is what the build does until then.

| ID | Decision | Why it matters | Evidence | Owner | Blocks | Assumption meanwhile |
|---|---|---|---|---|---|---|
| **D-01** | What does "job completed in FSM" mean for the queue trigger? | Financial correctness | Work orders completed on **3/600**; appointments **402/600** ([FSM plan](zoho-fsm-integration-plan.md)). BRD Step 1 read literally would almost never fire, and contradicts Step 2's month-1 batch on an open project | Sharon, Finance | DEV-433 | None. Not built until answered |
| **D-02** | Is `Estimates.Post_To_Maher__C = "To Be Invoiced"` the "Ready to be Invoiced" flag? What are its other values, and who sets and resets it? | The trigger's second condition | Value seen on 2/600 quotations; `Billing_Status` is "Not yet Invoiced" on 600/600 | Sharon, coordinators | DEV-433 | Treated as the flag, pending confirmation |
| **D-03** | Progressive invoicing: how is a second batch triggered? Re-setting the flag, new completed lines appearing while it stays set, or a month-end cut? | Duplicate or missed invoices | BRD §5.1 Step 2, Q-1042 example | Finance | DEV-433, 434 | Not built until answered |
| **D-04** | Can a part-completed single line be invoiced? | Line-item model | FSM line status is whole-line (`SLI_Status`) | Finance | DEV-434 | **No** — the unit is a whole line |
| **D-05** | Completion %: pre-tax line amounts, or VAT-inclusive `Grand_Total`? | E1 parameter, item value | BRD §6.1: "(cumulative + this item) ÷ quotation total" | Finance | DEV-434, 439 | Pre-tax line amounts ÷ pre-tax total, shown as such |
| **D-06** | AMC work: hidden from the queue by job type, or shown and explicitly excluded? | BRD §7: settle **before development** | — | Sharon, Finance | DEV-438, 433 | Shown and excluded (keeps the decision visible) |
| **D-07** | Does Finance need an approval step before Invoiced? | Status model | BRD §7 | Finance | DEV-437, 440 | No extra step |
| **D-08** | Where does "chargeable" come from? | Commercial utilization | `Chargeable__C` false on 600/600; BRD says quotation total of zero = not chargeable, AMC PPM and in-contract callouts chargeable | Sharon, Behrouz | DEV-444 | BRD rule: estimate total > 0, or identified AMC work |
| **D-09** | Compliance threshold: 90 % or 97 %? | Penalties; **TC12's expected penalty only holds at 97 %** (93 % is compliant at 90 %) | BRD §7 | Sharon, HR | DEV-447 | Setting, no default applied to penalties |
| **D-10** | Who reviews disputes: coordinator, or supervisor/manager? | Workflow and access | BRD §7 | Sharon, HR | DEV-449 | Not built until answered |
| **D-11** | Scope (all field staff or technicians only); lateness tolerance before late = missed; pro-rating the cap mid-month; disciplinary escalation; **HR and legal confirmation under UAE labour law** | Employee penalties | BRD §7 | HR, Sharon | DEV-447, 450 | Penalties calculated and reported only; nothing deducted |
| **D-12** | Digest send time; days before a pending item counts as aged | E1, N2 | BRD §6.6 suggests 08:00, 7 days | Finance | DEV-439 | Configurable; suggested defaults shown as such |
| **D-13** | Mapping of the BRD's seven quotation statuses onto FSM's real values; validity period; ageing limit per status; escalation of unactioned alerts | Quotation summary | Seen: New, Converted to Work Order, Approved; "Sent", "Rejected", "Revised", "Expired" not in sample | Behrouz | DEV-442 | Map only statuses observed; others shown when they appear |
| **D-14** | How is AMC work identified in FSM? | Exclusions, chargeable, revenue mix | `Work_Type__C = "AMC PPM"` on 5/600; `AMC_Contract_Ref__C` on 3/600; `Type = "Scheduled Maintenance"` 26/600 | Sharon, Danish | DEV-438, 444, 454 | Not inferred |
| **D-15** | Is an appointment "check-in" FSM's `Actual_Start_Date_Time`, and "check-out" `Actual_End_Date_Time`? | Appointment compliance without new FSM scope | Actuals on 402/402 completed appointments | Sharon, FSM admin | DEV-446, 447 | Not assumed |
| **D-16** | Rework, overtime and standby time; roster source of truth (FSM or portal); where rest days come from; **who records leave in the portal** | Available hours | Portal has one shift per technician (`technician_reference.shift`) and org-wide shift times; no rest days or holidays; **5 leave records in total** (counted 20 Oct), so leave is not being entered in the portal today | Sharon, Behrouz | DEV-443, 444, 456 | Portal shift; rest days and holidays configurable, empty until set; unrecorded leave makes a technician look available, so the report says how much leave it found |
| **D-17** | Revenue attribution when more than one technician attends | Revenue report | BRD §7 | Sharon, Danish | DEV-454 | Not built until answered |
| **D-18** | Map Finance, Manager, Coordinator, Verifier, Supervisor, HR, Technician onto portal roles | Permissions | Portal roles today: `admin`, `user`, `inspector` | Sami | DEV-462 | New roles created as rows, assigned by an admin |
| **D-19** | How do technicians see their compliance view? They use the FSM mobile app, not the portal | Self-service, disputes | **115 active technicians, 17 portal users** (counted 20 Oct); no `user_profile` ↔ technician link exists | Sharon | DEV-449 | Not built until answered: portal accounts for ~115 people is a rollout, not a feature |
| **D-20** | Team grouping for reports | Team views | `technician_reference.team_leader_fsm_id` exists | Sharon | DEV-444, 451, 452 | Group by team leader |
| **D-21** | Correcting a wrongly recorded invoice | Records are immutable by design | BRD silent | Finance | DEV-440 | Corrections recorded as new, linked entries; nothing edited |
| **D-22** | Is a working day 8 h or 9 h? | Every available-hours figure | The BRD example uses 8 h a day; the portal's day shift is 08:00–17:00 = **9 h**. Either an unpaid hour is deducted or the example is wrong ([calculation spec](reporting-calculation-specification.md)) | Sharon, HR | DEV-443, 444, TC08 | Unpaid break is a setting, 0 until answered |

## Evidence from the live sync (P2, 20 Oct)

Read-only, from the portal's copy of FSM; counts only.

- **D-01**: on the 38 recently changed work orders read in full, **33 of 41 lines are Completed while their
  work orders are In Progress**. Completion happens at line level in practice.
- **D-02 / D-03**: only **394 of 3,400** work orders link to a quotation, and 5 of 41 recent lines carry one.
  How a queue item finds its quotation (and so its completion %) needs the business's answer.
- **D-05**: FSM's two line amounts (`Line_Item_Amount`, `Amount`) differ on **10 of 41** lines, most likely
  discounts. Which one invoicing uses must be decided.
- **D-13**: across all 1,054 quotations, statuses seen are New, Converted to Work Order, Approved and
  **Expired** (Expired was not in the recent sample).
- **Utilization (D-08, D-17)**: FSM lists crews of up to **24 technicians** on one appointment. Whether each
  of them is credited the full appointment time is a business rule.
- **B-04**: FSM holds **1,054 quotations** and more than 3,400 work orders (count still running).

## Blockers

| ID | Blocker | Impact | Who can clear it |
|---|---|---|---|
| **B-01** | **The Zoho OAuth token lacks read scopes** beyond Work Orders, Service Appointments and Estimates. Trips, time sheets/check-ins, service reports, ratings and field metadata all return `401 OAUTH_SCOPE_MISMATCH` | Travel time (DEV-444), shift check-in and compliance (DEV-445, 447, 448, 450, 451), ratings (DEV-454), completion report link (DEV-436). Whether those modules exist cannot even be checked | A Zoho admin re-authorises the OAuth client with the extra **read** scopes and refreshes the stored token. Exact scope names come from the Zoho FSM API console |
| **B-02** | **Privilege escalation on production.** `roles`, `role_access`, `user_profile` are writable with the public anon key; `/api/role-access` has no auth check on `main`. The fix (`20261006160000`) is held because live code writes these tables from the browser | Independent of this project: any signed-in user can make themselves admin today. This branch's port closes it only when this branch deploys | The user. Shipping the ported security layer to `main` on its own would close it sooner; that change touches `main` and is the user's call |
| **B-03** | FSM API allowance unknown — the probe got a 401 without rate-limit headers | Sync budget and alert frequency (N5/N6) | Read from the Zoho console |
| **B-04** | FSM record volumes unknown | Backfill size and duration | A count run once B-01 is cleared, or from the Zoho console |
| **B-05** | `ZOHO_FSM=read` in `.env` is enforced by **no code on `main`**, while `SNAGGING_FSM_SYNC=on` **enables** writes to production FSM | A local dev server on `main` with that `.env` writes to production FSM despite the comment saying it does not. This branch sets every write flag `off` | The user (their `.env`, their call) |
| **B-06** | `bun.lock` on `main` is out of sync with `package.json` — `bun install --frozen-lockfile` fails | Reproducible installs | A lockfile refresh commit on `main` |
| **B-07** | Schema not reproducible from migrations: `snagging_jobs` and `snagging_clients` base tables were created outside them; `20260917090000` (`lookup_options.color`, `technician_reference.board_position`) is missing from every branch | The database test harness cannot rebuild today's schema from the repo | A schema-only dump from production, or a baseline migration |
| **B-08** | Development runs against the production database (decision of 20 Oct) | Every migration must be additive and harmless to live `main`; the user applies each one | Managed by process: pre/post-check SQL, migration log, finance/HR tables reset at go-live |

## BRD requirements not in Jira

- §6.9 note: track who viewed or exported each report (`report_access_log`).
- §5.1 Step 7: operations can see, for any job, whether it was invoiced, the reference and the date
  (DEV-440 covers recording; the operations view is not a task).
- §6.8 to-dos for verifying exclusions and reviewing disputes (no task names them; planned as in-module
  action queues).
- §5.2 B4: technicians see running compliance all month (DEV-449 covers the view; the running figure needs
  the daily calculation).

## Jira items needing clarification

- **DEV-433**: "Polling/sync frequency agreed with Danish" — proposed 15 minutes incremental (see FSM plan).
- **DEV-459**: "Danish to propose an approach that limits API calls" — the read-through design already on
  `main` is that approach; remaining work is the fallback and conflict rules.
- **DEV-463**: the BRD's Google Sheet link is still "to be added".
- **DEV-438**: blocked by D-06 by its own text.
- **DEV-447 / DEV-449**: open items D-09, D-10, D-11 are named in the task text.
