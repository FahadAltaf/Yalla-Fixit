# Test Matrix: Manpower Compliance module

Status values: untested, passed, failed, blocked. Evidence is the docket round or the command output.

| AC | Phase | Check | Status | Evidence |
|---|---|---|---|---|
| AC-01 | P1 | Save, then found by ID and Total +1 | untested | |
| AC-02 | P1 | Duplicate Maher ID gives 409 with a clear message | passed (DB) | 27 Oct 2026 SQL check: duplicate maher_id insert refused with 23505. UI message still to confirm in docket 1-2. |
| AC-03 | P1 | All 7 certificate types shown on a new record | untested | |
| AC-04 | P1 | 2,000+ characters of remarks persist | untested | |
| AC-05 | P1 | Impossible date rejected (UI and API 400) | passed (API boundary) | 27 Oct 2026: request schema rejects 2026-02-30 with a field message; UI check in docket 1-3. |
| AC-06 | P1 | Not 15 digits gives 400; dashes stripped in storage | passed (API boundary) | 27 Oct 2026: request schema rejects a 14-digit Emirates ID; dashes stripped by the normaliser. UI check in docket 1-3. |
| AC-07 | P1 | Held=Yes no date: Missing expiry (expiring type) or Valid (non-expiring) | untested | |
| AC-08 | P1 | Held=No clears the date; item shows Not held | passed (DB) | 27 Oct 2026 SQL check: no certificate row has held=false with a date. UI part in docket 1-4. |
| AC-09 to AC-14 | P1 | Status check script passes with today 2026-10-23; fixture UI shows bands | passed | 27 Oct 2026: scripts/check-compliance-status.ts 23/23 (self and test_verifier). |
| AC-15 | P1 | Missing expiry and Not held display | passed (engine) | 27 Oct 2026: self-check covers missing_expiry and not_held; UI display in docket 2-3. |
| AC-16 | P1 | Nearest expiry picks lowest days, including expired | passed (engine) | 27 Oct 2026: self-check; UI in docket 2-3. |
| AC-17 | P1 | Nearest expiry shows "None" | passed (engine) | 27 Oct 2026: self-check; UI in docket 2-3. |
| AC-18 | P2 | Dashboard counts equal SQL counts on the fixture | untested | |
| AC-19 | P2 | Unassigned bar for active staff with no site | untested | |
| AC-20 | P2 | One chart per certificate type, titled by name | untested | |
| AC-21 | P2 | Resigned counts in Total only | untested | |
| AC-22 | P1 | ID lookup opens record; unknown shows "No employee found" | untested | |
| AC-23 | P1 | Last 4 characters only, in page and API | passed | 27 Oct 2026: 100 stored numbers tested against 353 KB of record, list and reminder output; none present; only last4. |
| AC-24 | P1 | Reminder list membership matches hand count | untested | |
| AC-25 | P1 | Action labels follow D12 | untested | |
| AC-26 | P1 | Renewal to +91 days removes the row | untested | |
| AC-27 | P4 | One 90-day claim; second run sends nothing | untested | |
| AC-28 | P4 | Catch-up sends "60" only | untested | |
| AC-29 | P4 | Renewal re-arms thresholds | untested | |
| AC-29b | P4 | Weekly `expired:n` repeats | untested | |
| AC-30 | P4 | Archived/inactive/resigned get no claims | untested | |
| AC-31 | P4 | Delivery log complete; no numbers in email | untested | |
| AC-32 | P1 | No menu entry without View; API 403 | untested | |
| AC-33 | P1 | View-only: no edit controls; PATCH/POST 403 | untested | |
| AC-34 | P2 | Reveal writes one audit row; non-allowlisted (admins too) get 403 | untested | |
| AC-35 | P2 | Masked export without the right; no Export => 403 | untested | |
| AC-36 | P1 | Anon REST and GraphQL return no rows for every compliance table (re-run after each migration) | passed | 27 Oct 2026: anon key REST on all six tables returns 42501 permission denied; anon GraphQL exposes no compliance_employeesCollection. |
| AC-37 | P5b | HR-owned group read-only; API 409 | untested | |
| AC-38 | P5b | Training stays editable | untested | |
| AC-39 | P5b | HR update writes masked audit row | untested | |
| AC-40 | P5a | Named non-blocking warning on assignment | untested | |
| AC-41 | P5a | No warning when valid or none required | untested | |
| AC-41b | P5a | Role requirements panel on the record | untested | |
| AC-42 | P3 | Dry run lists rejects; database unchanged | untested | |
| AC-43 | P3 | No reminder-tab import | untested | |
| AC-44 | P3 | Flagged dates in the report | untested | |
| AC-45 | P3 | 82 with a site / 36 Unassigned via the site map | untested | |
| AC-46 | P3 | Report matches targets (note 34 vs 35, 118 vs 119) | untested | |
| AC-47 create/edit/archive | P1 | One immutable audit row per action | passed (create, edit) | 27 Oct 2026: TEST-1001 has 1 create + 4 edit rows by Sami Farah; UPDATE and DELETE on the audit table affected 0 rows. Archive row to confirm in docket 6-2. |
| AC-47 reveal/export | P2 | One immutable audit row per action | untested | |
| AC-47 import | P3 | One immutable audit row per batch | passed | 27 Oct 2026: batch 0198a2c3 has 124 employees and 124 import audit rows plus the batch row. |
| AC-47 hr_sync | P5b | One immutable audit row per update | untested | |
| D11 | P1 | Linked technician set inactive locally => Inactive with note; deactivate hidden | untested | |
| NFR-4 | P2 | Reveal is a POST body, nothing logged | untested | |
