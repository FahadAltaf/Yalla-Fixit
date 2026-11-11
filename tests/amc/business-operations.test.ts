import { test } from "node:test";
import assert from "node:assert/strict";

import type { ContractEntitlement, ContractForRules } from "@/lib/amc/contracts";
import {
  additionalServiceEligibility,
  assessmentSummary,
  checkAssessmentCompletion,
  customerFromSnapshot,
  expiryBucket,
  managerPortfolio,
  portfolioMetrics,
  propertyFromSnapshot,
  proposalPrefillFromAssessment,
  renewalStage,
  serviceAnalytics,
  type DiscountConfig,
  type ReportContract,
} from "@/lib/amc/business";

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
    ent({ serviceId: "handyman", entitlementType: "hours", includedQuantity: 6, usedQuantity: 6 }),
  ],
  ...over,
});

/* -------------------------- customer / property -------------------------- */

test("customer and property: the snapshot is copied, never changed", () => {
  const signed = { customerName: "Ahmed Khan", customerId: "YFI1806", customerPhone: "0501", customerEmail: "a@b.c" };
  const frozen = JSON.stringify(signed);
  const live = customerFromSnapshot(signed);
  assert.deepEqual(live, { name: "Ahmed Khan", customerRef: "YFI1806", email: "a@b.c", phone: "0501" });
  live.name = "Ahmed K. (renamed today)";
  live.phone = "0509";
  assert.equal(JSON.stringify(signed), frozen, "editing the live record leaves what was signed");
  assert.deepEqual(propertyFromSnapshot({ propertyDetail: "Villa 12", propertyAddress: "Street 4", unitType: "villa", propertyCategory: "residential" }), {
    label: "Villa 12",
    address: "Street 4",
    unitType: "villa",
    propertyCategory: "residential",
  });
  assert.equal(propertyFromSnapshot({ propertyAddress: "Tower 1", unitType: "castle" }).unitType, null, "unknown types are not guessed");
});

/* ------------------------------ assessments ------------------------------ */

test("assessment: draft until dated, placed and every item answered", () => {
  const items = [{ result: "ok" as const }, { result: null }, { result: "not_applicable" as const }];
  const draft = checkAssessmentCompletion({ status: "draft", assessedOn: null, propertyId: null, items });
  assert.equal(draft.ok, false);
  assert.deepEqual(!draft.ok && draft.errors, ["Enter the assessment date.", "Choose the property.", "1 checklist item is not answered."]);
  assert.equal(
    checkAssessmentCompletion({ status: "draft", assessedOn: "2026-10-06", propertyId: "p1", items: [{ result: "ok" }, { result: "not_applicable" }] }).ok,
    true,
  );
  assert.equal(checkAssessmentCompletion({ status: "completed", assessedOn: "2026-10-06", propertyId: "p1", items: [] }).ok, false, "completed stays completed");
  const summary = assessmentSummary([
    { result: "ok", label: "Cooling", categoryLabel: "AC" },
    { result: "attention", label: "Leaks", categoryLabel: "Plumbing" },
    { result: null, label: "DB", categoryLabel: "Electrical" },
  ]);
  assert.deepEqual([summary.ok, summary.attention, summary.unanswered], [1, 1, 1]);
  assert.deepEqual(summary.attentionItems, ["Plumbing: Leaks"]);
});

test("assessment -> proposal: customer, property and recommended services only; no prices", () => {
  const offered = [{ id: "ac-ppm", frequencyPerYear: 4 }, { id: "handyman", frequencyPerYear: 6 }, { id: "helpdesk" }];
  const base = { status: "completed" as const, submissionId: null, recommendedServiceIds: ["ac-ppm", "duct-cleaning"], unitType: null, propertyCategory: null };
  const customer = { name: "Ahmed Khan", customerRef: "YFI1806", email: "a@b.c", phone: "0501" };
  const property = { label: "Villa 12", address: "Street 4", unitType: "villa", propertyCategory: "residential" };
  const prefill = proposalPrefillFromAssessment(base, customer, property, offered);
  assert.equal(prefill.ok, true);
  if (!prefill.ok) return;
  assert.equal(prefill.customer.customerName, "Ahmed Khan");
  assert.equal(prefill.customer.customerId, "YFI1806");
  assert.equal(prefill.customer.startDate, "", "dates are agreed in the wizard");
  assert.equal(prefill.property.unitType, "villa");
  assert.deepEqual(prefill.services.filter((s) => s.included).map((s) => s.serviceId), ["ac-ppm"]);
  assert.ok(prefill.services.every((s) => s.basePrice === null && s.price === 0), "pricing comes from the wizard");
  assert.equal(prefill.services.find((s) => s.serviceId === "ac-ppm")?.frequency, 4, "frequency from the catalogue");
  assert.deepEqual(prefill.droppedServiceIds, ["duct-cleaning"], "recommended but not offered is reported");

  assert.equal(proposalPrefillFromAssessment({ ...base, status: "draft" }, customer, property, offered).ok, false);
  assert.equal(proposalPrefillFromAssessment({ ...base, submissionId: "s1" }, customer, property, offered).ok, false, "once per assessment");
  assert.equal(proposalPrefillFromAssessment(base, customer, { ...property, unitType: "townhouse" }, offered).ok, false, "not an AMC unit type");
});

