# Decisions: Manpower Compliance module

Business decisions D1 to D18 and follow-ups F1 to F3 are in the FRD and in the root `DECISIONS.md` (entries dated 2026-10-26). This file holds build decisions taken during planning and implementation.

## 2026-10-26 — Plan decisions (project_planner, pending Sami's confirmation where marked)

- Status: proposed; items marked CONFIRM need Sami's yes
- Source: project_planner report of 26 Oct 2026, based on FRD v0.9.3 and the repository

1. F4 overdue cadence: 7 days, anchored on the expiry date, stored in `compliance_settings.overdue_repeat_days` (1 to 90). Anchoring makes the dedupe key deterministic.
2. F5 site assignment: set by hand from the FSM client list (client, optional project location). Suggesting from the latest appointment is deferred (FSM search carries no crew).
3. F7 role key for training requirements: the compliance designation (`lookup_options` key `compliance_designation`); the requirements table references `lookup_options(id)` so switching to the scheduling technician role later is a data change.
4. Full-number access: a per-user allowlist table `compliance_identity_viewers`, admin-gated and audited. Not a role (one role per user would over-grant) and not a `user_profile` flag (writable through the open GraphQL proxy until S0). CONFIRM.
5. "Active" set: KPI Active and reminders cover Active + On Leave (119 today), per D11 context; AC-46 says 118. CONFIRM.
6. D11 enforcement: effective status computed at read time; linked + `technician_reference.is_active=false` => Inactive "since deactivated_at". Linked and FSM-active employees can only be Active or On Leave and cannot be archived. Unlinked staff edited by hand.
7. Technician link: real FK `fsm_resource_id -> technician_reference(fsm_resource_id) ON DELETE RESTRICT`, so the FSM sync keeps linked technicians as inactive rows (its existing 23503 fallback) instead of deleting them, preserving the D11 signal. Consequence: linked technicians are never pruned. CONFIRM.
8. Site reference: `site_client_id -> snagging_clients(id)`, `site_property_id -> snagging_properties(id)`, both ON DELETE SET NULL, FKs added only when those tables exist (no migration in the repo creates `snagging_clients`).
9. Missing expiry: on the reminder list, not in reminder emails (thresholds need a date).
10. Status is computed at read time, never stored.
11. Nationality belongs to the HR-owned employment group. CONFIRM (D15 does not name it).
12. Employment status is a fixed check-constrained set, not a managed list.
13. The scheduling ManageListDialog is duplicated into the module, not extracted, so scheduling files stay untouched while Danish's work is in flight.
14. FR-11 warnings travel inside the `data` object of the schedule entry responses (executeRESTBackend drops top-level fields) plus a pre-check endpoint.
15. Reveal audit rows are written and awaited before the full number is returned (not after the response, unlike snagging audit).
16. Status self-check script `scripts/check-compliance-status.ts` run with bun (no test framework). CONFIRM.
17. Local import `--apply` redacts identity numbers by default (docs/LOCAL-SUPABASE.md rule on real data).

## 2026-10-27 — Sami's confirmations

- Items 4, 5, 7 and 16 above: confirmed. Item 7 amended: the portal keeps a Deactivate action for linked employees, but it only sends a request email to Sami and Sharon (configurable recipients) and shows a popup; the status does not change until FSM shows the technician inactive. Unlinked employees are deactivated directly in the portal.
- Environment: YFI modules may be developed and verified against the production Supabase project. Test employees use Maher IDs prefixed `TEST-` and are deleted by SQL before the real import. Migrations are still applied one at a time with approval and a LIVE_CHANGE_PLAN entry.

## 2026-10-27 — Review findings applied (code_reviewer, Phase 1)

- Fixed: M1 unchanged employment status is never re-validated, so FSM-overridden records can still be edited; M2 the D11 status rule is enforced on create and against the link as it will be after the patch; M3 list delete sends the id as a query parameter (the browser helper sends no body on DELETE); M4 audit rows are written before the data in updateEmployee, setArchived and the deactivation request (over-record rather than under-record; a Postgres function would be the proper fix and is noted for phase 2); L1 writes use a fetch wrapper that keeps the per-field messages; L2 a duplicate technician link gets its own message; L4 deactivated portal users are refused by the module guards; L5 the users search strips filter syntax and filters is_active in the query; L7 a project location must belong to the chosen client; L8 the New page needs Create, settings Add needs Create, settings Edit needs Edit; L9 the expired KPI links to the active-manpower list; L10 the reminder list has a site filter; L11 the employee read tolerates a missing technician_reference.deactivated_at; L12 "inactive since" is shown in the Dubai zone.
- Accepted as is: H1 (S0, after both modules, TEST- rows only until then); L3 unlinking an FSM-active technician before archiving is allowed and audited (a wrong link must be correctable); L6 no per-day throttle on deactivation requests (audit first makes a retry visible).
- Source: code_reviewer report of 27 Oct 2026; test_verifier confirmed the gates the same day.

