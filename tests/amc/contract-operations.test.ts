import { test } from "node:test";
import assert from "node:assert/strict";

import {
  checkCorrection,
  checkCoverage,
  checkUsage,
  coverageVerdict,
  entitlementState,
  expiryLabel,
  isInForce,
  shiftDays,
  signedCommercials,
  summarizeContract,
  termMonthsBetween,
  usageDate,
  usagePreview,
  type ContractEntitlement,
  type ContractForRules,
} from "@/lib/amc/contracts";
import { buildRenewalDraft, newReminders, planRenewalReminders, renewalBlockedReason } from "@/lib/amc/renewal";
import { evaluateSla } from "@/lib/amc/sla";
import { additionalServicePrice } from "@/lib/amc/additional-service-discount";

const ent = (over: Partial<ContractEntitlement> & Pick<ContractEntitlement, "serviceId" | "entitlementType">): ContractEntitlement => ({
  serviceLabel: over.serviceId,
  callOutClass: null,
  units: 1,
  frequency: 1,
  includedQuantity: over.entitlementType === "visits" || over.entitlementType === "hours" ? 4 : null,
  usedQuantity: 0,
  basePrice: 100,
  contractedPrice: 100,
  ...over,
});

const contract = (over: Partial<ContractForRules> = {}): ContractForRules => ({
  id: "c1",
  status: "active",
  startDate: "2026-10-01",
  endDate: "2027-10-01",
  entitlements: [
    ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 1 }),
    ent({ serviceId: "handyman", entitlementType: "hours", includedQuantity: 6, usedQuantity: 2 }),
    ent({ serviceId: "emergency", entitlementType: "unlimited", callOutClass: "emergency", usedQuantity: 3 }),
    ent({ serviceId: "helpdesk", entitlementType: "informational" }),
  ],
  ...over,
});

const consumption = { kind: "consumption", quantity: 2 };

/* ------------------------------ corrections ----------------------------- */

test("corrections: take back part or all of one entry, as a negative quantity", () => {
  const part = checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 1, reason: "Entered twice", entitlementUsed: 3 });
  assert.deepEqual(part, { ok: true, quantity: -1 });
  const all = checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 2, reason: "Not an AMC visit", entitlementUsed: 3 });
  assert.deepEqual(all, { ok: true, quantity: -2 });
  const rest = checkCorrection({ original: consumption, alreadyCorrected: -1, amount: 1, reason: "Rest of it", entitlementUsed: 2 });
  assert.deepEqual(rest, { ok: true, quantity: -1 }, "a second correction takes back what is left");
});

test("corrections: never more than the entry, never below zero, always with a reason", () => {
  const over = checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 3, reason: "Too much", entitlementUsed: 5 });
  assert.equal(over.ok, false);
  assert.equal(!over.ok && over.status, 409);
  const twice = checkCorrection({ original: consumption, alreadyCorrected: -2, amount: 1, reason: "Again", entitlementUsed: 5 });
  assert.equal(!twice.ok && twice.error, "This entry has already been fully corrected.");
  const negative = checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 2, reason: "Below zero", entitlementUsed: 1 });
  assert.equal(!negative.ok && negative.error, "That would take usage below zero.");
  const noReason = checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 1, reason: "  ", entitlementUsed: 3 });
  assert.equal(!noReason.ok && noReason.status, 400);
  const notConsumption = checkCorrection({ original: { kind: "correction", quantity: -1 }, alreadyCorrected: 0, amount: 1, reason: "Undo", entitlementUsed: 3 });
  assert.equal(!notConsumption.ok && notConsumption.status, 409, "a correction cannot itself be corrected");
  for (const amount of [0, -1, Number.NaN]) {
    assert.equal(checkCorrection({ original: consumption, alreadyCorrected: 0, amount, reason: "Bad", entitlementUsed: 3 }).ok, false);
  }
  assert.equal(checkCorrection({ original: consumption, alreadyCorrected: 0, amount: 0.333, reason: "Decimals", entitlementUsed: 3 }).ok, false);
});

/* ------------------------------ usage rules ----------------------------- */

