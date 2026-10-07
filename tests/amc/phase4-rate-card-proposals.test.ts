import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { computeAmcData, formatPaymentLabel } from "@/components/dashboard/extensions/amc/amc-pricing";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";
import { formDataToSubmissionPayload, submissionToFormData } from "@/components/dashboard/extensions/amc/amc-submission-mapper";
import { isAmcSubmissionEditable, type AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";
import { getDefaultFormValues } from "@/components/dashboard/extensions/amc/amc-constants";
import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import {
  allowedPaymentPlans,
  canRevise,
  customPlanSchema,
  discountApprovalLevel,
  isNonStandardPlan,
  legacyTermsForPlan,
  planFromLegacyTerms,
  proposalValidUntil,
  rateModelFor,
  reviseSchema,
} from "@/lib/amc/proposal-rules";
import {
  applyPackage,
  applyRateCard,
  diffRateCards,
  lineBelowFloor,
  packagesFor,
  promotionFor,
  rateCardSchema,
  rateItemFor,
  versionInForce,
  type RateCard,
} from "@/lib/amc/rate-card";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { versionSnapshot } from "@/lib/server/amc/proposal-versions";

/* Phase 4 of the BRD v0.3 plan: rate card and proposals (DEV-349, 350, 363-368). */

const card: RateCard = {
  items: [
    { id: "ac-any", serviceId: "ac-ppm", model: "any", unit: "per AC unit", basis: "per_unit", standardRate: 100, floorRate: 80, allowedFrequencies: [2, 4], retired: false },
    { id: "ac-office", serviceId: "ac-ppm", model: "office", unit: "per AC unit", basis: "per_unit", standardRate: 150, floorRate: 120, allowedFrequencies: [], retired: false },
    { id: "plumb-any", serviceId: "plumbing-ppm", model: "any", unit: "per property", basis: "per_property", standardRate: 500, floorRate: 450, allowedFrequencies: [], retired: false },
    { id: "elec-old", serviceId: "electrical-ppm", model: "any", unit: "per property", basis: "per_property", standardRate: 300, floorRate: 250, allowedFrequencies: [], retired: true },
  ],
  packages: [
    { id: "gold", name: "Gold", description: "", models: ["villa"], lines: [{ serviceId: "ac-ppm", units: 4, frequency: 4 }, { serviceId: "plumbing-ppm", units: 1, frequency: 2 }], active: true },
    { id: "office-pack", name: "Office", description: "", models: ["office"], lines: [{ serviceId: "ac-ppm", units: 10, frequency: 4 }], active: true },
  ],
  promotions: [
    { id: "summer", name: "Summer AC", startDate: "2026-06-01", endDate: "2026-09-30", percentOff: 10, serviceIds: ["ac-ppm"], models: [], active: true },
    { id: "autumn", name: "Autumn", startDate: "2026-10-01", endDate: "2026-11-30", percentOff: 5, serviceIds: [], models: ["villa"], active: true },
  ],
};
const row = (serviceId: string, included = true, units = 1, frequency = 1, free = false) => ({ serviceId, included, units, frequency, basePrice: null, free });

test("the card: floor not above standard; one active rate per service and model", () => {
  assert.equal(rateCardSchema.safeParse(card).success, true);
  const bad = structuredClone(card);
  bad.items[0].floorRate = 120;
  assert.equal(rateCardSchema.safeParse(bad).success, false, "floor above standard");
  const dup = structuredClone(card);
  dup.items.push({ ...card.items[0], id: "ac-any-2" });
  assert.equal(rateCardSchema.safeParse(dup).success, false, "two active rates for ac-ppm / any");
  dup.items[dup.items.length - 1].retired = true;
  assert.equal(rateCardSchema.safeParse(dup).success, true, "a retired duplicate is history");
});

test("which version, which rate, which promotion", () => {
  const versions = [
    { id: "a", versionNo: 1, effectiveFrom: "2026-01-01" },
    { id: "b", versionNo: 2, effectiveFrom: "2026-10-01" },
    { id: "c", versionNo: 3, effectiveFrom: "2026-10-01" },
    { id: "d", versionNo: 4, effectiveFrom: "2027-01-01" },
  ];
  assert.equal(versionInForce(versions, "2026-09-30")?.id, "a");
  assert.equal(versionInForce(versions, "2026-10-07")?.id, "c", "same date: the later publish");
  assert.equal(versionInForce(versions, "2025-12-31"), null);
  assert.equal(rateItemFor(card, "ac-ppm", "office")?.id, "ac-office", "the model's own rate first");
  assert.equal(rateItemFor(card, "ac-ppm", "villa")?.id, "ac-any");
  assert.equal(rateItemFor(card, "electrical-ppm", "villa"), null, "retired rates price nothing");
  assert.equal(promotionFor(card, "ac-ppm", "villa", "2026-07-15")?.id, "summer");
  assert.equal(promotionFor(card, "ac-ppm", "villa", "2026-10-07")?.id, "autumn");
  assert.equal(promotionFor(card, "ac-ppm", "office", "2026-10-07"), null, "autumn is villas only");
  assert.deepEqual(packagesFor(card, "office").map((p) => p.id), ["office-pack"]);
});

test("pricing from the card: rate read from the card, promotions applied, problems named, floor marked", () => {
  const rows = [row("ac-ppm", true, 4, 4), row("plumbing-ppm", true, 1, 2), row("electrical-ppm", true), row("helpdesk", true, 1, 1, true), row("handyman", false)];
  const priced = applyRateCard(rows, card, "villa", "2026-07-15", 0);
  assert.equal(priced.rows[0].basePrice, 90, "AED 100 less the 10% summer promotion");
  assert.equal(priced.rows[0].promotionId, "summer");
  assert.equal(priced.rows[1].basePrice, 500);
  assert.equal(priced.rows[2].basePrice, null, "no active rate");
  assert.equal(priced.rows[3].basePrice, null, "free stays free");
  assert.ok(priced.problems.some((p) => p.includes("electrical-ppm")));
  assert.equal(priced.belowFloor, false, "a promotion alone is not below floor");

  const odd = applyRateCard([row("ac-ppm", true, 1, 3)], card, "villa", "2026-10-07", 0);
  assert.match(odd.problems[0], /2, 4 times a year/);

  const discounted = applyRateCard([row("plumbing-ppm", true)], card, "villa", "2026-10-07", 15);
  assert.equal(discounted.belowFloor, true, "500 less 15% = 425, under the 450 floor");
  assert.equal(discounted.rows[0].belowFloor, true);
  assert.equal(applyRateCard([row("plumbing-ppm", true)], card, "office", "2026-10-07", 10).belowFloor, false, "450 is the floor itself (no promotion on offices)");
  assert.equal(applyRateCard([row("plumbing-ppm", true)], card, "villa", "2026-10-07", 10).belowFloor, true, "the 5% villa promotion plus 10% goes under");

  assert.equal(lineBelowFloor(90, 80, 0), false);
  assert.equal(lineBelowFloor(90, 80, 5), false, "85.50 is still above the floor");
  assert.equal(lineBelowFloor(75, 80, 0), false, "a promotion under the floor is sanctioned on its own");
  assert.equal(lineBelowFloor(75, 80, 5), true, "a discount on top of it is not");
  assert.equal(lineBelowFloor(100, 80, 15), false);
});

test("the server prices from the card whatever the browser sent, and records the rate", () => {
  const settings = getAmcSettingsDefaults();
  const services = [{ ...row("ac-ppm", true, 2, 4), basePrice: 1 }, { ...row("plumbing-ppm", true, 1, 2), basePrice: 1 }];
  const priced = priceSubmission({ services, discountPercent: 0, unitType: "office", settings, rateCard: { id: "v3", card }, day: "2026-10-07" });
  assert.equal(priced.ok, true);
  if (!priced.ok) return;
  assert.equal(priced.services[0].basePrice, 150, "office AC rate, not the AED 1 sent");
  assert.equal(priced.services[0].price, 1200);
  assert.equal(priced.services[0].rateItemId, "ac-office");
  assert.equal(priced.services[0].floorRate, 120);
  assert.equal(priced.final_price, 1200 + 1000);
  assert.equal(priced.rate_card_version_id, "v3");

  const asEntered = priceSubmission({ services, discountPercent: 0, unitType: "office", settings });
  assert.equal(asEntered.ok && asEntered.services[0].basePrice, 1, "without a card, prices as entered (unchanged behaviour)");
  assert.equal(asEntered.ok && asEntered.rate_card_version_id, null);
});

test("packages tick their services with their units and visits", () => {
  const rows = [row("ac-ppm", false), row("plumbing-ppm", false), row("handyman", true, 1, 1), row("helpdesk", true, 1, 1, true)];
  const applied = applyPackage(rows, card.packages[0]);
  assert.deepEqual(
    applied.map((r) => [r.serviceId, r.included, r.units, r.frequency]),
    [
      ["ac-ppm", true, 4, 4],
      ["plumbing-ppm", true, 1, 2],
      ["handyman", false, 1, 1],
      ["helpdesk", true, 1, 1],
    ],
  );
});

test("history: old and new value per field", () => {
  const next = structuredClone(card);
  next.items[0].standardRate = 110;
  next.promotions = next.promotions.filter((p) => p.id !== "autumn");
  next.packages.push({ id: "silver", name: "Silver", description: "", models: [], lines: [{ serviceId: "ac-ppm", units: 1, frequency: 2 }], active: true });
  const changes = diffRateCards(card, next);
  assert.deepEqual(changes.find((c) => c.id === "ac-any")?.fields, [{ field: "standardRate", before: 100, after: 110 }]);
  assert.equal(changes.find((c) => c.id === "autumn")?.change, "removed");
  assert.equal(changes.find((c) => c.id === "silver")?.change, "added");
});

test("payment plans: one payment below the band, the configured plans above it", () => {
  const payments = AMC_CONFIG_DEFAULTS.payments;
  assert.deepEqual(allowedPaymentPlans(payments, 3_999), ["single"]);
  assert.deepEqual(allowedPaymentPlans(payments, 4_000), ["fifty_fifty", "quarterly", "monthly", "custom"]);
  assert.equal(isNonStandardPlan(payments, 3_000, "monthly"), true);
  assert.equal(isNonStandardPlan(payments, 9_000, "custom"), true, "custom always needs approval");
  assert.equal(isNonStandardPlan(payments, 9_000, "quarterly"), false);
  assert.equal(planFromLegacyTerms("annual"), "single");
  assert.equal(planFromLegacyTerms("quarterly"), "quarterly");
  assert.equal(legacyTermsForPlan("fifty_fifty"), "annual", "live main prints only the three old terms");
  assert.equal(customPlanSchema.safeParse([{ label: "On signing", percent: 60 }, { label: "Month 6", percent: 40 }]).success, true);
  assert.equal(customPlanSchema.safeParse([{ label: "On signing", percent: 60 }, { label: "Month 6", percent: 30 }]).success, false);
});

test("discount authority, validity, property types, revising", () => {
  const approvals = AMC_CONFIG_DEFAULTS.approvals;
  assert.equal(discountApprovalLevel(approvals, 10), 0, "10% is the level 1 limit itself");
  assert.equal(discountApprovalLevel(approvals, 12), 1);
  assert.equal(discountApprovalLevel(approvals, 25), 2);
  assert.equal(proposalValidUntil("2026-10-07T21:30:00Z", 30), "2026-11-07", "01:30 on 8 Oct in Dubai, plus 30 days");
  assert.equal(rateModelFor("townhouse"), "villa");
  assert.equal(rateModelFor("clinic"), "office");
  assert.equal(rateModelFor("other", "residential"), "apartment");
  assert.equal(canRevise("proposal_sent", true), true);
  assert.equal(canRevise("proposal_rejected", true), true);
  assert.equal(canRevise("proposal_sent", false), false, "the owner revises");
  assert.equal(canRevise("draft", true), false, "a draft is edited in place");
  assert.equal(canRevise("contract_sent", true), false);
  assert.equal(isAmcSubmissionEditable("proposal_rejected"), false, "a rejected proposal is revised, not edited");
  assert.equal(reviseSchema.safeParse({ id: "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7", reason: "discount", summary: "ok" }).success, false, "say what changes");
});

test("the plan and the full property type reach the documents, and survive a round trip", () => {
  const form = { ...getDefaultFormValues(), propertyCategory: "commercial" as const, unitType: "office" as const, propertyType: "clinic" as const, paymentPlan: "fifty_fifty" as const };
  const data = computeAmcData(form, "proposal");
  assert.equal(data.propertyTypeLabel, "COMMERCIAL - CLINIC");
  assert.equal(formatPaymentLabel(form), "50/50");
  assert.equal(formatPaymentLabel({ ...form, paymentPlan: undefined, paymentTerms: "quarterly" }), "Quarterly", "an older proposal prints its terms");

  const payload = formDataToSubmissionPayload(form);
  assert.equal(payload.payment_plan, "fifty_fifty");
  assert.equal(payload.property.propertyType, "clinic");
  const back = submissionToFormData({ ...payload, id: "x" } as unknown as AmcSubmission);
  assert.equal(back.paymentPlan, "fifty_fifty");
  assert.equal(back.propertyType, "clinic");
});

test("a locked version keeps the wording it was sent with and its plan", () => {
  const snapshot = versionSnapshot(
    {
      id: "s",
      status: "proposal_sent",
      current_version: 2,
      proposal_number: "AMC-2026-0042",
      property: { propertyCategory: "residential", unitType: "villa", propertyAddress: "Villa 1", propertyDetail: "V1" },
      customer: { paymentTerms: "quarterly", proposalNumber: "AMC-2026-0042" },
      services: [],
      final_price: 1000,
      proposal_sent_at: "2026-10-01T08:00:00Z",
      client_decision: "rejected",
      client_rejected_reason: "Too expensive",
    } as never,
    { marker: "frozen wording" },
  );
  assert.equal(snapshot.versionNo, 2);
  assert.equal(snapshot.paymentPlan, "quarterly", "read from the legacy terms");
  assert.deepEqual(snapshot.settings, { marker: "frozen wording" });
  assert.equal(snapshot.client.rejectedReason, "Too expensive");
});

test("migration: additive on the live table, history locked, the lock only from a shared status", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007140000_amc_rate_card_and_proposal_versions.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const t of ["amc_rate_card_versions", "amc_submission_versions"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`), t);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
    assert.match(sql, new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${t}`), `${t} is append-only`);
  }
  assert.match(sql, /REVOKE ALL ON public\.amc_rate_card_versions, public\.amc_submission_versions FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.amc_lock_proposal_version\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /current_version integer NOT NULL DEFAULT 1/);
  assert.match(sql, /below_floor boolean NOT NULL DEFAULT false/);
  assert.match(sql, /s\.status NOT IN \('proposal_sent', 'proposal_rejected', 'proposal_approved'\)/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/);
  /* Every ALTER of the live table only adds. */
  const live = sql.match(/ALTER TABLE public\.amc_submissions[\s\S]*?;/g) ?? [];
  assert.ok(live.length > 0);
  for (const stmt of live) assert.doesNotMatch(stmt, /DROP|ALTER COLUMN|RENAME/, stmt.slice(0, 80));
});
