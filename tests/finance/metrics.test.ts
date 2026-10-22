import { test } from "node:test";
import assert from "node:assert/strict";

import { computePeriodMetrics, computeQueueMetrics, daysBetween, summarise, type MetricItem } from "@/lib/finance/metrics";

const NOW = new Date("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const items: MetricItem[] = [
  { id: "a", status: "pending", value: 1000, enteredAt: daysAgo(2) },
  { id: "b", status: "in_progress", value: 2500.5, enteredAt: daysAgo(10) },
  { id: "c", status: "on_hold", value: 300, enteredAt: daysAgo(20), holdReason: "Client dispute" },
  { id: "d", status: "query_raised", value: 700, enteredAt: daysAgo(45) },
  { id: "e", status: "excluded", value: 800, enteredAt: daysAgo(30) },
  { id: "f", status: "invoiced", value: 25000, enteredAt: daysAgo(12) },
  { id: "g", status: "invoiced", value: 20000, enteredAt: daysAgo(6) },
];
const invoices = [
  { queueItemId: "f", amount: 25000, queueValue: 25000, recordedAt: daysAgo(8), recordedByLabel: "Finance One" },
  { queueItemId: "g", amount: 19500, queueValue: 20000, recordedAt: daysAgo(4), recordedByLabel: "Finance Two" },
];

test("whole days, never negative", () => {
  assert.equal(daysBetween(daysAgo(3), NOW), 3);
  assert.equal(daysBetween(NOW.toISOString(), daysAgo(1)), 0);
});

test("the summary strip counts and sums each status, and averages days to invoice", () => {
  const s = summarise(items, invoices);
  assert.deepEqual(s.pending, { count: 1, value: 1000 });
  assert.deepEqual(s.inProgress, { count: 1, value: 2500.5 });
  assert.deepEqual(s.onHold, { count: 1, value: 300 });
  assert.deepEqual(s.excluded, { count: 1, value: 800 });
  // f: 12 -> 8 days ago = 4 days; g: 6 -> 4 days ago = 2 days; mean 3.
  assert.equal(s.averageDaysToInvoice, 3);
});

test("no invoices yet: no average, not zero", () => {
  assert.equal(summarise(items.slice(0, 2), []).averageDaysToInvoice, null);
});

test("ageing bands hold only open items, by days since entering the queue", () => {
  const m = computeQueueMetrics(items, invoices, [], NOW);
  assert.deepEqual(
    m.ageing.map((b) => [b.key, b.count, b.value]),
    [["0-7", 1, 1000], ["8-14", 1, 2500.5], ["15-30", 1, 300], ["31+", 1, 700]],
  );
  assert.equal(m.openValue, 4500.5);
});

test("days to invoice per Finance user", () => {
  const m = computeQueueMetrics(items, invoices, [], NOW);
  assert.equal(m.daysToInvoice.average, 3);
  assert.deepEqual(m.daysToInvoice.byUser, [
    { user: "Finance One", invoices: 1, averageDays: 4 },
    { user: "Finance Two", invoices: 1, averageDays: 2 },
  ]);
});

test("on hold with reasons; excluded value by reason counts verified exclusions only", () => {
  const m = computeQueueMetrics(items, invoices, [
    { queueItemId: "e", reason: "AMC PPM", decision: "verified" },
    { queueItemId: "a", reason: "AMC PPM", decision: null },
    { queueItemId: "b", reason: "Warranty", decision: "rejected" },
  ], NOW);
  assert.deepEqual(m.onHold, [{ id: "c", value: 300, reason: "Client dispute", days: 20 }]);
  assert.deepEqual(m.excludedByReason, [{ reason: "AMC PPM", count: 1, value: 800 }]);
});

test("variance between queue value and invoiced amount", () => {
  const m = computeQueueMetrics(items, invoices, [], NOW);
  assert.deepEqual(m.variance, { invoices: 2, withVariance: 1, total: -500, absoluteTotal: 500 });
});

test("the window: what entered and was invoiced in the last 7 days, against the 7 before", () => {
  const p = computePeriodMetrics({ items, invoices, now: NOW, days: 7, agedAfterDays: 7, timeZone: "Asia/Dubai" });
  assert.equal(p.from, "2026-10-15");
  assert.equal(p.to, "2026-10-21");
  assert.equal(p.bucket, "day");
  assert.equal(p.activity.length, 7);
  assert.equal(p.activity[0].label, "15 Oct");
  assert.deepEqual(p.entered, { count: 2, value: 21000 }, "a two days ago and g six days ago");
  assert.deepEqual(p.invoiced, { count: 1, value: 19500, trend: -22 }, "g this week; f's 25,000 the week before");
  assert.equal(p.averageDaysToInvoice, 2);
  assert.deepEqual(p.daysToInvoiceByUser, [{ user: "Finance Two", invoices: 1, averageDays: 2 }]);
  assert.deepEqual(p.variance, { invoices: 1, withVariance: 1, total: -500, absoluteTotal: 500 });
  const sum = p.activity.reduce((acc, point) => acc + point.enteredValue + point.invoicedValue, 0);
  assert.equal(sum, 21000 + 19500, "the chart adds up to the cards");
});

test("long windows are drawn by week; the aged count is Pending past the setting, now", () => {
  const p = computePeriodMetrics({ items, invoices, now: NOW, days: 90, agedAfterDays: 1, timeZone: "Asia/Dubai" });
  assert.equal(p.bucket, "week");
  assert.ok(p.activity.length >= 13 && p.activity.length <= 14);
  assert.equal(p.invoiced.count, 2);
  assert.equal(p.invoiced.trend, null, "nothing in the window before");
  assert.deepEqual(p.aged, { count: 1, value: 1000, afterDays: 1 });
});