test("usage: over-consumption is refused; unlimited is not capped; informational is not consumed", () => {
  const c = contract();
  const [visits, hours, unlimited, info] = c.entitlements;
  const base = { contract: c, kind: "consumption" as const, occurredAt: "2027-01-10" };
  assert.equal(checkUsage({ ...base, entitlement: visits, quantity: 3 }).ok, true, "exactly what is left");
  const over = checkUsage({ ...base, entitlement: visits, quantity: 4 });
  assert.equal(!over.ok && over.error, "Only 3 visits left on this service.");
  assert.equal(checkUsage({ ...base, entitlement: hours, quantity: 4.5 }).ok, false, "4 hours left");
  assert.equal(checkUsage({ ...base, entitlement: unlimited, quantity: 50 }).ok, true);
  assert.equal(checkUsage({ ...base, entitlement: info, quantity: 1 }).ok, false);
});

test("usage: cancelled, expired and not-started contracts take no new usage", () => {
  const c = contract();
  const visits = c.entitlements[0];
  const cancelled = checkUsage({ contract: { ...c, status: "cancelled" }, entitlement: visits, kind: "consumption", quantity: 1, occurredAt: "2027-01-10" });
  assert.equal(!cancelled.ok && cancelled.error, "Usage can only be recorded on an active contract.");
  const after = checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 1, occurredAt: "2027-10-02" });
  assert.equal(!after.ok && after.error, "That date is outside the contract period.");
  const before = checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 1, occurredAt: "2026-09-30" });
  assert.equal(before.ok, false);
});

test("usage date: a timestamp is read in Dubai time", () => {
  assert.equal(usageDate("2027-01-10"), "2027-01-10");
  assert.equal(usageDate("2027-10-01T21:30:00Z"), "2027-10-02", "01:30 in Dubai is the next day");
  const c = contract();
  const late = checkUsage({ contract: c, entitlement: c.entitlements[0], kind: "consumption", quantity: 1, occurredAt: "2027-10-01T21:30:00Z" });
  assert.equal(late.ok, false, "past the end date in Dubai, though still 1 Oct in UTC");
});

test("usage preview: included, already used, recording, remaining after", () => {
  const c = contract();
  assert.deepEqual(usagePreview(c.entitlements[0], 2), {
    unit: "visits",
    unlimited: false,
    included: 4,
    used: 1,
    recording: 2,
    remainingAfter: 1,
  });
  const unlimited = usagePreview(c.entitlements[2], 1);
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.remainingAfter, null, "no remaining figure for unlimited");
  assert.equal(usagePreview(c.entitlements[1], 0.5).unit, "hours");
});

/* ------------------------------ entitlement states ----------------------- */

test("entitlement states", () => {
  const visits = (used: number) => ent({ serviceId: "v", entitlementType: "visits", includedQuantity: 4, usedQuantity: used });
  assert.equal(entitlementState(visits(0), "active"), "available");
  assert.equal(entitlementState(visits(3), "active"), "low_remaining", "1 of 4 left");
  assert.equal(entitlementState(visits(4), "expiring"), "exhausted");
  assert.equal(entitlementState(ent({ serviceId: "e", entitlementType: "unlimited" }), "active"), "unlimited");
  assert.equal(entitlementState(ent({ serviceId: "h", entitlementType: "informational" }), "active"), "included");
  assert.equal(entitlementState(visits(0), "not_started"), "not_started");
  assert.equal(entitlementState(visits(0), "expired"), "expired");
  assert.equal(entitlementState(visits(0), "cancelled"), "cancelled");
});

/* ------------------------------ summary --------------------------------- */

test("summary: visits and hours are counted separately, never added", () => {
  const s = summarizeContract(contract().entitlements, [
    { kind: "consumption", occurredAt: "2027-01-10T00:00:00Z" },
    { kind: "correction", occurredAt: "2027-02-01T00:00:00Z" },
    { kind: "consumption", occurredAt: "2027-01-20T00:00:00Z" },
  ]);
  assert.equal(s.totalServices, 4);
  assert.equal(s.withRemaining, 2);
  assert.equal(s.exhausted, 0);
  assert.equal(s.unlimited, 1);
  assert.equal(s.informational, 1);
  assert.deepEqual([s.remainingVisits, s.includedVisits], [3, 4]);
  assert.deepEqual([s.remainingHours, s.includedHours], [4, 6]);
  assert.equal(s.usageEvents, 3);
  assert.equal(s.lastUsageDate, "2027-01-20T00:00:00Z", "the last consumption, not the correction");
});

