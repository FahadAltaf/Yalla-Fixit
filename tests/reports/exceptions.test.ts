import { test } from "node:test";
import assert from "node:assert/strict";

import { isFlaggedForInvoice, isWorkComplete } from "@/lib/finance/eligibility";
import {
  analyseActualTimes,
  findUnflagged,
  missingOf,
  type ExceptionAppointment,
  type ExceptionEstimate,
  type ExceptionWorkOrder,
} from "@/lib/reports/exceptions";

const TODAY = "2026-10-21";
const wo = (patch: Partial<ExceptionWorkOrder>): ExceptionWorkOrder => ({
  id: "W1",
  number: "WO-1",
  status: "Completed",
  completedAt: "2026-10-15T08:00:00Z",
  estimateId: "E1",
  clientName: "Client A",
  ...patch,
});
const est = (patch: Partial<ExceptionEstimate>): ExceptionEstimate => ({
  id: "E1",
  number: "17001",
  postToMaher: null,
  value: 1000,
  ownerName: "Coordinator One",
  ownerEmail: "coord.one@test.local",
  ...patch,
});

test("eligibility: completed work and the invoice flag (D-01, D-02 placeholders)", () => {
  assert.equal(isWorkComplete({ status: "Completed", completedAt: null }), true);
  assert.equal(isWorkComplete({ status: "closed", completedAt: null }), true);
  assert.equal(isWorkComplete({ status: "In Progress", completedAt: "2026-10-01T00:00:00Z" }), true);
  assert.equal(isWorkComplete({ status: "In Progress", completedAt: null }), false);
  assert.equal(isFlaggedForInvoice({ postToMaher: "To Be Invoiced" }), true);
  assert.equal(isFlaggedForInvoice({ postToMaher: null }), false);
});

test("completed without the flag: only done, valued, unflagged work not yet in the queue; overdue after N days", () => {
  const estimates = new Map(
    [
      est({ id: "E1" }),
      est({ id: "E2", postToMaher: "To Be Invoiced" }),
      est({ id: "E3", value: 0 }),
      est({ id: "E4", number: "17004" }),
      est({ id: "E5", number: "17005" }),
    ].map((e) => [e.id, e]),
  );
  const rows = findUnflagged({
    workOrders: [
      wo({ id: "W1", estimateId: "E1", completedAt: "2026-10-15T08:00:00Z" }), // 6 days: overdue
      wo({ id: "W2", estimateId: "E2" }), // flagged
      wo({ id: "W3", estimateId: "E3" }), // nothing to charge
      wo({ id: "W4", estimateId: "E4", status: "In Progress", completedAt: null }), // not done
      wo({ id: "W5", estimateId: "E5", completedAt: "2026-10-19T08:00:00Z" }), // 2 days: not yet overdue
      wo({ id: "W6", estimateId: null }), // no quotation
      wo({ id: "W7", estimateId: "E1" }), // already queued
    ],
    estimates,
    queuedWorkOrderIds: new Set(["W7"]),
    today: TODAY,
    afterDays: 3,
    timeZone: "Asia/Dubai",
  });
  assert.deepEqual(
    rows.map((r) => [r.workOrderId, r.daysSinceCompleted, r.overdue]),
    [
      ["W1", 6, true],
      ["W5", 2, false],
    ],
  );
  assert.equal(rows[0].coordinatorEmail, "coord.one@test.local");
});

const appt = (patch: Partial<ExceptionAppointment>): ExceptionAppointment => ({
  id: "A1",
  number: "AP-1",
  workOrderId: "W1",
  workOrderNumber: "WO-1",
  clientName: "Client A",
  scheduledStart: "2026-10-20T05:00:00Z",
  actualStart: "2026-10-20T05:10:00Z",
  actualEnd: "2026-10-20T07:00:00Z",
  technicianIds: ["T1"],
  ...patch,
});

test("missing actual times, and data completeness per technician and team", () => {
  assert.equal(missingOf({ actualStart: null, actualEnd: null }), "both");
  assert.equal(missingOf({ actualStart: "x", actualEnd: null }), "end");
  const technicians = new Map([
    ["T1", { fsmId: "T1", name: "Tech One", teamLeaderId: "L1" }],
    ["T2", { fsmId: "T2", name: "Tech Two", teamLeaderId: "L1" }],
    ["L1", { fsmId: "L1", name: "Lead", teamLeaderId: null }],
  ]);
  const result = analyseActualTimes({
    appointments: [
      appt({ id: "A1", technicianIds: ["T1", "T2"] }),
      appt({ id: "A2", actualEnd: null, technicianIds: ["T1"] }),
      appt({ id: "A3", actualStart: null, actualEnd: null, technicianIds: ["T2"] }),
      appt({ id: "A4", technicianIds: ["T1"] }),
    ],
    technicians,
    timeZone: "Asia/Dubai",
  });
  assert.deepEqual(result.overall, { completed: 4, withActualTimes: 2, completenessPercent: 50 });
  assert.deepEqual(
    result.rows.map((r) => [r.id, r.missing]).sort(),
    [
      ["A2", "end"],
      ["A3", "both"],
    ],
  );
  assert.deepEqual(
    result.byTechnician.map((r) => [r.name, r.completed, r.withActualTimes, r.completenessPercent]),
    [
      ["Tech Two", 2, 1, 50],
      ["Tech One", 3, 2, 66.7],
    ],
  );
  assert.deepEqual(
    result.byTeam.map((r) => [r.name, r.completed, r.completenessPercent]),
    [["Lead's team", 5, 60]],
  );
});
