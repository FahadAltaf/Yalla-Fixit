import { test } from "node:test";
import assert from "node:assert/strict";

import { breakdownOf, complianceMonthPhase, type EventOutcome, type TechnicianCompliance } from "@/lib/reports/compliance";
import {
  COMPLIANCE_ALERT_EVENTS,
  disputeRefusal,
  disputeStatus,
  hrReportEmail,
  planComplianceAlerts,
  settledCompliance,
  statementEmail,
  type CompliancePerson,
} from "@/lib/reports/compliance-disputes";

const dubai = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`).toISOString();

const event = (date: string, state: EventOutcome["state"], kind: EventOutcome["kind"] = "shift_check_in", tech = "T1"): EventOutcome => ({
  key: `${tech}|${kind}|${date}`,
  technicianFsmId: tech,
  kind,
  date,
  dueAt: dubai(date, kind === "shift_check_out" ? "17:00" : "08:00"),
  appointmentId: null,
  appointmentNumber: null,
  state,
  recordedAt: state === "performed" ? dubai(date, "08:05") : null,
  waiver: state === "waived" ? { eventKey: `${tech}|${kind}|${date}`, reason: "App outage", waivedBy: "Sup", waivedAt: dubai(date, "12:00") } : null,
});

const compliance = (events: EventOutcome[], threshold: number | null = 90, tech = "T1"): TechnicianCompliance => {
  const performed = events.filter((e) => e.state === "performed").length;
  const missed = events.filter((e) => e.state === "missed").length;
  const waived = events.filter((e) => e.state === "waived").length;
  const required = performed + missed;
  const below = threshold === null ? null : required > 0 && performed * 100 < threshold * required;
  return {
    technicianFsmId: tech,
    required,
    performed,
    missed,
    waived,
    compliancePercent: required ? (performed / required) * 100 : null,
    belowThreshold: below,
    penaltyBeforeCapAed: below === null ? null : below ? missed * 50 : 0,
    penaltyPayableAed: below === null ? null : below ? Math.min(missed * 50, 500) : 0,
    settings: { thresholdPercent: threshold, penaltyPerMissAed: 50, monthlyCapAed: 500 },
    events,
  };
};

const person = (patch: Partial<CompliancePerson> = {}): CompliancePerson => ({
  fsmId: "T1",
  name: "Tech One",
  userId: "U1",
  email: "t1@example.com",
  teamLeaderUserId: "LEAD",
  ...patch,
});

test("TC14: a dispute raised on the 26th is refused; up to the 25th it is accepted", () => {
  const missed = { state: "missed" as const };
  const on25 = complianceMonthPhase("2026-10", "2026-11-25", 25);
  const on26 = complianceMonthPhase("2026-10", "2026-11-26", 25);
  assert.equal(disputeRefusal({ event: missed, phase: on25, finalized: false, alreadyDisputed: false }), null);
  assert.match(disputeRefusal({ event: missed, phase: on26, finalized: false, alreadyDisputed: false }) ?? "", /closed on 2026-11-25/);
  /* While the month runs, a miss can already be disputed. */
  assert.equal(disputeRefusal({ event: missed, phase: complianceMonthPhase("2026-10", "2026-10-20", 25), finalized: false, alreadyDisputed: false }), null);
});

test("only a miss, once, on a month not finalised, can be disputed", () => {
  const phase = complianceMonthPhase("2026-10", "2026-11-10", 25);
  assert.match(disputeRefusal({ event: { state: "performed" }, phase, finalized: false, alreadyDisputed: false }) ?? "", /recorded/);
  assert.match(disputeRefusal({ event: { state: "waived" }, phase, finalized: false, alreadyDisputed: false }) ?? "", /already waived/);
  assert.match(disputeRefusal({ event: { state: "missed" }, phase, finalized: false, alreadyDisputed: true }) ?? "", /already disputed/);
  assert.match(disputeRefusal({ event: { state: "missed" }, phase, finalized: true, alreadyDisputed: false }) ?? "", /finalised/);
  assert.match(disputeRefusal({ event: undefined, phase, finalized: false, alreadyDisputed: false }) ?? "", /not one that was owed/);
  assert.equal(disputeStatus({ decision: null }), "open");
  assert.equal(disputeStatus({ decision: { outcome: "rejected", waiverReason: null, note: "No", decidedBy: "R", decidedAt: "x" } }), "rejected");
});

test("settled compliance leaves out today: a late check-in may still come", () => {
  const events = [event("2026-10-26", "performed"), event("2026-10-27", "missed"), event("2026-10-28", "waived"), event("2026-10-29", "missed")];
  assert.deepEqual(settledCompliance(events, "2026-10-29"), { required: 2, performed: 1, missed: 1, percent: 50 });
});

test("N9: each settled miss of the last three days, once, to the technician's own account", () => {
  const events = [
    event("2026-10-20", "missed"), // too old: a first run sends no backlog
    event("2026-10-27", "missed"),
    event("2026-10-28", "missed", "shift_check_out"),
    event("2026-10-28", "performed"),
    event("2026-10-29", "missed"), // today: not settled
  ];
  const plan = planComplianceAlerts({
    today: "2026-10-29",
    now: dubai("2026-10-29", "07:00"),
    thresholdPercent: 90,
    people: new Map([["T1", person()]]),
    current: { month: "2026-10", results: [compliance(events)] },
    previous: null,
    closedMonth: null,
    supervisorUserIds: [],
  });
  assert.deepEqual(
    plan.misses.map((m) => m.dedupeKey),
    ["n9:T1|shift_check_in|2026-10-27", "n9:T1|shift_check_out|2026-10-28"],
  );
  assert.equal(plan.misses[0].userId, "U1");
  assert.equal(plan.misses[0].event, COMPLIANCE_ALERT_EVENTS.miss);
  /* Settled: 20th, 27th, 28th out, 28th in → 1 of 4. */
  assert.equal(plan.misses[1].body, "You missed the shift check-out on 28 Oct. Compliance this month: 25%.");
  assert.equal(plan.misses[1].link, "/my-compliance?month=2026-10");
});

test("N9 counts, and does not send to, a technician without a portal account", () => {
  const plan = planComplianceAlerts({
    today: "2026-10-29",
    now: dubai("2026-10-29", "07:00"),
    thresholdPercent: 90,
    people: new Map([["T1", person({ userId: null, teamLeaderUserId: null })]]),
    current: { month: "2026-10", results: [compliance([event("2026-10-28", "missed")])] },
    previous: null,
    closedMonth: null,
    supervisorUserIds: [],
  });
  assert.equal(plan.misses.length, 0);
  assert.equal(plan.unreachable, 1);
  assert.equal(plan.belowThreshold.length, 0, "nobody to tell");
});

test("N9 waits for a night shift's check-out to settle", () => {
  const night = { ...event("2026-10-28", "missed", "shift_check_out"), dueAt: dubai("2026-10-29", "08:00") };
  const plan = (now: string) =>
    planComplianceAlerts({
      today: "2026-10-29",
      now,
      thresholdPercent: 90,
      people: new Map([["T1", person()]]),
      current: { month: "2026-10", results: [compliance([night])] },
      previous: null,
      closedMonth: null,
      supervisorUserIds: [],
    }).misses.length;
  assert.equal(plan(dubai("2026-10-29", "09:00")), 0);
  assert.equal(plan(dubai("2026-10-29", "12:30")), 1);
});

test("N10: below the threshold once a month, to the technician, team leader and supervisors", () => {
  const events = [...Array.from({ length: 9 }, (_, i) => event(`2026-10-${String(10 + i).padStart(2, "0")}`, "performed")), event("2026-10-27", "missed"), event("2026-10-28", "missed")];
  const plan = planComplianceAlerts({
    today: "2026-10-29",
    now: dubai("2026-10-29", "07:00"),
    thresholdPercent: 90,
    people: new Map([["T1", person()]]),
    current: { month: "2026-10", results: [compliance(events)] },
    previous: null,
    closedMonth: null,
    supervisorUserIds: ["SUP", "U1"],
  });
  assert.equal(plan.belowThreshold.length, 1);
  const n10 = plan.belowThreshold[0];
  assert.equal(n10.dedupeKey, "n10:T1:2026-10");
  assert.deepEqual(n10.userIds, ["U1", "LEAD", "SUP"]);
  assert.equal(n10.body, "Tech One's compliance dropped to 81.8% (threshold 90%).");

  const atNinety = [...Array.from({ length: 9 }, (_, i) => event(`2026-10-${String(10 + i).padStart(2, "0")}`, "performed")), event("2026-10-28", "missed")];
  const fine = planComplianceAlerts({
    today: "2026-10-29",
    now: dubai("2026-10-29", "07:00"),
    thresholdPercent: 90,
    people: new Map([["T1", person()]]),
    current: { month: "2026-10", results: [compliance(atNinety)] },
    previous: null,
    closedMonth: null,
    supervisorUserIds: [],
  });
  assert.equal(fine.belowThreshold.length, 0, "90% is not below 90%");
});

test("N11 and E2 at month close for everyone who owed anything; N11 closes with the window", () => {
  const plan = planComplianceAlerts({
    today: "2026-11-01",
    now: dubai("2026-11-01", "07:00"),
    thresholdPercent: 90,
    people: new Map([
      ["T1", person()],
      ["T2", person({ fsmId: "T2", name: "Tech Two", userId: null })],
    ]),
    current: { month: "2026-11", results: [] },
    previous: {
      month: "2026-10",
      cutoffDate: "2026-11-25",
      results: [compliance([event("2026-10-27", "missed")]), compliance([], 90, "T2"), compliance([event("2026-10-27", "waived", "shift_check_in", "T3")], 90, "T3")],
    },
    closedMonth: null,
    supervisorUserIds: [],
  });
  assert.deepEqual(
    plan.statements.map((s) => s.person.fsmId),
    ["T1"],
    "T2 owed nothing; T3 is not on the roster",
  );
  const s = plan.statements[0];
  assert.equal(s.n11.body, "Your statement for October 2026 is ready. Disputes close on 25 Nov.");
  assert.equal(s.n11.dedupeKey, "n11:T1:2026-10");
  assert.equal(s.e2.dedupeKey, "e2:T1:2026-10");
  assert.equal(s.e2.title, "Your app compliance statement for October 2026");

  const closing = planComplianceAlerts({
    today: "2026-11-26",
    now: dubai("2026-11-26", "07:00"),
    thresholdPercent: 90,
    people: new Map(),
    current: { month: "2026-11", results: [] },
    previous: null,
    closedMonth: "2026-10",
    supervisorUserIds: [],
  });
  assert.equal(closing.resolveStatementsOf, "2026-10");
});

test("E2 lists each miss and the deadline; the penalty only below the threshold", () => {
  const below = statementEmail({
    month: "2026-10",
    cutoffDate: "2026-11-25",
    name: "Tech One",
    compliance: compliance([event("2026-10-27", "missed"), event("2026-10-28", "performed")]),
    thresholdPercent: 90,
    appUrl: "https://portal.example",
  });
  assert.ok(below.paragraphs.join("").includes("27 Oct"));
  assert.ok(below.paragraphs.join("").includes("<strong>25 Nov</strong>"));
  assert.deepEqual(
    below.details.filter((d) => d.label.startsWith("Penalty")).map((d) => d.value),
    ["AED 50", "AED 50"],
  );
  assert.equal(below.cta.url, "https://portal.example/my-compliance?month=2026-10");

  const fine = statementEmail({
    month: "2026-10",
    cutoffDate: "2026-11-25",
    name: "Tech One",
    compliance: compliance([event("2026-10-28", "performed")]),
    thresholdPercent: 90,
    appUrl: "",
  });
  assert.deepEqual(
    fine.details.filter((d) => d.label.startsWith("Penalty")).map((d) => d.value),
    ["None (at or above 90%)"],
  );
});

test("E3: one row per technician, team totals and the whole", () => {
  const row = (fsmId: string, teamName: string, performed: number, missed: number, payable: number) => ({
    fsmId,
    name: fsmId,
    teamName,
    required: performed + missed,
    performed,
    missed,
    waived: 0,
    compliancePercent: (performed / (performed + missed)) * 100,
    belowThreshold: payable > 0,
    penaltyBeforeCapAed: missed * 50,
    penaltyPayableAed: payable,
  });
  const email = hrReportEmail({
    month: "2026-10",
    rows: [row("A", "Team X", 90, 10, 500), row("B", "Team X", 100, 0, 0), row("C", "Team Y", 50, 50, 500)],
    thresholdPercent: 90,
    appUrl: "",
  });
  const html = email.paragraphs.join("");
  assert.ok(html.includes("Team X: total"));
  assert.ok(html.includes("Team Y: total"));
  assert.ok(html.includes("All technicians"));
  assert.deepEqual(
    email.details.map((d) => d.value),
    ["3", "80%", "2", "AED 1,000"],
  );
});

test("the breakdown behind a technician's figures adds up, by kind of check-in", () => {
  const events = [
    event("2026-10-27", "missed"),
    event("2026-10-27", "missed", "shift_check_out"),
    event("2026-10-28", "performed"),
    event("2026-10-28", "waived", "shift_check_out"),
    { ...event("2026-10-28", "missed", "appointment_check_in"), key: "T1|appointment_check_in|A1", appointmentId: "A1" },
    { ...event("2026-10-28", "performed", "appointment_check_out"), key: "T1|appointment_check_out|A1", appointmentId: "A1" },
  ];
  const b = breakdownOf(events);
  assert.equal(b.days, 2);
  assert.equal(b.appointments, 1);
  assert.deepEqual(b.kinds.shift_check_in, { owed: 2, performed: 1, missed: 1, waived: 0 });
  assert.deepEqual(b.kinds.shift_check_out, { owed: 2, performed: 0, missed: 1, waived: 1 });
  const missed = Object.values(b.kinds).reduce((a, k) => a + k.missed, 0);
  assert.equal(missed, compliance(events).missed, "the kinds add up to the row's missed");
});
