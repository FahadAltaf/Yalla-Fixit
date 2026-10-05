import { test } from "node:test";
import assert from "node:assert/strict";

import {
  addMonths,
  checkActivation,
  checkCoverage,
  checkUsage,
  contractDisplayStatus,
  daysRemaining,
  defaultEndDate,
  deriveEntitlements,
  describeUsage,
  isExpired,
  isExpiringSoon,
  remainingQuantity,
  todayInDubai,
  validatePeriod,
  type ContractEntitlement,
  type ContractForRules,
} from "@/lib/amc/contracts";
import {
  AMC_RENEWAL_REMINDER_DAYS,
  AMC_RENEWAL_REMINDERS_ENABLED,
  buildRenewalDraft,
  planRenewalReminders,
} from "@/lib/amc/renewal";
import { AMC_SLA_DEFAULTS, evaluateSla } from "@/lib/amc/sla";
import {
  DEFAULT_ADDITIONAL_SERVICE_DISCOUNT,
  additionalServicePrice,
  discountedPrice,
} from "@/lib/amc/additional-service-discount";

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

/* ------------------------------ activation ------------------------------ */

test("activation: only a signed proposal, once, with a valid period", () => {
  const base = {
    submissionStatus: "signed",
    alreadyActivated: false,
    startDate: "2026-10-01",
    endDate: "2027-10-01",
    signedByName: "Client",
    signedAt: "2026-09-30T10:00:00Z",
  };
  assert.deepEqual(checkActivation(base), { ok: true });
  for (const status of ["draft", "approved", "proposal_sent", "proposal_approved", "contract_sent"]) {
    const r = checkActivation({ ...base, submissionStatus: status });
    assert.equal(r.ok ? null : r.status, 409, status);
  }
  const unsignedName = checkActivation({ ...base, signedByName: "" });
  assert.equal(unsignedName.ok, false);
  const duplicate = checkActivation({ ...base, alreadyActivated: true });
  assert.equal(duplicate.ok ? null : duplicate.status, 409);
  const badPeriod = checkActivation({ ...base, endDate: "2026-10-01" });
  assert.equal(badPeriod.ok ? null : badPeriod.status, 400);
});

test("entitlements are derived from the signed rows and signed service types", () => {
  const services = [
    { id: "helpdesk", label: "Helpdesk (24/7)", frequencyType: "covered" },
    { id: "ac-ppm", label: "AC PPM", frequencyType: "ppm" },
    { id: "handyman", label: "Handyman", frequencyType: "handyman" },
    { id: "emergency", label: "Emergency call-outs", frequencyType: "unlimited" },
    { id: "non-emergency", label: "Non-emergency call-outs", frequencyType: "fixed" },
  ];
  const rows = [
    { serviceId: "ac-ppm", included: true, units: 3, frequency: 4, basePrice: 100, price: 1200 },
    { serviceId: "handyman", included: true, units: 1, frequency: 6, basePrice: 50, price: 300 },
    { serviceId: "emergency", included: true, units: 1, frequency: 1, basePrice: 0, price: 0 },
    { serviceId: "non-emergency", included: true, units: 1, frequency: 2, basePrice: 0, price: 0 },
    { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: 0, price: 0 },
    { serviceId: "water-tank", included: false, units: 1, frequency: 2, basePrice: 10, price: 0 },
    { serviceId: "retired-service", included: true, units: 1, frequency: 1, basePrice: 5, price: 5 },
  ];
  const e = deriveEntitlements(rows, services);
  const byId = Object.fromEntries(e.map((x) => [x.serviceId, x]));
  assert.equal(e.length, 6, "unticked rows are left out");
  assert.equal(byId["ac-ppm"].entitlementType, "visits");
  assert.equal(byId["ac-ppm"].includedQuantity, 4);
  assert.equal(byId["ac-ppm"].units, 3);
  assert.equal(byId["ac-ppm"].contractedPrice, 1200);
  assert.equal(byId.handyman.entitlementType, "hours");
  assert.equal(byId.handyman.includedQuantity, 6);
  assert.equal(byId.emergency.entitlementType, "unlimited");
  assert.equal(byId.emergency.callOutClass, "emergency");
  assert.equal(byId.emergency.includedQuantity, null);
  assert.equal(byId["non-emergency"].entitlementType, "visits");
  assert.equal(byId["non-emergency"].callOutClass, "non_emergency");
  assert.equal(byId.helpdesk.entitlementType, "informational");
  assert.equal(byId.helpdesk.serviceLabel, "Helpdesk", "labels lose their bracketed notes");
  assert.equal(byId["retired-service"].entitlementType, "informational", "nothing signed for is dropped");
});

