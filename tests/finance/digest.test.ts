import { test } from "node:test";
import assert from "node:assert/strict";

import { digestDue, digestInAppText, digestSubject, dubaiClock, planDigest, type DigestItem } from "@/lib/finance/digest-plan";

// 21 Oct 2026, 08:30 in Dubai.
const NOW = new Date("2026-10-21T04:30:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

const item = (n: number, over: Partial<DigestItem> = {}): DigestItem => ({
  id: `i${n}`,
  number: 1000 + n,
  status: "pending",
  statusChangedAt: hoursAgo(1),
  enteredAt: hoursAgo(1),
  value: 1000,
  quotationNumber: `Q-${n}`,
  workOrderNumber: `WO-${n}`,
  clientName: "Acme",
  completionPercent: 50,
  ...over,
});

test("Dubai time decides the day and the hour", () => {
  assert.deepEqual(dubaiClock(new Date("2026-10-20T20:30:00Z")), { date: "2026-10-21", minutes: 30 });
  assert.equal(digestDue(NOW, "08:00"), true);
  assert.equal(digestDue(NOW, "09:00"), false);
});

test("not sent when nothing is new and nothing is outstanding (E1 rule)", () => {
  const plan = planDigest({
    items: [item(1, { status: "invoiced", enteredAt: hoursAgo(72) }), item(2, { status: "excluded", enteredAt: hoursAgo(72) })],
    now: NOW,
    lastDigestAt: hoursAgo(24),
    agedAfterDays: 7,
  });
  assert.equal(plan.send, false);
});

test("sent when only a backlog remains, so it stays visible (TC02 counterpart)", () => {
  const plan = planDigest({ items: [item(1, { enteredAt: hoursAgo(72) })], now: NOW, lastDigestAt: hoursAgo(24), agedAfterDays: 7 });
  assert.equal(plan.send, true);
  if (!plan.send) return;
  assert.equal(plan.newItems.length, 0);
  assert.deepEqual(plan.outstanding, { count: 1, value: 1000 });
});

test("new means entered since the last digest; a new item that is already invoiced is still news", () => {
  const plan = planDigest({
    items: [
      item(1, { enteredAt: hoursAgo(30) }),
      item(2, { enteredAt: hoursAgo(5) }),
      item(3, { enteredAt: hoursAgo(2), status: "invoiced", value: 500 }),
    ],
    now: NOW,
    lastDigestAt: hoursAgo(24),
    agedAfterDays: 7,
  });
  assert.ok(plan.send);
  if (!plan.send) return;
  assert.deepEqual(plan.newItems.map((i) => i.number), [1002, 1003]);
  assert.equal(plan.newValue, 1500);
  assert.deepEqual(plan.outstanding, { count: 2, value: 2000 });
});

test("the first digest ever looks back 24 hours", () => {
  const plan = planDigest({ items: [item(1, { enteredAt: hoursAgo(23) }), item(2, { enteredAt: hoursAgo(25) })], now: NOW, lastDigestAt: null, agedAfterDays: 7 });
  assert.ok(plan.send);
  if (plan.send) assert.deepEqual(plan.newItems.map((i) => i.number), [1001]);
});

test("aged (N2): pending longer than the limit, oldest first; other statuses never age", () => {
  const plan = planDigest({
    items: [
      item(1, { statusChangedAt: hoursAgo(24 * 8) }),
      item(2, { statusChangedAt: hoursAgo(24 * 12) }),
      item(3, { statusChangedAt: hoursAgo(24 * 7) }),
      item(4, { statusChangedAt: hoursAgo(24 * 30), status: "on_hold" }),
    ],
    now: NOW,
    lastDigestAt: hoursAgo(24),
    agedAfterDays: 7,
  });
  assert.ok(plan.send);
  if (plan.send) assert.deepEqual(plan.aged.map((a) => [a.number, a.daysPending]), [[1002, 12], [1001, 8]]);
});

test("the wording follows the BRD drafts", () => {
  const plan = planDigest({
    items: [item(1, { value: 25000 }), item(2, { enteredAt: hoursAgo(48), value: 20000.5 })],
    now: NOW,
    lastDigestAt: hoursAgo(24),
    agedAfterDays: 7,
  });
  assert.ok(plan.send);
  if (!plan.send) return;
  assert.equal(digestSubject(plan), "Ready to invoice, 2026-10-21: 1 new, 2 pending (AED 45,000.5)");
  assert.equal(digestInAppText(plan), "1 new items ready to invoice, AED 25,000. 2 still pending.");
});