/* ------------------------------- discount -------------------------------- */

const off: DiscountConfig = { enabled: false, discountPercent: null, eligibleServiceKeys: [], eligibleCategories: [] };
const on: DiscountConfig = { enabled: true, discountPercent: 20, eligibleServiceKeys: ["painting"], eligibleCategories: ["plumbing"] };
const ask = (over: Partial<Parameters<typeof additionalServiceEligibility>[0]> = {}) =>
  additionalServiceEligibility({
    contract: contract(),
    amcServiceId: null,
    serviceKey: "painting",
    category: null,
    date: "2027-01-10",
    standardPrice: 1000,
    config: on,
    ...over,
  });

test("additional service: discount figures, shown in full", () => {
  const r = ask();
  assert.equal(r.outcome, "amc_discount_eligible");
  assert.deepEqual([r.standardPrice, r.discountPercent, r.discountAmount, r.finalPrice], [1000, 20, 200, 800]);
  assert.equal(ask({ standardPrice: 99.99 }).finalPrice, 79.99, "rounded half up to the fil");
  const byCategory = ask({ serviceKey: "leak-fix", category: "plumbing" });
  assert.equal(byCategory.outcome, "amc_discount_eligible");
  const noPrice = ask({ standardPrice: null });
  assert.deepEqual([noPrice.outcome, noPrice.finalPrice, noPrice.discountPercent], ["amc_discount_eligible", null, 20]);
});

test("additional service: inactive contract, included, standard charge, not configured", () => {
  assert.equal(ask({ date: "2028-01-10" }).outcome, "standard_charge", "expired contract");
  assert.equal(ask({ contract: contract({ status: "cancelled" }) }).contractInForce, false, "cancelled contract");
  const included = ask({ amcServiceId: "ac-ppm", serviceKey: "ac-ppm" });
  assert.equal(included.outcome, "included_in_amc");
  assert.deepEqual([included.finalPrice, included.discountAmount], [0, 0], "covered, not discounted");
  const exhausted = ask({ amcServiceId: "handyman", serviceKey: "handyman", category: "plumbing" });
  assert.equal(exhausted.outcome, "amc_discount_eligible", "used-up allowance falls through to the discount");
  assert.ok(exhausted.reasons.some((r) => /used up/.test(r)));
  assert.equal(ask({ serviceKey: "landscaping" }).outcome, "standard_charge", "not on the discount list");
  const notConfigured = ask({ config: off });
  assert.equal(notConfigured.outcome, "not_configured", "no rate is assumed");
  assert.deepEqual([notConfigured.discountAmount, notConfigured.finalPrice], [0, 1000]);
  assert.equal(ask({ config: { ...on, discountPercent: null } }).outcome, "not_configured");
});

/* ------------------------------- renewals -------------------------------- */

test("expiry buckets", () => {
  const c = (endDate: string, status: "active" | "cancelled" = "active") => ({ status, endDate });
  assert.equal(expiryBucket(c("2027-01-09"), "2027-01-10"), "expired");
  assert.equal(expiryBucket(c("2027-01-10"), "2027-01-10"), "d0_30", "ends today");
  assert.equal(expiryBucket(c("2027-02-09"), "2027-01-10"), "d0_30", "30 days");
  assert.equal(expiryBucket(c("2027-02-10"), "2027-01-10"), "d31_60");
  assert.equal(expiryBucket(c("2027-04-10"), "2027-01-10"), "d61_90");
  assert.equal(expiryBucket(c("2027-04-11"), "2027-01-10"), "d90_plus");
  assert.equal(expiryBucket(c("2027-02-01", "cancelled"), "2027-01-10"), null, "cancelled contracts are not in the report");
});

