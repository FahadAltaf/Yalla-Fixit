import { test } from "node:test";
import assert from "node:assert/strict";

import { planFsmCompletion, type FsmAppointmentLink } from "@/lib/finance/fsm-completion-plan";
import { financeFsmCompletionEnabled } from "@/lib/server/finance/fsm-completion";

const link = (appointment: string, line: string, status: string, active = true): FsmAppointmentLink => ({
  appointmentId: appointment,
  appointmentName: `AP-${appointment}`,
  lineId: line,
  status,
  active,
});

test("2 Nov: off unless FINANCE_FSM_COMPLETION=on", () => {
  assert.equal(financeFsmCompletionEnabled({}), false);
  assert.equal(financeFsmCompletionEnabled({ FINANCE_FSM_COMPLETION: "yes" }), false);
  assert.equal(financeFsmCompletionEnabled({ FINANCE_FSM_COMPLETION: "on" }), true);
});

test("a line complete: its started appointment is completed when every line on it is complete", () => {
  const plan = planFsmCompletion({
    workOrderStatus: "In Progress",
    links: [link("1", "L1", "In Progress"), link("2", "L2", "In Progress"), link("2", "L3", "In Progress")],
    completeLines: new Set(["L1", "L2"]),
    changedLines: ["L1", "L2"],
    wholeWorkOrder: false,
  });
  assert.deepEqual(plan.complete, [{ appointmentId: "1", appointmentName: "AP-1", completesWorkOrder: false }]);
  assert.equal(plan.skipped.length, 1, "AP-2 also covers L3, not complete yet");
  assert.match(plan.skipped[0].reason, /not complete in the portal/);
  assert.equal(plan.completeWorkOrder, false);
});

test("an appointment not started is never completed from here: that would make up work times", () => {
  const plan = planFsmCompletion({
    workOrderStatus: "Scheduled Appointment",
    links: [link("1", "L1", "Dispatched")],
    completeLines: new Set(["L1"]),
    changedLines: ["L1"],
    wholeWorkOrder: false,
  });
  assert.equal(plan.complete.length, 0);
  assert.match(plan.skipped[0].reason, /made-up work times/);
});

test("the whole work order: started appointments completed, the last one with the work order, then the work order's own Complete", () => {
  const plan = planFsmCompletion({
    workOrderStatus: "In Progress",
    links: [link("1", "L1", "In Progress"), link("2", "L2", "In Progress"), link("3", "L3", "Cancelled", false), link("4", "L4", "Completed")],
    completeLines: new Set(["L1", "L2", "L3", "L4"]),
    changedLines: [],
    wholeWorkOrder: true,
  });
  assert.deepEqual(
    plan.complete.map((a) => [a.appointmentId, a.completesWorkOrder]),
    [
      ["1", false],
      ["2", true],
    ],
  );
  assert.equal(plan.skipped.length, 0, "cancelled and completed appointments are left alone");
  assert.equal(plan.completeWorkOrder, true);
});

test("already Completed or Closed in FSM: nothing to send", () => {
  for (const status of ["Completed", "Closed"]) {
    const plan = planFsmCompletion({ workOrderStatus: status, links: [link("1", "L1", "In Progress")], completeLines: new Set(["L1"]), changedLines: ["L1"], wholeWorkOrder: true });
    assert.equal(plan.alreadyComplete, true);
    assert.equal(plan.complete.length, 0);
  }
});