/* ------------------------------ coverage -------------------------------- */

test("coverage: AMC status says why there is no cover", () => {
  const c = contract();
  assert.equal(checkCoverage([c], { serviceId: "ac-ppm", date: "2027-01-01" }).amcStatus, "active");
  const expired = checkCoverage([c], { serviceId: "ac-ppm", date: "2027-12-01" });
  assert.deepEqual([expired.amcStatus, expired.outcome], ["expired", "no_contract"]);
  assert.equal(checkCoverage([c], { serviceId: "ac-ppm", date: "2026-09-01" }).amcStatus, "not_started");
  const cancelled = checkCoverage([{ ...c, status: "cancelled" }], { serviceId: "ac-ppm", date: "2027-01-01" });
  assert.deepEqual([cancelled.amcStatus, cancelled.covered], ["cancelled", false]);
  assert.equal(checkCoverage([], { serviceId: "ac-ppm", date: "2027-01-01" }).amcStatus, "none");
});

test("coverage verdict: covered by AMC, chargeable, or no active AMC", () => {
  const c = contract();
  const covered = coverageVerdict(checkCoverage([c], { serviceId: "ac-ppm", date: "2027-01-01" }), "AC PPM");
  assert.equal(covered.verdict, "covered_by_amc");
  assert.ok(covered.details.includes("3 visits remaining"));
  const unlimited = coverageVerdict(checkCoverage([c], { serviceId: "emergency", date: "2027-01-01" }), "Emergency");
  assert.equal(unlimited.verdict, "covered_by_amc");
  assert.ok(unlimited.details.includes("Remaining: unlimited"));
  assert.equal(coverageVerdict(checkCoverage([c], { serviceId: "painting", date: "2027-01-01" }), "Painting").verdict, "chargeable");
  const used = contract({ entitlements: [ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 4 })] });
  assert.equal(coverageVerdict(checkCoverage([used], { serviceId: "ac-ppm", date: "2027-01-01" }), "AC PPM").verdict, "chargeable");
  assert.equal(coverageVerdict(checkCoverage([c], { serviceId: "ac-ppm", date: "2028-01-01" }), "AC PPM").verdict, "no_active_amc");
  assert.equal(
    coverageVerdict(checkCoverage([{ ...c, status: "cancelled" }], { serviceId: "ac-ppm", date: "2027-01-01" }), "AC PPM").verdict,
    "no_active_amc",
    "a cancelled contract covers nothing",
  );
});

/* ------------------------------ expiry ---------------------------------- */

test("expiry labels", () => {
  const c = { status: "active" as const, startDate: "2026-10-01", endDate: "2027-10-01" };
  assert.equal(expiryLabel(c, "2027-09-07"), "Expires in 24 days");
  assert.equal(expiryLabel(c, "2027-09-30"), "Expires tomorrow");
  assert.equal(expiryLabel(c, "2027-10-01"), "Expires today");
  assert.equal(expiryLabel(c, "2027-10-02"), "Expired yesterday");
  assert.equal(expiryLabel(c, "2027-10-13"), "Expired 12 days ago");
  assert.equal(expiryLabel(c, "2026-09-26"), "Starts in 5 days");
  assert.equal(expiryLabel({ ...c, status: "cancelled" }, "2027-01-01"), "Cancelled");
});

test("dates: shiftDays, and periods under a month have no term in months", () => {
  assert.equal(shiftDays("2027-02-28", 1), "2027-03-01");
  assert.equal(shiftDays("2027-01-01", -1), "2026-12-31");
  assert.equal(termMonthsBetween("2026-10-06", "2026-10-20"), 0, "activation stores null for this");
  assert.equal(termMonthsBetween("2026-10-01", "2027-10-01"), 12);
});

/* ------------------------------ activation pricing ---------------------- */

