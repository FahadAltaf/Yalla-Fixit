import assert from "node:assert/strict";
import test from "node:test";

import { coordinatorPerformance, lostAmcs, newVsRenewed, type CommercialContractFact } from "@/lib/amc/reports";

/* DEV-502: lost AMCs with reason and value, new against renewed, and coordinator performance. */
const c = (id: string, extra: Partial<CommercialContractFact> = {}): CommercialContractFact => ({
  id,
  number: `AMC-C-${id}`,
  customerName: `Client ${id}`,
  propertyLabel: "Villa",
  grandTotal: 10_000,
  signedAt: null,
  renewedFromContractId: null,
  renewalOutcome: null,
  renewalOutcomeReason: null,
  renewalOutcomeAt: null,
  ownerId: "a",
  ...extra,
});
const contracts = [
  c("1", { renewalOutcome: "not_renewed", renewalOutcomeReason: "Price", renewalOutcomeAt: "2026-11-05T10:00:00Z", grandTotal: 12_000 }),
  c("2", { renewalOutcome: "lapsed", renewalOutcomeAt: "2026-11-10T00:00:00Z", grandTotal: 8_000, ownerId: "b" }),
  c("3", { renewalOutcome: "not_renewed", renewalOutcomeReason: "Price", renewalOutcomeAt: "2026-10-01T00:00:00Z" }),
  c("4", { signedAt: "2026-11-02T00:00:00Z", grandTotal: 20_000 }),
  c("5", { signedAt: "2026-11-03T00:00:00Z", renewedFromContractId: "1x", grandTotal: 15_000, ownerId: "b" }),
  c("6", { renewalOutcome: "renewed", renewalOutcomeAt: "2026-11-04T00:00:00Z", ownerId: "b" }),
];

test("lost AMCs in the period, with value and reason, and the reasons summed", () => {
  const lost = lostAmcs(contracts, "2026-11-01", "2026-11-30");
  assert.equal(lost.count, 2);
  assert.equal(lost.value, 20_000);
  assert.deepEqual(lost.rows.map((r) => r.number), ["AMC-C-1", "AMC-C-2"], "largest first");
  assert.equal(lost.rows[1].reason, "Ended without a renewal");
  assert.deepEqual(lost.byReason.map((r) => [r.reason, r.count, r.value]), [["Price", 1, 12_000], ["Ended without a renewal", 1, 8_000]]);
});

test("new against renewed among the contracts signed", () => {
  const n = newVsRenewed(contracts, "2026-11-01", "2026-11-30");
  assert.deepEqual(n.new, { count: 1, value: 20_000 });
  assert.deepEqual(n.renewed, { count: 1, value: 15_000 });
  assert.equal(n.renewedShare, 50);
});

test("each coordinator's enquiries, proposals, signed value, renewals and losses", () => {
  const rows = coordinatorPerformance(
    {
      enquiries: [{ ownerId: "a", stage: "Won" }, { ownerId: "a", stage: "Lost" }, { ownerId: null, stage: "New" }],
      proposals: [{ ownerId: "a", status: "signed", finalPrice: 1 }, { ownerId: "b", status: "draft", finalPrice: 1 }],
      contracts,
    },
    (id) => (id === "a" ? "Ana" : "Ben"),
    "2026-11-01",
    "2026-11-30",
  );
  const ana = rows.find((r) => r.owner === "Ana")!;
  assert.deepEqual([ana.enquiries, ana.won, ana.winRate, ana.sent, ana.signed, ana.signedValue, ana.lost], [2, 1, 50, 1, 1, 20_000, 1]);
  const ben = rows.find((r) => r.owner === "Ben")!;
  assert.deepEqual([ben.signed, ben.signedValue, ben.renewed, ben.lost], [1, 15_000, 1, 1]);
  assert.ok(rows.some((r) => r.owner === "Unassigned"));
});
