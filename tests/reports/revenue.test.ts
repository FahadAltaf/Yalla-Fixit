import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRevenue, splitByHours, type RevenueCrew, type RevenueRating, type RevenueWorkOrder } from "@/lib/reports/revenue";

const wo = (patch: Partial<RevenueWorkOrder>): RevenueWorkOrder => ({
  id: "W1",
  number: "WO-1",
  clientName: "Client A",
  completedAt: "2026-10-15T08:00:00Z",
  completedDate: "2026-10-15",
  value: 1000,
  valueSource: "work_order",
  amc: false,
  ...patch,
});
const rating = (patch: Partial<RevenueRating>): RevenueRating => ({
  id: "R1",
  workOrderId: "W1",
  clientName: "Client A",
  technicianIds: ["T1"],
  stars: 5,
  date: "2026-10-15",
  ...patch,
});
const technicians = new Map([
  ["T1", { name: "Tech One", teamName: "Lead's team" }],
  ["T2", { name: "Tech Two", teamName: "Lead's team" }],
  ["T3", { name: "Tech Three", teamName: "No team" }],
]);

test("a shared job is split by the hours each technician worked on it, to the fils", () => {
  const split = splitByHours(1000, { technicianIds: ["T1", "T2"], minutes: { T1: 180, T2: 60 } });
  assert.equal(split.basis, "hours");
  assert.deepEqual(
    split.shares.map((s) => [s.technicianId, s.amount, s.percent]),
    [
      ["T1", 750, 75],
      ["T2", 250, 25],
    ],
  );
  /* Thirds of 100 AED still add up to 100.00. */
  const thirds = splitByHours(100, { technicianIds: ["T1", "T2", "T3"], minutes: { T1: 60, T2: 60, T3: 60 } });
  assert.equal(Math.round(thirds.shares.reduce((s, x) => s + x.amount, 0) * 100), 10000);
  assert.deepEqual(thirds.shares.map((s) => s.amount), [33.34, 33.33, 33.33]);
});

test("no hours known: equal shares; nobody on it: unassigned", () => {
  const equal = splitByHours(900, { technicianIds: ["T1", "T2", "T3"], minutes: {} });
  assert.equal(equal.basis, "equal");
  assert.deepEqual(equal.shares.map((s) => s.amount), [300, 300, 300]);
  assert.deepEqual(splitByHours(500, { technicianIds: [], minutes: {} }), { basis: "unassigned", shares: [] });
  assert.deepEqual(splitByHours(500, undefined), { basis: "unassigned", shares: [] });
});

test("revenue by client, technician and month, with the AMC mix, invoiced and ratings", () => {
  const result = computeRevenue({
    workOrders: [
      wo({ id: "W1", value: 1000 }),
      wo({ id: "W2", number: "WO-2", clientName: "Client B", value: 600, amc: true, completedAt: "2026-11-02T08:00:00Z", completedDate: "2026-11-02" }),
      wo({ id: "W3", number: "WO-3", value: 0, valueSource: "none" }),
      wo({ id: "W4", number: "WO-4", clientName: "Client B", value: 400, valueSource: "quotation" }),
    ],
    crews: new Map<string, RevenueCrew>([
      ["W1", { technicianIds: ["T1", "T2"], minutes: { T1: 180, T2: 60 } }],
      ["W2", { technicianIds: ["T2"], minutes: {} }],
      ["W3", { technicianIds: ["T1"], minutes: { T1: 30 } }],
    ]),
    ratings: [
      rating({ id: "R1", workOrderId: "W1", technicianIds: ["T1", "T2"], stars: 5 }),
      rating({ id: "R2", workOrderId: "W2", clientName: "Client B", technicianIds: ["T2"], stars: 3, date: "2026-11-02" }),
    ],
    invoicedByWorkOrder: new Map([["W1", 500]]),
    technicians,
  });

  const s = result.summary;
  assert.equal(s.revenue, 2000);
  assert.equal(s.workOrders, 4);
  assert.equal(s.amc, 600);
  assert.equal(s.oneTime, 1400);
  assert.equal(s.amcPercent, 30);
  assert.equal(s.invoiced, 500);
  assert.equal(s.invoicedPercent, 25);
  assert.equal(s.averageRating, 4);
  assert.equal(s.ratings, 2);
  assert.equal(s.unassigned, 400, "nobody from the technician list on W4");
  assert.equal(s.unassignedWorkOrders, 1);
  assert.equal(s.equalSplitWorkOrders, 1, "W2: one technician, no hours");
  assert.equal(s.noValueWorkOrders, 1);
  assert.equal(s.quotationValued, 1);

  assert.deepEqual(
    result.clients.map((c) => [c.name, c.revenue, c.workOrders, c.amc, c.sharePercent, c.averageRating]),
    [
      ["Client A", 1000, 2, 0, 50, 5],
      ["Client B", 1000, 2, 600, 50, 3],
    ],
  );
  /* T1: 750 of W1 + 0 of W3; T2: 250 of W1 + all 600 of W2; unassigned last by value. Totals add up to 2000. */
  assert.deepEqual(
    result.technicians.map((t) => [t.name, t.revenue, t.workOrders, t.minutes, t.averageRating, t.ratings, t.equalSplits]),
    [
      ["Tech Two", 850, 2, 60, 4, 2, 1],
      ["Tech One", 750, 2, 210, 5, 1, 0],
      ["Not on the technician list", 400, 1, 0, null, 0, 0],
    ],
  );
  assert.equal(result.technicians.reduce((sum, t) => sum + t.revenue, 0), 2000);
  /* Invoiced follows the revenue share: T1 has 3/4 of W1's 500. */
  assert.equal(result.technicians.find((t) => t.key === "T1")?.invoiced, 375);

  assert.deepEqual(
    result.months.map((m) => [m.label, m.revenue, m.workOrders, m.averageRating]),
    [
      ["Oct 2026", 1400, 3, 5],
      ["Nov 2026", 600, 1, 3],
    ],
  );
  assert.deepEqual(result.workOrders.map((w) => w.id), ["W2", "W1", "W3", "W4"], "most recently completed first");
  assert.equal(result.workOrders.find((w) => w.id === "W1")?.basis, "hours");
});