test("renewal pipeline: stages derived from the contract and its renewal proposal", () => {
  const base = { status: "active" as const, endDate: "2027-03-01", renewedByContractId: null, renewalProposalStatus: null };
  const today = "2027-01-10";
  assert.equal(renewalStage({ ...base, endDate: "2027-12-01" }, today), null, "far from expiry, nothing started");
  assert.deepEqual(renewalStage(base, today), { stage: "upcoming", overdue: false });
  const stages = [
    ["draft", "proposal_created"],
    ["sent_back", "proposal_created"],
    ["awaiting_approval", "awaiting_internal_approval"],
    ["approved", "approved_not_sent"],
    ["proposal_sent", "sent_to_customer"],
    ["proposal_rejected", "rejected_by_customer"],
    ["proposal_approved", "approved_by_customer"],
    ["contract_sent", "contract_sent"],
    ["signed", "signed"],
  ] as const;
  for (const [status, stage] of stages) {
    assert.equal(renewalStage({ ...base, renewalProposalStatus: status }, today)?.stage, stage, status);
  }
  assert.equal(renewalStage({ ...base, renewedByContractId: "c2", renewalProposalStatus: "signed" }, today)?.stage, "renewed");
  assert.deepEqual(renewalStage({ ...base, endDate: "2027-01-01" }, today), { stage: "expired_without_renewal", overdue: true });
  assert.deepEqual(renewalStage({ ...base, endDate: "2027-01-01", renewalProposalStatus: "proposal_sent" }, today), {
    stage: "sent_to_customer",
    overdue: true,
  });
  assert.equal(renewalStage({ ...base, status: "cancelled" }, today), null);
});

/* ------------------------------- analytics ------------------------------- */

const rc = (over: Partial<ReportContract>): ReportContract => ({
  id: "x",
  status: "active",
  startDate: "2026-10-01",
  endDate: "2027-10-01",
  grandTotal: 1050,
  customerId: null,
  propertyId: null,
  accountManagers: [],
  renewedFromContractId: null,
  renewedByContractId: null,
  renewalProposalStatus: null,
  entitlements: [],
  ...over,
});

test("analytics: customers and properties counted once; unlinked counted apart; cancelled excluded", () => {
  const contracts = [
    rc({ id: "a", customerId: "cust1", propertyId: "p1" }),
    rc({ id: "b", customerId: "cust1", propertyId: "p2" }),
    rc({ id: "c", customerId: null, propertyId: null }),
    rc({ id: "d", customerId: "cust2", propertyId: "p3", status: "cancelled" }),
    rc({ id: "e", customerId: "cust3", propertyId: "p4", endDate: "2026-12-01" }),
  ];
  const m = portfolioMetrics(contracts, "2027-01-10");
  assert.equal(m.inForce, 3);
  assert.equal(m.customersWithAmc, 1, "one customer with two contracts counts once");
  assert.equal(m.contractsWithoutCustomer, 1);
  assert.equal(m.propertiesCovered, 2);
  assert.equal(m.inForceValue, 3150);
});

test("analytics: hours and visits stay separate; unlimited reports use only", () => {
  const contracts = [
    rc({
      id: "a",
      entitlements: [
        ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 4 }),
        ent({ serviceId: "handyman", entitlementType: "hours", includedQuantity: 6, usedQuantity: 1.5 }),
        ent({ serviceId: "emergency", entitlementType: "unlimited", usedQuantity: 3 }),
      ],
    }),
    rc({ id: "b", entitlements: [ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 1 })] }),
    rc({ id: "c", status: "cancelled", entitlements: [ent({ serviceId: "ac-ppm", entitlementType: "visits", usedQuantity: 4 })] }),
  ];
  const rows = serviceAnalytics(contracts, "2027-01-10");
  const ac = rows.find((r) => r.serviceId === "ac-ppm")!;
  assert.deepEqual([ac.entitlementType, ac.contracts, ac.included, ac.used, ac.exhausted], ["visits", 2, 8, 5, 1]);
  const hm = rows.find((r) => r.serviceId === "handyman")!;
  assert.deepEqual([hm.entitlementType, hm.included, hm.used], ["hours", 6, 1.5]);
  const em = rows.find((r) => r.serviceId === "emergency")!;
  assert.deepEqual([em.included, em.used], [null, 3]);
  assert.equal(rows.length, 3, "one row per service and unit, nothing summed across units");
  assert.equal(portfolioMetrics(contracts, "2027-01-10").withExhausted, 1);
});

test("account manager portfolio: each named manager, unassigned grouped", () => {
  const contracts = [
    rc({ id: "a", accountManagers: ["Sam", "Lina"], propertyId: "p1", endDate: "2027-02-01" }),
    rc({ id: "b", accountManagers: ["Sam"], propertyId: "p1", renewalProposalStatus: "draft" }),
    rc({ id: "c", accountManagers: [] }),
    rc({ id: "d", accountManagers: ["Sam"], status: "cancelled" }),
  ];
  const rows = managerPortfolio(contracts, "2027-01-10");
  const sam = rows.find((r) => r.manager === "Sam")!;
  assert.deepEqual([sam.inForce, sam.expiringWithin90, sam.renewalsInProgress, sam.propertiesCovered, sam.inForceValue], [2, 1, 1, 1, 2100]);
  assert.equal(rows.find((r) => r.manager === "Lina")?.inForce, 1);
  assert.equal(rows.find((r) => r.manager === "Unassigned")?.inForce, 1);
});
