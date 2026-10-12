import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AMC_CONFIG_DEFAULTS, AMC_CONFIG_SCHEMAS } from "@/lib/amc/config";
import {
  accessFailures,
  adherence,
  ageing,
  allowanceUse,
  callOutStats,
  chequesByStatus,
  collections,
  contractsAtRisk,
  discountsByLevel,
  enquiryFunnel,
  proposalConversion,
  renewalOutcomes,
  renewalWindows,
  reportPeriod,
  signedValue,
  utilisation,
  visitBacklog,
  workRevenue,
  workingDaysIn,
  type ContractFact,
  type VisitFact,
} from "@/lib/amc/reports";
import { clientReportHtml, type ClientReport } from "@/lib/server/amc/client-report";

/* Phase 12 of the BRD v0.3 plan: client report, operational and commercial reports, dashboard (DEV-410-412, 414). */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const TODAY = "2026-11-15";
const visit = (id: string, status: string, windowStart: string, windowEnd: string, doneAt: string | null = null, contractId = "c1"): VisitFact => ({
  id,
  contractId,
  status,
  windowStart,
  windowEnd,
  doneAt,
});
const contract = (id: string, more: Partial<ContractFact> = {}): ContractFact => ({
  id,
  number: `AMC-${id}`,
  customerName: "Client",
  propertyLabel: "Villa",
  status: "active",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  grandTotal: 1000,
  category: "residential",
  signedAt: "2026-11-02T08:00:00Z",
  renewedByContractId: null,
  renewalProposalStatus: null,
  ...more,
});

test("schedule adherence: done in the period, inside the service window, early or late", () => {
  const visits = [
    visit("a", "completed", "2026-11-01", "2026-11-15", "2026-11-10T06:00:00Z"),
    visit("b", "completed", "2026-11-01", "2026-11-05", "2026-11-09T06:00:00Z"),
    visit("c", "partially_completed", "2026-11-10", "2026-11-20", "2026-11-08T06:00:00Z"),
    visit("d", "completed", "2026-10-01", "2026-10-15", "2026-10-10T06:00:00Z"),
    visit("e", "scheduled", "2026-11-01", "2026-11-15"),
  ];
  assert.deepEqual(adherence(visits, "2026-11-01", "2026-11-30"), { done: 3, within: 1, early: 1, late: 1, percent: 33.3 });
  assert.equal(adherence([], "2026-11-01", "2026-11-30").percent, null, "nothing done reads as no figure, not 0%");
});

test("the backlog: due, overdue, upcoming, pending access, and not completed by reason group", () => {
  const visits = [
    visit("a", "scheduled", "2026-11-10", "2026-11-20"),
    visit("b", "confirmed", "2026-10-01", "2026-10-15"),
    visit("c", "not_scheduled", "2026-12-01", "2026-12-15"),
    visit("d", "pending_access", "2026-11-01", "2026-11-30"),
    visit("e", "not_completed", "2026-11-01", "2026-11-10"),
  ];
  const b = visitBacklog(visits, [{ visitId: "e", outcomeGroup: "access" }, { visitId: "e", outcomeGroup: "client" }, { visitId: "a", outcomeGroup: "access" }], TODAY);
  assert.deepEqual([b.due, b.overdue, b.upcoming, b.pendingAccess, b.notCompleted], [2, 1, 1, 1, 1]);
  assert.deepEqual(b.byReasonGroup, { client: 1, internal: 0, material: 0, access: 1, partial: 0 }, "only trades of visits not done count");
});

test("call outs by priority: SLA met or missed (an unattended one past its deadline is missed), covered or chargeable", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  const base = { coverage: "covered" as const, misuse: false, reportedAt: "2026-11-15T08:00:00Z" };
  const rows = callOutStats(
    [
      { ...base, priority: "emergency", status: "closed", slaMet: true, dueAt: "2026-11-15T10:00:00Z", attendedAt: "2026-11-15T09:30:00Z" },
      { ...base, priority: "emergency", status: "logged", slaMet: null, dueAt: "2026-11-15T10:00:00Z", attendedAt: null, misuse: true },
      { ...base, priority: "emergency", status: "cancelled", slaMet: null, dueAt: null, attendedAt: null },
      { ...base, priority: "non_emergency", status: "scheduled", slaMet: null, dueAt: "2026-11-17T08:00:00Z", attendedAt: null, coverage: "chargeable" },
    ],
    now,
  );
  assert.deepEqual(rows[0], { priority: "emergency", total: 2, met: 1, missed: 1, open: 1, covered: 2, chargeable: 0, misuse: 1, metPercent: 50 });
  assert.deepEqual([rows[1].total, rows[1].missed, rows[1].chargeable, rows[1].metPercent], [1, 0, 1, null]);
});