## 2026-10-27 — Settings location, import brought forward, migration observed applied

- Compliance settings moved from /compliance/settings to /settings/compliance under the admin Settings group (Sami's request after the first look). The COMPLIANCE_SETTINGS permission key is unchanged; the Settings group itself is shown to admins only, like Snagging and AMC settings.
- The phase 3 import script (scripts/import-manpower-tracker.ts) was brought forward so the module can be tested with the real sheet. Default: identity numbers are replaced by synthetic ones of the same shape; `--real-identity` loads the real numbers. Reason: S0 (open role-permissions route) is not yet fixed. Sites are left Unassigned until the workbook-to-FSM-client map is confirmed (D4, phase 3). Rollback by import_batch_id.
- Observed by the dry run on 27 Oct 2026: the core migration is applied on the production project and seven certificate types exist; two names did not match "Scaffolding" and "DCCS" and must be renamed before `--apply`.
- Dry run figures as of 27 Oct 2026: 127 rows, 3 held back (duplicate Employee ID x2, no Employee ID x1), 124 importable, 117 active manpower.

## 2026-10-27 — Roster freshness without cron

- The senior developer is against scheduled jobs (cron). The FSM roster is therefore kept fresh for the compliance module by: (2) a "Refresh from FSM" button on the employees list and the employee record (Compliance Edit), which runs Scheduling's sync; (3) the employee record refreshing on open when the copy is older than 15 minutes; the list, overview and new pages keep the six-hour rule. Implemented in lib/server/compliance/roster.ts and app/api/compliance/technicians/refresh.
- Consequence for phase 4: the reminder job cannot rely on pg_cron either. The trigger must be reconsidered (for example a request-driven run when a compliance page opens, or an external caller Danish approves). To be decided before phase 4 starts.
- Read-model fix: a retired certificate type stays on a record only while the employee holds it; a leftover "Not held" row no longer keeps it visible. The record view now labels retired types.

## 2026-10-27 — Full identity numbers as a role-granted right (D2 applied)

- Decision: full Emirates ID and passport numbers are shown only to roles holding the new permission key `compliance_identity` (View), granted on the Permissions screen and listed in NOT_INHERITED_BY_ADMIN so an admin role does not get it by default. Jesusa (currently role "user") is to be moved to a manager role after deployment, reviewed with Sharon. The per-user allowlist table from the plan is not built.
- Mechanics: POST /api/compliance/employees/[id]/identity/reveal, Compliance View plus the identity right, audit row written and awaited before the number is returned (event reveal, masked value), Cache-Control no-store; the record shows Show/Hide beside each masked number for holders of the right.
- Still gated by S0: until Danish authenticates /api/role-access, this right could be self-granted, so no real identity numbers are loaded (the import uses synthetic numbers) until then.
- Source: Sami, 27 Oct 2026.

## 2026-10-29 — Sharon's action points of 28 Oct (C1 to C10)

- Source: "YFI Action Points for Sami - Compliance Module" (one-on-one with Sharon, 28 Oct 2026).
- C1 done in code: admins inherit the identity-numbers right again (removed from NOT_INHERITED_BY_ADMIN), overriding the 27 Oct "named people only" rule. Managers already hold it by grant. Role grants to change on the Permissions screen (data, by Sami): manager loses Compliance Delete and Export; user keeps Compliance View only (its Compliance settings rows go).
- C2 built for certificates only: migration 20261029120000_compliance_documents.sql (table + private bucket "compliance", PDF/JPG/PNG, 10 MB), upload/list/open route under /api/compliance/employees/[id]/documents, files shown on held certificates and linked from the reminder list. Seeing or opening a file needs the identity-numbers right; uploading also needs Compliance Edit. Every upload is kept; the newest is current. Emirates ID / passport copies are behind IDENTITY_COPIES_ENABLED, waiting on Sharon's answer.
- C7: nationality and employment status added to the required fields (now Maher ID, full name, designation, nationality, date of joining, status). Final list waits on Sharon and Riyaz.
- C9: settings page uses pill tabs like AMC settings, open tab kept in ?view=.
- Waiting: C3 (current site from the latest FSM appointment: definition to confirm with Sharon or Riyaz), C4 and C6 (Danish: scheduled jobs and the shared employee list), C5 (the repeating reminder emails Sharon receives are not from this module, which sends no reminders yet; source to identify), C8 (clean sheet from the team; test records deleted only on Sami's word), C10 (demo to Riyaz after C1 to C9).

## 2026-10-29 — Sami's answers on C3 to C10

- C3: current site = client and address of the appointment the linked FSM technician is on now; blank when none. Built in lib/server/compliance/site-sync.ts, reading the scheduling board's current version for today and yesterday (no Zoho calls); cancelled and free-text entries never count. The manual site picker is removed from the form; the record shows source and last check.
- C4: scheduled jobs are used regardless of the senior developer's objection (Sami's decision). Route POST /api/compliance/jobs/site-sync (CRON_SECRET, timing-safe), every 15 minutes via pg_cron + pg_net with the secret in Vault (supabase/compliance-cron.sql, run by hand after deploy); every run logged in compliance_job_runs. The "Refresh from FSM" button also recomputes sites, logged as manual.
- C5: handled by Sami outside this project.
- C6: a shared, independent people module in the left panel for the technicians list and leave, used by Scheduling and Compliance. Sami manages Scheduling. Design questions in docket section 12 (Q3, Q4) before building.
- C8, C10: later.
- Migrations to apply: 20261029120000_compliance_documents.sql, 20261029130000_compliance_site_sync_and_jobs.sql; then compliance-cron.sql after deploy with CRON_SECRET set on the server.

## 2026-10-30 — Answers to Q1 to Q5

- Q1: keep the rule exactly: site blank between appointments.
- Q2: not understood; re-asked in plain words in the docket (board copy versus asking FSM directly). Default stays the board.
- Q3: yes. Built: lib/server/compliance/link-suggestions.ts, /api/compliance/link-suggestions (Compliance Edit), Settings → Compliance → FSM links. Name matching by word sets; exact matches pre-ticked, likely ones need a clear lead and start unticked; each approved pair goes through updateEmployee (D11 rule, audit). Read-only run 30 Oct: 94 exact, 9 likely, 29 employees and 15 technicians unmatched.
- Q4: plan written in docket section 13 for review (Workforce module: move the screens, not the data; phases W1 to W5; five decisions). Nothing built.
- Q5: no; Emirates ID and passport copies stay off.

## 2026-10-30 — Q2 answered: site from FSM directly, every 6 hours

- The site job reads Zoho FSM, not the scheduling board: a padded appointment search (now -36 h to +12 h, judged by each record's own times), then the full record of each appointment on now for its crew. "On now" = not cancelled/completed/cannot-complete, and In Progress or its scheduled window covers the moment. Two at once: the latest start wins.
- Schedule: every 6 hours (pg_cron '0 */6 * * *' = 04:00, 10:00, 16:00, 22:00 Dubai) plus the Refresh from FSM button. A site can be up to 6 hours old between checks.
- Reuse: fetchAppointmentsBetween, addressText and FsmAppointment exported from lib/server/zoho/import-appointments.ts (export only; Scheduling behaviour unchanged).
- Q3 confirmed ("okay"): the FSM links review screen stands as built.

## 2026-10-31 — Sami's notes after reading the docket

- Q2 follow-up: the record shows the FSM appointment number and work order number (new columns site_fsm_appointment_name and site_fsm_work_order_name, added to the unapplied migration 20261029130000, which is safe to re-run).
- FSM links tab: sticky table header made opaque.
- Files: a "user" account cannot see certificate files because they sit behind the identity-numbers right (built that way under C2). Re-asked as Q7 in the docket; default proposed: Compliance View sees and opens certificate files, upload needs Compliance Edit.
- Q4 / C6 plan revised (docket section 13): Scheduling stays built on FSM users and Compliance on the employee list. One person record on screen; compliance fields stay on compliance_employees, scheduling fields and leave stay on technician_reference and leave_records, edited through Scheduling's existing routes. Only FSM technicians can hold scheduling fields or leave, so non-FSM employees never reach the board or a submission. Bulk editing moves to Workforce People. Shared lists move to Settings → Workforce under a new key "Workforce settings" for admins and managers; Settings → Compliance keeps certificate types, deactivation requests and FSM links. Phases W1 to W4, no Supabase migration. Six decisions open in 13-7. Nothing built.

## 2026-10-31 — Sami's answers on Q7 and section 13

- Q7: keep. Certificate files stay behind the identity-numbers right; the user role cannot see them.
- 13-5 approved (Settings → Workforce, new key "Workforce settings" for admins and managers).
- 13-6: build all phases W1 to W4 today for one release.
- 13-7: name Workforce; People visible with Scheduling View or Compliance View (no new key); Scheduling's Technicians and leave page replaced by Workforce People with "In FSM" on; compliance fields in bulk (designation, nationality, status) yes; leave for staff not in FSM not tracked; build first, then demo Compliance to Riyaz and the Scheduling changes to the operations team (two demo videos).

## 2026-10-31 — Workforce built (W1 to W4)

- Built: Workforce → People (components/dashboard/workforce/people.tsx, moved from Scheduling's Technicians & leave page and extended), person page /workforce/<employee id> or /workforce/fsm-<FSM id> (Profile, Leave, Compliance), Settings → Workforce (six lists). /scheduling/technicians redirects to /workforce?scope=fsm; /compliance/employees redirects to /workforce with its filters. The Compliance Employees menu entry and Compliance settings' designation and nationality tabs are gone.
- Permissions: new key workforce_settings (View, Create, Edit, Delete), granted to managers on the Permissions screen. The list routes accept it or their old key (hasSharedListAction, requireSharedList); everything else still needs its module key. People needs Scheduling View or Compliance View. Non-admins holding a list right get a Settings group with only Workforce.
- Rule kept: only FSM technicians hold scheduling fields and leave; bulk scheduling edits skip people not in FSM; nothing in Workforce writes technician_reference except Scheduling's existing attributes route.
- Review (code_reviewer, 31 Oct): H1 page 0 vs 1 fixed; M1 list access by old keys fixed; L1 list editor follows rights; L2 scope in the address; L3 bulk only on visible people; L4 warning past 500 employees; L5 old status links start on "Active and inactive"; L6 person page refreshes the roster. Accepted: designation/nationality delete shows to Workforce settings Edit holders without Delete (403); 14-0 grants all four.
- Evidence: tsc, eslint (one warning carried over from the moved file), next build, status self-check all pass (test_verifier and own runs, 31 Oct). Runtime checks are docket section 14.

## 2026-10-31 — Leave for the whole workforce (changes 13-7 decision 5)

- Sami: leave for everyone. Linked to FSM: leave stays on the technician (leave_records), shown on the scheduling board as before. Not in FSM: leave on the Workforce profile only.
- Built: migration 20261031120000_workforce_employee_leave.sql (new deny-by-default table employee_leave_records; Scheduling's leave_records untouched, so the board cannot see these rows); /api/workforce/leave (GET by employee with the leave-type list, POST refused for linked employees, PATCH cancel); Leave tab on every person page (components/dashboard/workforce/employee-leave.tsx). Rights: view with Scheduling View or Compliance View, add with Scheduling Create or Compliance Edit, cancel with Scheduling Edit or Compliance Edit. Leave recorded before an employee is linked stays on the profile, read only, and does not move to the board.
- Not applied yet. tsc and eslint clean.
- Leave filter (Sami, 31 Oct, instead of a separate Workforce Leave tab): People has "Leave: anyone / On leave now / Upcoming leave / On leave now or upcoming", covering technician leave and employee leave, kept in ?leave=. Rows not in FSM show their availability. /api/workforce/leave?current=1 lists active, not-ended employee leave.

## 2026-10-31 — Demo videos, test data removed, links checked

- Videos recorded on localhost:3032 against production (Sami's choice): Workforce for the operations team (3:14) and Manpower Compliance for Riyaz and Sharon (3:16), in Documents/Videos with SRT captions. Pipeline: YFI Snagging Web/Tutorials (videos 6 and 7), Kokoro voice, no zoom.
- Bugs found while recording, fixed: person page said "No employee record" while loading; embedded compliance record repeated the name; bulk compliance edits ran one at a time (about 4.5 s each), now five at a time; the code now tolerates the missing appointment-number columns (fallback select, site job saves without them).
- Open: migration 20261029130000 not re-run on production, so the Appointment line shows the Zoho record id until it is.
- TEST- data removed on Sami's word (LIVE_CHANGE_PLAN.md): 8 employees, 2 leave rows, 1 file; register 132 -> 124 (all imported); audit rows kept.
- Links checked (read-only): 103 linked, 93 exact names, 9 with extra or missing middle names that look right, 1 doubtful (SHEHBAZ MEHMOOD -> Shehbaz Yousaf). Not linked yet: JOSELITO PIGAO (exact, but inactive in FSM), RDDOLFO OLLERO JR. (Rodolfo Ollero in FSM), KRISHNA SHAMSHER B.K. (Krishna Shamsher in FSM). No changes made to links.