/* -------------------------------- dates --------------------------------- */

test("periods: valid, invalid, default end date", () => {
  assert.deepEqual(validatePeriod("2026-10-01", "2027-10-01"), { ok: true });
  assert.equal(validatePeriod("2026-10-01", "2026-10-01").ok, false);
  assert.equal(validatePeriod("2026-10-01", "2026-09-30").ok, false);
  assert.equal(validatePeriod("2026-02-30", "2027-01-01").ok, false, "not a real date");
  assert.equal(validatePeriod("01/10/2026", "2027-01-01").ok, false, "wrong format");
  assert.equal(defaultEndDate("2026-10-01"), "2027-10-01");
  assert.equal(defaultEndDate("2026-10-01", 6), "2027-04-01");
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28", "month end clamps");
});

test("expiry: days remaining, expiring soon, expired", () => {
  assert.equal(daysRemaining("2026-10-31", "2026-10-01"), 30);
  assert.equal(daysRemaining("2026-10-01", "2026-10-01"), 0);
  assert.equal(daysRemaining("2026-09-30", "2026-10-01"), -1);
  assert.equal(isExpired("2026-09-30", "2026-10-01"), true);
  assert.equal(isExpired("2026-10-01", "2026-10-01"), false, "the last day still counts");
  assert.equal(isExpiringSoon("2026-10-20", "2026-10-01"), true);
  assert.equal(isExpiringSoon("2026-12-31", "2026-10-01"), false);
  assert.equal(isExpiringSoon("2026-12-31", "2026-10-01", 120), true, "window is configurable");
});

test("display status is derived from the dates", () => {
  const c = { status: "active" as const, startDate: "2026-10-01", endDate: "2027-10-01" };
  assert.equal(contractDisplayStatus(c, "2026-09-15"), "not_started");
  assert.equal(contractDisplayStatus(c, "2027-01-01"), "active");
  assert.equal(contractDisplayStatus(c, "2027-09-20"), "expiring");
  assert.equal(contractDisplayStatus(c, "2027-10-02"), "expired");
  assert.equal(contractDisplayStatus({ ...c, status: "cancelled" }, "2027-01-01"), "cancelled");
  assert.match(todayInDubai(new Date("2026-10-05T22:30:00Z")), /^2026-10-06$/, "Dubai is UTC+4");
});

/* ----------------------------- entitlements ----------------------------- */

test("remaining and usage labels per entitlement type", () => {
  const [visits, hours, unlimited, info] = contract().entitlements;
  assert.equal(remainingQuantity(visits), 3);
  assert.equal(remainingQuantity(hours), 4);
  assert.equal(remainingQuantity(unlimited), null);
  assert.equal(remainingQuantity(info), null);
  assert.equal(describeUsage(visits), "1 of 4 visits used");
  assert.equal(describeUsage(hours), "2 of 6 hours used");
  assert.equal(describeUsage(unlimited), "3 used (unlimited)");
  assert.equal(describeUsage(info), "Included");
});