test("contracts at risk of ending incomplete: an overdue visit, or more visits left than half-months", () => {
  const contracts = [contract("c1", { endDate: "2026-12-01" }), contract("c2", { endDate: "2027-06-30" }), contract("c3", { status: "expired", endDate: "2026-12-01" })];
  const visits = [
    visit("a", "scheduled", "2026-11-20", "2026-11-25", null, "c1"),
    visit("b", "scheduled", "2026-11-25", "2026-11-28", null, "c1"),
    visit("c", "not_scheduled", "2026-10-01", "2026-10-15", null, "c2"),
    visit("d", "scheduled", "2026-12-01", "2026-12-15", null, "c2"),
  ];
  const risk = contractsAtRisk(contracts, visits, TODAY);
  assert.deepEqual(risk.map((r) => r.contractId), ["c1", "c2"]);
  assert.match(risk[0].reasons[0], /2 visits left with 16 days to go/);
  assert.match(risk[1].reasons[0], /1 visit overdue/);
});

test("utilisation against working days; allowance use; access failures by community", () => {
  assert.equal(workingDaysIn("2026-11-01", "2026-11-07", [0], ["2026-11-02"]), 5, "Sunday off and one holiday");
  const u = utilisation([{ fsmId: "T1", name: "Ravi" }, { fsmId: "T2", name: "Ali" }], [{ technicianId: "T1", start: "2026-11-03T05:00:00Z", end: "2026-11-03T09:00:00Z" }], 5);
  assert.deepEqual(u[0], { fsmId: "T1", name: "Ravi", bookedHours: 4, availableHours: 40, percent: 10, jobs: 1 });
  const a = allowanceUse(
    [
      { contractId: "c1", number: "A", customerName: "X", serviceLabel: "AC PPM", entitlementType: "visits", included: 4, used: 3, reserved: 1 },
      { contractId: "c1", number: "A", customerName: "X", serviceLabel: "Helpdesk", entitlementType: "informational", included: null, used: 0, reserved: 0 },
    ],
    new Map([["c1", 2]]),
  );
  assert.deepEqual([a.length, a[0].remaining, a[0].percent, a[0].chargeableCallOuts], [1, 0, 75, 2]);
  const f = accessFailures([
    { community: "Arabian Ranches", outcomeGroup: "access", outcomeReason: "Community" },
    { community: "Arabian Ranches", outcomeGroup: "client", outcomeReason: "No access given" },
    { community: null, outcomeGroup: "access", outcomeReason: "Building" },
    { community: "JVC", outcomeGroup: "internal", outcomeReason: "Vehicle" },
  ]);
  assert.deepEqual(f, [
    { community: "Arabian Ranches", access: 1, noAccessGiven: 1, total: 2 },
    { community: "Not recorded", access: 1, noAccessGiven: 0, total: 1 },
  ]);
});

test("enquiries: by source, owner and month, with conversion and lost reasons", () => {
  const e = enquiryFunnel([
    { enquiredAt: "2026-10-03T08:00:00Z", source: "Website", ownerName: "Sara", stage: "Won", lostReason: null },
    { enquiredAt: "2026-11-03T08:00:00Z", source: "Website", ownerName: "Sara", stage: "Lost", lostReason: "Price" },
    { enquiredAt: "2026-11-05T08:00:00Z", source: "Referral", ownerName: "Omar", stage: "Site Visit", lostReason: null },
  ]);
  assert.deepEqual(e.bySource[0], { key: "Website", total: 2, won: 1, lost: 1, open: 0, conversion: 50 });
  assert.deepEqual(e.byMonth.map((m) => m.key), ["2026-10", "2026-11"]);
  assert.deepEqual(e.lostReasons, [{ reason: "Price", count: 1 }]);
  assert.equal(e.byOwner.find((o) => o.key === "Omar")!.conversion, null, "nothing closed yet");
});

