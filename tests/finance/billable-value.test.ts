import { test } from "node:test";
import assert from "node:assert/strict";

import { billableValue, invoicingFrom, progressCap, type ProgressRow, type StateRow } from "@/lib/server/finance/work-orders";

// Completion % and "to invoice" leave out lines FSM bills as Non Billable (Sami, 9 Nov 2026), in the list and the
// metrics as on the work order page.

const state = (patch: Partial<StateRow>): StateRow => ({
  lineId: "L1",
  workOrderId: "W1",
  name: "Line",
  amount: 1000,
  ready: false,
  invoicedAmount: 0,
  readyAt: null,
  readyBy: null,
  completedAt: null,
  billable: null,
  ...patch,
});

test("what is owed is FSM's total less the non-billable lines; unknown lines count as billable", () => {
  const lines = [state({ lineId: "L1", amount: 1000 }), state({ lineId: "L2", amount: 400, billable: false }), state({ lineId: "L3", amount: 600, billable: true })];
  assert.equal(billableValue(lines, 2000), 1600);
  assert.equal(billableValue([state({ amount: 1000 })], 1000), 1000, "billable not known yet: as before");
  assert.equal(billableValue([], 750), 750, "no lines kept: FSM's total");
  assert.equal(billableValue([], null), null);
  assert.equal(billableValue(lines, null), 1600, "without FSM's total, the lines the portal knows");
});

test("a non-billable line already invoiced still counts what was invoiced", () => {
  assert.equal(billableValue([state({ amount: 400, invoicedAmount: 100, billable: false })], 1000), 700);
});

test("billable lines invoiced in full: Invoiced, nothing left to invoice", () => {
  const lines = [state({ lineId: "L1", amount: 1000, invoicedAmount: 1000, billable: true }), state({ lineId: "L2", amount: 400, billable: false })];
  const inv = invoicingFrom(lines, 1400, true);
  assert.equal(inv.status, "invoiced", "was Partially invoiced, with AED 400 that will never be invoiced");
  assert.equal(inv.remainingValue, 0);
  assert.equal(inv.readyValue, 0);
});

test("an Operations % never allows a non-billable line to be invoiced", () => {
  const entries: ProgressRow[] = [
    { id: "p1", workOrderId: "W1", lineId: null, lineName: null, percent: 50, purpose: "invoice", valueBeforeVat: 1400, note: null, recordedBy: null, recordedAt: "2026-11-01T08:00:00Z" },
  ];
  const lines = [state({ lineId: "L1", amount: 1000, billable: true }), state({ lineId: "L2", amount: 400, billable: false })];
  assert.equal(progressCap(entries, lines, 1400, "In Progress"), 500, "50 % of the billable AED 1,000 only");
});