test("usage: consumption, decimals, over-consumption, adjustments", () => {
  const c = contract();
  const [visits, hours, unlimited, info] = c.entitlements;
  const at = "2027-01-15T09:00:00Z";
  assert.deepEqual(checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 3, occurredAt: at }), { ok: true, quantity: 3 });
  const over = checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 4, occurredAt: at });
  assert.equal(over.ok ? null : over.status, 409);
  assert.match(over.ok ? "" : over.error, /Only 3 visits left/);
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 0.5, occurredAt: at }).ok, false, "visits are whole");
  assert.deepEqual(checkUsage({ contract: c, entitlement: hours, kind: "consumption", quantity: 1.5, occurredAt: at }), { ok: true, quantity: 1.5 });
  assert.equal(checkUsage({ contract: c, entitlement: hours, kind: "consumption", quantity: 1.234, occurredAt: at }).ok, false);
  assert.equal(checkUsage({ contract: c, entitlement: unlimited, kind: "consumption", quantity: 50, occurredAt: at }).ok, true);
  assert.equal(checkUsage({ contract: c, entitlement: info, kind: "consumption", quantity: 1, occurredAt: at }).ok, false);
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: -1, occurredAt: at }).ok, false);
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "consumption", quantity: 1, occurredAt: "2028-01-01" }).ok, false, "outside the period");
  assert.equal(checkUsage({ contract: { ...c, status: "cancelled" }, entitlement: visits, kind: "consumption", quantity: 1, occurredAt: at }).ok, false);
  // Adjustments need a reason and cannot go below zero.
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "adjustment", quantity: -1, occurredAt: at }).ok, false);
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "adjustment", quantity: -1, occurredAt: at, notes: "entered twice" }).ok, true);
  assert.equal(checkUsage({ contract: c, entitlement: visits, kind: "adjustment", quantity: -2, occurredAt: at, notes: "x" }).ok, false);
});

/* ------------------------------- coverage ------------------------------- */

test("coverage: in force, covered, not covered, unlimited, exhausted, expired", () => {
  const c = contract();
  assert.equal(checkCoverage([c], { serviceId: "ac-ppm", date: "2027-01-01" }).outcome, "covered");
  const cov = checkCoverage([c], { serviceId: "ac-ppm", date: "2027-01-01" });
  assert.equal(cov.remaining, 3);
  assert.equal(cov.chargeable, false);
  const unlimited = checkCoverage([c], { serviceId: "emergency", date: "2027-01-01" });
  assert.equal(unlimited.outcome, "covered");
  assert.equal(unlimited.unlimited, true);
  assert.equal(unlimited.callOutClass, "emergency");
  assert.equal(checkCoverage([c], { serviceId: "duct-cleaning", date: "2027-01-01" }).outcome, "not_covered");
  assert.equal(checkCoverage([c], { serviceId: "helpdesk", date: "2027-01-01" }).outcome, "informational");
  const used = contract({
    entitlements: [ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 4 })],
  });
  const exhausted = checkCoverage([used], { serviceId: "ac-ppm", date: "2027-01-01" });
  assert.equal(exhausted.outcome, "exhausted");
  assert.equal(exhausted.chargeable, true);
  assert.equal(checkCoverage([c], { serviceId: "ac-ppm", date: "2027-10-02" }).outcome, "no_contract", "expired");
  assert.equal(checkCoverage([c], { serviceId: "ac-ppm", date: "2026-09-01" }).outcome, "no_contract", "not started");
  assert.equal(checkCoverage([{ ...c, status: "cancelled" }], { serviceId: "ac-ppm", date: "2027-01-01" }).outcome, "no_contract");
  assert.equal(checkCoverage([], { serviceId: "ac-ppm", date: "2027-01-01" }).outcome, "no_contract");
});

test("coverage: the newer contract wins where a renewal overlaps", () => {
  const old = contract({ id: "old", startDate: "2025-10-01", endDate: "2026-10-01" });
  const renewed = contract({
    id: "new",
    startDate: "2026-10-01",
    endDate: "2027-10-01",
    entitlements: [ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 6, usedQuantity: 0 })],
  });
  const r = checkCoverage([old, renewed], { serviceId: "ac-ppm", date: "2026-10-01" });
  assert.equal(r.contractId, "new");
  assert.equal(r.remaining, 6);
});

/* ------------------------------- renewal -------------------------------- */

test("renewal: pre-filled from the contract, current catalogue, old contract unchanged", () => {
  const source = {
    id: "c1",
    startDate: "2026-10-01",
    endDate: "2027-10-01",
    customer: { customerName: "Client", customerId: "YFI1", proposalNumber: "AMC-2026-0007" },
    property: { unitType: "villa", propertyAddress: "Villa 1" },
    accountManagers: [{ name: "Sam", phone: "0501111111" }],
    discountPercent: 5,
    entitlements: contract().entitlements,
  };
  const frozen = JSON.stringify(source);
  const draft = buildRenewalDraft(source, ["ac-ppm", "handyman", "emergency"]);
  assert.equal(JSON.stringify(source), frozen, "the source is not modified");
  /* The day after the old end date (no overlap), same 12-month term. */
  assert.equal(draft.customer.startDate, "2027-10-02");
  assert.equal(draft.customer.endDate, "2028-10-02");
  assert.equal(draft.customer.proposalNumber, "", "the new proposal gets its own number");
  assert.deepEqual(draft.services.map((s) => s.serviceId), ["ac-ppm", "handyman", "emergency"]);
  assert.deepEqual(draft.droppedServiceIds, ["helpdesk"], "services no longer offered are reported");
  assert.equal(draft.accountManagers.length, 2);
  assert.equal(draft.discountPercent, 5);
});