test("proposals and conversion; discounts by approval level", () => {
  const p = [
    { status: "draft", createdAt: "x", finalPrice: 1000, discountPercent: 0, category: null },
    { status: "proposal_sent", createdAt: "x", finalPrice: 2000, discountPercent: 5, category: null },
    { status: "proposal_rejected", createdAt: "x", finalPrice: 3000, discountPercent: 12, category: null },
    { status: "signed", createdAt: "x", finalPrice: 4000, discountPercent: 20, category: null },
  ];
  const c = proposalConversion(p);
  assert.deepEqual([c.created, c.sent, c.accepted, c.rejected, c.signed, c.acceptanceRate, c.signedValue], [4, 3, 1, 1, 1, 33.3, 4000]);
  const levelOf = (d: number) => (d > 15 ? 2 : d > 10 ? 1 : 0);
  const d = discountsByLevel(p, levelOf, (l) => `Level ${l}`);
  assert.deepEqual(
    d.map((r) => [r.name, r.count, r.value]),
    [
      ["No discount", 1, 1000],
      ["Within the coordinator's limit", 1, 2000],
      ["Level 1", 1, 3000],
      ["Level 2", 1, 4000],
    ],
  );
});

test("signed value, ageing, collections, cheques, additional-work revenue, renewals", () => {
  const sv = signedValue([contract("a"), contract("b", { category: "commercial", grandTotal: 500 }), contract("c", { signedAt: "2026-09-01T00:00:00Z" })], "2026-11-01", "2026-11-30");
  assert.deepEqual(sv, [{ month: "2026-11", residential: 1000, commercial: 500, unknown: 0, count: 2, total: 1500 }]);
  const ag = ageing(
    [
      { contractId: "a", dueDate: "2026-12-01", total: 100, received: 0, status: "not_due" },
      { contractId: "a", dueDate: "2026-11-01", total: 100, received: 40, status: "partially_received" },
      { contractId: "a", dueDate: "2026-07-01", total: 100, received: 0, status: "overdue" },
      { contractId: "a", dueDate: "2026-07-01", total: 100, received: 100, status: "received" },
      { contractId: "a", dueDate: "2026-07-01", total: 100, received: 0, status: "written_off" },
    ],
    TODAY,
  );
  assert.deepEqual(ag.map((b) => [b.bucket, b.count, b.amount]), [["Not due", 1, 100], ["0-30", 1, 60], ["31-60", 0, 0], ["61-90", 0, 0], ["90+", 1, 100]]);
  assert.deepEqual(collections([{ receivedOn: "2026-11-02", amount: 50, voided: false }, { receivedOn: "2026-11-03", amount: 70, voided: true }], "2026-11-01", "2026-11-30"), [{ month: "2026-11", amount: 50 }]);
  assert.deepEqual(chequesByStatus([{ status: "bounced", amount: 300 }]).find((c) => c.status === "bounced"), { status: "bounced", count: 1, amount: 300 });
  const wr = workRevenue([
    { status: "shared", total: 100, createdAt: "x" },
    { status: "paid", total: 200, createdAt: "x" },
    { status: "rejected", total: 50, createdAt: "x" },
  ]);
  assert.deepEqual([wr.quoted, wr.approved, wr.paid, wr.rejected, wr.approvalRate], [300, 200, 200, 50, 50]);
  const rn = renewalOutcomes([contract("a", { endDate: "2026-11-20", renewedByContractId: "z" }), contract("b", { endDate: "2026-11-25", renewalProposalStatus: "proposal_sent" }), contract("c", { endDate: "2026-11-28" })], "2026-11-01", "2026-11-30");
  assert.deepEqual(rn, { ending: 3, renewed: 1, inProgress: 1, notStarted: 1, renewalRate: 33.3 });
});

