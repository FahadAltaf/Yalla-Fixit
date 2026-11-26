import { test } from "node:test";
import assert from "node:assert/strict";

import { contractTypeOf, parseTracker, perYearFromWords, readCsv, trackerDate, trackerSummary } from "@/lib/amc/tracker-import";

/* DEV-486 (26 Nov 2026): the department tracker, read into contracts. Made-up rows, the tracker's layout. */

const HEAD1 = ["Proposal No.", "Contract Type", "Start Date", "Expiry Date", "Customer ID", "Customer Name", "Mobile", "Email", "Unit No.", "Building", "Community", "Area", "Property Type", "Bedrooms", "AC Units", "AC Service", "", "", "Electrical PPM", "", "Handyman Hrs", "Pest Control", "Emergency Call-out", "Total AED (VAT incl.)", "Payment Terms", "Handler"];
const HEAD2 = ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "1st", "2nd", "3rd", "1st", "2nd", "", "1st", "", "", "", ""];
const row = (cells: Record<number, string>) => HEAD1.map((_, i) => cells[i] ?? "");
const csv = (...rows: string[][]) =>
  [["CONTRACT", "", "", "", "CUSTOMER"], HEAD1, HEAD2, ...rows].map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

const TODAY = "2026-11-26";

test("dates, frequencies and contract types as the tracker writes them", () => {
  assert.equal(trackerDate("05-Jul-2026"), "2026-07-05");
  assert.equal(trackerDate("01-Sep-25"), "2025-09-01");
  assert.equal(trackerDate("31-Feb-2026"), null);
  assert.equal(trackerDate("N/A"), null);
  assert.equal(perYearFromWords("Quarterly – no visit logged"), 4);
  assert.equal(perYearFromWords("Biannual - no visit logged"), 2);
  assert.equal(perYearFromWords("24x/yr - no visit logged"), 24);
  assert.equal(perYearFromWords("36xyr"), 36);
  assert.equal(contractTypeOf("Annual- non comprehensive"), "non_comprehensive");
  assert.equal(contractTypeOf("Annual - Semi-Comprehensive"), "semi_comprehensive");
  assert.equal(contractTypeOf("Annual - AC Only"), "ac_only");
  assert.deepEqual(readCsv('a,"b, ""c""",d\r\n1,2,3'), [["a", 'b, "c"', "d"], ["1", "2", "3"]]);
});

test("a row becomes a contract: client kept as the tracker shows, services, one visit per date, done before today", () => {
  const p = parseTracker(
    csv(
      row({ 0: "15001", 1: "Annual - non-comprehensive", 2: "01-Jan-2026", 3: "31-Dec-2026", 4: "YFI-1234", 5: "Test Client", 6: "050 000 0000", 7: "a@x.ae / b@x.ae", 8: "101", 9: "Tower A", 10: "JLT", 11: "Dubai", 12: "Apartment", 13: "2 BR", 14: "3", 15: "10-Feb-26", 16: "10-Jun-26", 17: "10-Dec-26", 18: "10-Feb-26", 19: "10-Jun-26", 20: "12", 21: "Quarterly – no visit logged", 22: "Unlimited", 23: "4,500.00", 25: "RALPH" }),
    ),
    TODAY,
  );
  assert.deepEqual(p.problems, []);
  const [c] = p.contracts;
  assert.equal(c.customer.ref, "YFI-1234", "kept as the tracker shows it");
  assert.deepEqual([c.customer.email, c.customer.otherEmails], ["a@x.ae", ["b@x.ae"]]);
  assert.equal(c.status, "active");
  assert.equal(c.contractType, "non_comprehensive");
  assert.equal(c.totalAed, 4500);
  assert.equal(c.handler, "RALPH");
  const svc = Object.fromEntries(c.services.map((s) => [s.column, s]));
  assert.equal(svc["AC Service"].perYear, 3, "visits four months apart: three a year");
  assert.equal(svc["Handyman Hrs"].quantity, 12);
  assert.equal(svc["Pest Control"].perYear, 4, "frequency from the tracker's words, with no visit logged");
  assert.equal(svc["Emergency Call-out"].unlimited, true);
  assert.deepEqual(
    c.visits.map((v) => [v.date, v.state, v.services.length]),
    [["2026-02-10", "done", 2], ["2026-06-10", "done", 2], ["2026-12-10", "planned", 1]],
  );
  assert.ok(c.issues.some((i) => /No payment terms/.test(i)), "no terms: no instalments (DEV-486)");
});

test("visits before a contract's start go on an earlier contract it renews; a later row for the same unit renews the earlier one", () => {
  const p = parseTracker(
    csv(
      /* The tracker moved the dates to the new term; the visits are the year before. */
      row({ 1: "Annual - non-comprehensive", 2: "01-Sep-2026", 3: "31-Aug-2027", 4: "YFI1491", 5: "Cafe One", 8: "G1", 9: "Gate Village", 10: "DIFC", 15: "01-Sep-25", 16: "01-Mar-26", 23: "26,250.00" }),
      /* The same flat under a new Customer ID: still the same holder by name. */
      row({ 0: "14845", 1: "Annual - non-comprehensive", 2: "01-Mar-2025", 3: "28-Feb-2026", 4: "YFI2622", 5: "Andrew Example", 8: "438", 9: "Pantheon", 10: "JVC", 15: "10-Mar-25", 23: "2,750.00" }),
      row({ 0: "16515", 1: "Annual- non comprehensive", 2: "21-Nov-2026", 3: "20-Nov-2027", 4: "YFI2407", 5: "Andrew Example", 8: "438", 9: "Pantheon", 10: "JVC", 23: "3,000.00" }),
    ),
    TODAY,
  );
  const s = trackerSummary(p);
  assert.equal(s.fromFile, 3);
  assert.equal(s.earlierTerms, 1, "one contract made for the cafe's earlier term");
  const cafe = p.contracts.find((c) => c.customer.name === "Cafe One" && !c.synthesized)!;
  const earlier = p.contracts[cafe.renewsIndex!];
  assert.equal(earlier.synthesized, true);
  assert.deepEqual([earlier.startDate, earlier.endDate, earlier.status], ["2025-09-01", "2026-08-31", "expired"]);
  assert.deepEqual(earlier.visits.map((v) => v.date), ["2025-09-01", "2026-03-01"]);
  assert.equal(cafe.visits.length, 0, "the current term starts with no visits of the year before");
  const andrew = p.contracts.filter((c) => c.customer.name === "Andrew Example");
  const renewal = andrew.find((c) => c.proposalNumber === "16515")!;
  assert.equal(p.contracts[renewal.renewsIndex!].proposalNumber, "14845", "linked though the Customer ID changed");
});

test("a row without a name or valid dates is left out and said why; a file that is not the tracker is refused", () => {
  const p = parseTracker(csv(row({ 2: "01-Jan-2026", 3: "31-Dec-2026" }), row({ 5: "No Dates" })), TODAY);
  assert.equal(p.contracts.length, 0);
  assert.equal(p.problems.length, 2);
  assert.match(parseTracker("a,b\n1,2", TODAY).problems[0], /not the AMC tracker/);
});