test("renewal reminders: configurable default thresholds, switched off", () => {
  assert.deepEqual([...AMC_RENEWAL_REMINDER_DAYS], [60, 30, 15], "configuration defaults, not an approved schedule");
  assert.equal(AMC_RENEWAL_REMINDERS_ENABLED, false, "nothing is created until the schedule is approved");
  assert.deepEqual(planRenewalReminders("2027-10-01", "2027-01-01"), [
    { daysBefore: 60, remindOn: "2027-08-02" },
    { daysBefore: 30, remindOn: "2027-09-01" },
    { daysBefore: 15, remindOn: "2027-09-16" },
  ]);
  assert.deepEqual(planRenewalReminders("2027-10-01", "2027-08-15", [60, 30, 15]), [
    { daysBefore: 30, remindOn: "2027-09-01" },
    { daysBefore: 15, remindOn: "2027-09-16" },
  ]);
});

/* --------------------------------- SLA ---------------------------------- */

test("SLA: emergency attendance and non-emergency scheduling", () => {
  assert.equal(AMC_SLA_DEFAULTS.emergency.targetMinutes, 120);
  assert.equal(AMC_SLA_DEFAULTS.non_emergency.targetMinutes, 360);
  const req = "2026-10-05T08:00:00Z";
  assert.equal(evaluateSla("emergency", { requestedAt: req, arrivedAt: "2026-10-05T09:30:00Z" }).state, "met");
  const late = evaluateSla("emergency", { requestedAt: req, arrivedAt: "2026-10-05T10:30:00Z" });
  assert.equal(late.state, "breached");
  assert.equal(late.minutesFromTarget, 30);
  assert.equal(evaluateSla("non_emergency", { requestedAt: req, scheduledAt: "2026-10-05T13:00:00Z" }).state, "met");
  assert.equal(
    evaluateSla("emergency", { requestedAt: req }, { now: new Date("2026-10-05T09:00:00Z") }).state,
    "pending",
  );
  assert.equal(
    evaluateSla("emergency", { requestedAt: req }, { now: new Date("2026-10-05T11:00:00Z") }).state,
    "breached",
  );
  assert.equal(evaluateSla("emergency", { arrivedAt: req }).state, "unknown", "no request time, no verdict");
  assert.equal(evaluateSla(null, { requestedAt: req }).state, "unknown");
});

/* ---------------------- additional-service discount --------------------- */

test("additional-service discount: nothing applies until configured", () => {
  assert.equal(DEFAULT_ADDITIONAL_SERVICE_DISCOUNT.enabled, false);
  assert.equal(DEFAULT_ADDITIONAL_SERVICE_DISCOUNT.discountPercent, null);
  const none = additionalServicePrice({ serviceKey: "painting", standardPrice: 400, hasContractInForce: true });
  assert.equal(none.eligible, false);
  assert.equal(none.discountedPrice, 400);
  const config = { enabled: true, discountPercent: 25, eligibleServiceKeys: ["painting"], eligibleCategories: [] };
  const yes = additionalServicePrice({ serviceKey: "painting", standardPrice: 400, hasContractInForce: true, config });
  assert.equal(yes.eligible, true);
  assert.equal(yes.discountedPrice, 300);
  assert.equal(yes.discountAmount, 100);
  assert.equal(additionalServicePrice({ serviceKey: "painting", standardPrice: 400, hasContractInForce: false, config }).eligible, false);
  assert.equal(additionalServicePrice({ serviceKey: "plumbing", standardPrice: 400, hasContractInForce: true, config }).eligible, false);
  assert.equal(discountedPrice(99.99, 25), 74.99, "rounded half up to the fil");
});