test("activation pricing: stored figures win; legacy rows keep their line price", () => {
  const rows = [
    { serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 250 },
    { serviceId: "legacy", included: true, units: 1, frequency: 1, basePrice: null, price: 10_000 },
  ];
  const signed = signedCommercials(rows, { discountPercent: 10, discountAmount: 1_200, finalPrice: 10_800 });
  assert.equal(signed.linePrices.get("ac-ppm"), 2_000, "250 × 2 units × 4 a year");
  assert.equal(signed.linePrices.get("legacy"), 10_000, "not read as 0");
  assert.equal(signed.finalPrice, 10_800);
  assert.equal(signed.discountAmount, 1_200);
  assert.equal(signed.subtotal, 12_000, "final + discount, matching the quote");
  const fresh = signedCommercials([{ serviceId: "a", included: true, units: 1, frequency: 1, basePrice: 999.99 }], {});
  assert.equal(fresh.finalPrice, 999.99, "with nothing stored, computed");
});

/* ------------------------------ renewal --------------------------------- */

test("renewal: no overlap with the old contract, and one renewal per contract", () => {
  const source = {
    id: "c1",
    startDate: "2026-10-01",
    endDate: "2027-10-01",
    customer: {},
    property: {},
    accountManagers: [],
    discountPercent: 0,
    entitlements: contract().entitlements,
  };
  const draft = buildRenewalDraft(source, ["ac-ppm"]);
  const start = String(draft.customer.startDate);
  assert.equal(isInForce({ status: "active", startDate: source.startDate, endDate: source.endDate }, start), false);
  assert.equal(termMonthsBetween(start, String(draft.customer.endDate)), 12, "the same term, so the next renewal keeps it");

  const open = { status: "active" as const, renewedByContractId: null, hasRenewalProposal: false };
  assert.equal(renewalBlockedReason(open), null);
  assert.equal(renewalBlockedReason({ ...open, hasRenewalProposal: true }), "A renewal proposal already exists for this contract.");
  assert.equal(renewalBlockedReason({ ...open, renewedByContractId: "c2" }), "This contract has already been renewed.");
  assert.equal(renewalBlockedReason({ ...open, status: "cancelled" }), "A cancelled contract cannot be renewed.");
});

test("renewal reminders: each contract and threshold only once", () => {
  const planned = planRenewalReminders("2027-10-01", "2027-07-01", [60, 30, 15]);
  assert.equal(planned.length, 3);
  assert.deepEqual(newReminders(planned, []).map((r) => r.daysBefore), [60, 30, 15]);
  assert.deepEqual(newReminders(planned, [60]).map((r) => r.daysBefore), [30, 15]);
  assert.deepEqual(newReminders(planned, [60, 30, 15]), [], "a second run creates nothing");
  assert.deepEqual(
    planRenewalReminders("2027-10-01", "2027-09-10", [60, 30, 15]).map((r) => r.daysBefore),
    [15],
    "dates already past are not planned",
  );
});

/* ------------------------------ SLA and discount ------------------------ */

test("SLA: UNKNOWN without timestamps", () => {
  assert.equal(evaluateSla("emergency", {}).state, "unknown");
  assert.equal(evaluateSla("non_emergency", { scheduledAt: "2027-01-01T10:00:00Z" }).state, "unknown");
});

test("additional-service discount: off by default; by service or category when enabled", () => {
  const off = additionalServicePrice({ serviceKey: "painting", standardPrice: 400, hasContractInForce: true });
  assert.equal(off.eligible, false);
  const disabled = additionalServicePrice({
    serviceKey: "painting",
    standardPrice: 400,
    hasContractInForce: true,
    config: { enabled: false, discountPercent: 25, eligibleServiceKeys: ["painting"], eligibleCategories: [] },
  });
  assert.equal(disabled.eligible, false, "the master switch wins");
  const config = { enabled: true, discountPercent: 25, eligibleServiceKeys: [], eligibleCategories: ["plumbing"] };
  const byCategory = additionalServicePrice({ serviceKey: "leak-fix", category: "plumbing", standardPrice: 400, hasContractInForce: true, config });
  assert.deepEqual([byCategory.eligible, byCategory.discountedPrice], [true, 300]);
  assert.equal(additionalServicePrice({ serviceKey: "leak-fix", category: "electrical", standardPrice: 400, hasContractInForce: true, config }).eligible, false);
  assert.equal(additionalServicePrice({ serviceKey: "leak-fix", category: "plumbing", standardPrice: 400, hasContractInForce: false, config }).eligible, false);
});