test("the dashboard's renewals in 30, 60 and 90 days; the report period is bounded", () => {
  const w = renewalWindows([contract("a", { endDate: "2026-12-01" }), contract("b", { endDate: "2027-01-20", renewalProposalStatus: "draft" }), contract("c", { endDate: "2027-03-01" })], TODAY);
  /* Ends in 16, 66 and 106 days: the third is past all three windows. */
  assert.deepEqual(w.map((x) => [x.days, x.count, x.started]), [[30, 1, 0], [60, 1, 0], [90, 2, 1]]);
  assert.deepEqual(reportPeriod(null, null, TODAY), { from: "2026-11-01", to: TODAY }, "this month by default");
  assert.deepEqual(reportPeriod("2026-12-01", "2026-11-01", TODAY), { from: "2026-11-01", to: "2026-11-01" }, "a reversed range collapses");
  assert.equal(reportPeriod("2020-01-01", TODAY, TODAY).from, "2024-11-14", "at most two years");
});

test("the client report: residential or commercial opening, visits with photos, call outs, additional work, allowances", () => {
  const report: ClientReport = {
    contract: { id: "c1", number: "AMC-C-2026-0001", customerName: "Sara <Ali>", customerEmail: null, customerPhone: null, propertyLabel: "Villa 12", startDate: "2026-01-01", endDate: "2026-12-31", submissionId: "s1", category: "commercial" },
    owner: { name: "Omar", email: "omar@example.com", phone: null },
    ownerId: "u1",
    intro: AMC_CONFIG_DEFAULTS.clientReport.commercialIntro,
    closing: AMC_CONFIG_DEFAULTS.clientReport.closing,
    scope: [
      { service: "AC PPM", type: "visits", included: 4, used: 2, booked: 0, remaining: 2 },
      { service: "Emergency call out", type: "unlimited", included: null, used: 3, booked: 0, remaining: null },
    ],
    visitsDone: [{ visitNo: 1, date: "2026-03-10T06:00:00Z", status: "completed", services: ["AC PPM"], photos: ["https://example.com/a.jpg"] }],
    visitsRemaining: [{ visitNo: 3, windowStart: "2026-09-01", windowEnd: "2026-09-15" }],
    callOuts: [{ number: "CO-2026-0001", priority: "emergency", issue: "No cooling", reportedAt: "2026-05-01T20:00:00Z", attendedAt: "2026-05-01T21:00:00Z", covered: true, slaMet: true }],
    additionalWork: [{ number: "AW-2026-0001", finding: "Corroded valve", status: "paid", total: 422.73 }],
    asOf: "2026-11-15",
  };
  const html = clientReportHtml(report);
  assert.match(html, /premises/, "the commercial opening");
  assert.match(html, /Sara &lt;Ali&gt;/, "names are escaped");
  assert.match(html, /<img src="https:\/\/example\.com\/a\.jpg"\/>/);
  assert.match(html, /Unlimited/);
  assert.match(html, /CO-2026-0001/);
  assert.match(html, /Total AED 422\.73/);
  assert.match(html, /Visits remaining \(1\)/);
  assert.notEqual(AMC_CONFIG_DEFAULTS.clientReport.residentialIntro, AMC_CONFIG_DEFAULTS.clientReport.commercialIntro);
  assert.equal(AMC_CONFIG_SCHEMAS.clientReport.safeParse({ ...AMC_CONFIG_DEFAULTS.clientReport, closing: "" }).success, false);
});

test("routes: reports need AMC Reports (View); sending the client report needs to operate the contract; migration is additive", () => {
  assert.match(read("app/api/amc-insights/route.ts"), /gate\.can\(ResourceType\.AMC_REPORTS, ActionType\.VIEW\)/);
  const cr = read("app/api/amc-contracts/[id]/client-report/route.ts");
  assert.match(cr, /requireManagedContract\(gate, id, "read"\)/);
  assert.match(cr, /requireManagedContract\(gate, id, "write"\)/);
  const sql = read("supabase/migrations/20261012130000_amc_client_report.sql")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(sql, /'client_report'/);
  assert.doesNotMatch(sql, /amc_submissions|role_access|\bDROP TABLE\b|\bDELETE FROM\b/i);
});
