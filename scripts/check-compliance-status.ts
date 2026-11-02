// Self-check for the compliance status engine (FRD AC-09 to AC-17, D7).
//
//   bun scripts/check-compliance-status.ts
//
// Pins "today" to 23 Oct 2026 (Dubai), the date the FRD examples use, and
// exits non-zero on the first failing expectation. No test framework: the
// repo has none, and this keeps `tsc` and `eslint` clean.

import { certificateStatus, daysToExpiry, identityStatus, statusFromDays } from "@/lib/compliance/status";
import { nearestExpiry } from "@/lib/compliance/nearest";
import { actionRequired } from "@/lib/compliance/statuses";

const TODAY = "2026-10-23";
let failures = 0;

function expect(label: string, actual: unknown, wanted: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${JSON.stringify(actual)}${ok ? "" : `, wanted ${JSON.stringify(wanted)}`}`);
  if (!ok) failures += 1;
}

// AC-09 to AC-14 boundary dates (section 5 of the FRD).
expect("AC-10 22 Jan 2027 = 91 days", daysToExpiry("2027-01-22", TODAY), 91);
expect("AC-10 91 days is Valid", identityStatus("2027-01-22", TODAY).status, "valid");
expect("AC-09 21 Jan 2027 = 90 days is Due in 90", identityStatus("2027-01-21", TODAY).status, "due_90");
expect("61 days is Due in 90", statusFromDays(61), "due_90");
expect("AC-11 22 Dec 2026 = 60 days is Due in 60", identityStatus("2026-12-22", TODAY).status, "due_60");
expect("31 days is Due in 60", statusFromDays(31), "due_60");
expect("AC-12 22 Nov 2026 = 30 days is Due in 30", identityStatus("2026-11-22", TODAY).status, "due_30");
expect("AC-13 24 Oct 2026 = 1 day is Due in 30", identityStatus("2026-10-24", TODAY).status, "due_30");
expect("AC-14 23 Oct 2026 = 0 days is Expired (D7)", identityStatus("2026-10-23", TODAY), { status: "expired", days: 0 });
expect("22 Oct 2026 = -1 day is Expired", identityStatus("2026-10-22", TODAY), { status: "expired", days: -1 });

// AC-15 missing expiry and not held.
expect("AC-15 identity with no date is Missing expiry", identityStatus(null, TODAY), { status: "missing_expiry", days: null });
expect("AC-15 held expiring cert with no date is Missing expiry", certificateStatus({ held: true, expiry: null, expires: true }, TODAY).status, "missing_expiry");
expect("AC-15 not held has no days", certificateStatus({ held: false, expiry: "2027-01-01", expires: true }, TODAY), { status: "not_held", days: null });
expect("AC-07 held non-expiring type is Valid with no days", certificateStatus({ held: true, expiry: null, expires: false }, TODAY), { status: "valid", days: null });

// AC-16 and AC-17 nearest expiry.
const eid = identityStatus("2027-06-04", TODAY);
const passport = identityStatus("2026-08-01", TODAY);
const cert = certificateStatus({ held: true, expiry: "2027-04-02", expires: true }, TODAY);
const nearest = nearestExpiry([
  { key: "emirates_id", label: "Emirates ID", status: eid.status, days: eid.days, expiry: "2027-06-04" },
  { key: "passport", label: "Passport", status: passport.status, days: passport.days, expiry: "2026-08-01" },
  { key: "cert:scaffolding", label: "Scaffolding", status: cert.status, days: cert.days, expiry: "2027-04-02" },
  { key: "cert:dccs", label: "DCCS", status: "not_held", days: null, expiry: null },
]);
expect("AC-16 nearest is the expired passport", nearest && { key: nearest.key, days: nearest.days }, { key: "passport", days: -83 });
const tie = nearestExpiry([
  { key: "emirates_id", label: "Emirates ID", status: "due_30", days: 10, expiry: "2026-11-02" },
  { key: "passport", label: "Passport", status: "due_30", days: 10, expiry: "2026-11-02" },
]);
expect("AC-16 tie goes to Emirates ID", tie?.key, "emirates_id");
expect("AC-17 all not held or missing gives None", nearestExpiry([
  { key: "emirates_id", label: "Emirates ID", status: "missing_expiry", days: null, expiry: null },
  { key: "cert:x", label: "X", status: "not_held", days: null, expiry: null },
]), null);

// FR-7 action labels (D12).
expect("D12 expired", actionRequired("expired"), "Renew Immediately");
expect("D12 due 30", actionRequired("due_30"), "Start Renewal Now");
expect("D12 due 60", actionRequired("due_60"), "Prepare Documents");
expect("D12 due 90", actionRequired("due_90"), "Plan Renewal");
expect("D12 missing", actionRequired("missing_expiry"), "Enter expiry date");
expect("D12 valid", actionRequired("valid"), "No Action");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll compliance status checks passed");
