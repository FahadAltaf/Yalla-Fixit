import { test } from "node:test";
import assert from "node:assert/strict";

import { approvalChecklist, type ChecklistLine } from "@/lib/amc/approval-checklist";
import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";

/* What the approver checks (23 Nov 2026): every crossed rule, with what was asked and what the rule allows. */

const config = {
  approvals: { ...AMC_CONFIG_DEFAULTS.approvals, discountLevel1AbovePercent: 10, discountLevel2AbovePercent: 20, discountLevel3AbovePercent: null, valueLevel1AboveAed: 50_000, valueLevel2AboveAed: null, valueLevel3AboveAed: null, level1Name: "AMC department head", level2Name: "Management" },
  payments: AMC_CONFIG_DEFAULTS.payments,
};
const line = (over: Partial<ChecklistLine>): ChecklistLine => ({ serviceId: "ac-ppm", included: true, frequency: 4, basePrice: 100, standardRate: 100, floorRate: 80, ...over });
const run = (over: Partial<Parameters<typeof approvalChecklist>[1]> = {}) =>
  approvalChecklist(config, { discountPercent: 0, finalPrice: 10_000, plan: AMC_CONFIG_DEFAULTS.payments.defaultPlanAboveBand, services: [], labelOf: (l) => l.serviceId, ...over });

test("nothing crossed: nothing to check", () => {
  assert.deepEqual(run({ services: [line({})] }), []);
});

test("discount and value say what was asked and the ladder of limits", () => {
  const checks = run({ discountPercent: 15, finalPrice: 60_000 });
  const discount = checks.find((c) => c.key === "discount")!;
  assert.equal(discount.level, 1);
  assert.equal(discount.levelName, "AMC department head");
  assert.match(discount.asked, /15% discount/);
  assert.match(discount.rule, /No approval up to 10%; above 10%: AMC department head; above 20%: Management/);
  const value = checks.find((c) => c.key === "value")!;
  assert.match(value.asked, /AED 60,000 a year before VAT/);
  assert.match(value.rule, /above AED 50,000: AMC department head/);
});

test("the floor rule names each line and why: typed under the floor, off the card, after the discount, visits off the card", () => {
  const checks = run({
    discountPercent: 30,
    services: [
      line({ serviceId: "typed", basePrice: 70, rateOverride: true, rateOverrideReason: "Loyal client", rateOverrideBy: "Sami", belowFloor: true }),
      line({ serviceId: "nocard", basePrice: 50, standardRate: null, floorRate: null, rateOverride: true, belowFloor: true }),
      line({ serviceId: "discount", basePrice: 100, belowFloor: true }),
      line({ serviceId: "visits", frequency: 3, frequencyOffCard: true, cardFrequencies: [2, 4], belowFloor: true }),
      line({ serviceId: "fine" }),
    ],
  });
  const floor = checks.find((c) => c.key === "below_floor")!;
  const problems = floor.lines.map((l) => `${l.service}: ${l.problem}`);
  assert.ok(problems.includes("typed: Rate typed under the floor"));
  assert.equal(floor.lines.find((l) => l.service === "typed")!.reason, "Loyal client");
  assert.ok(problems.includes("nocard: Rate not on the rate card"));
  assert.ok(problems.includes("discount: Under the floor after the discount"));
  assert.match(floor.lines.find((l) => l.service === "discount")!.detail, /AED 70; the floor is AED 80/);
  assert.ok(problems.includes("visits: Visits a year not on the rate card"));
  assert.match(floor.lines.find((l) => l.service === "visits" && l.problem === "Visits a year not on the rate card")!.detail, /3 a year; the card offers 2, 4/);
  assert.ok(!problems.some((p) => p.startsWith("fine")));
});

test("a rate raised above the standard is listed for information, needing no approval", () => {
  const checks = run({ services: [line({ basePrice: 120, rateOverride: true, rateOverrideReason: "Hard access" })] });
  assert.equal(checks.length, 1);
  assert.equal(checks[0].key, "rate_changed");
  assert.equal(checks[0].level, null);
  assert.equal(checks[0].lines[0].problem, "Rate raised above the standard");
});

test("a custom payment plan always needs approval, and says the standard plans", () => {
  const plan = run({ plan: "custom", planLabel: "50% on signing, 50% at 6 months", finalPrice: 20_000 }).find((c) => c.key === "plan")!;
  assert.match(plan.asked, /Custom plan: 50% on signing/);
  assert.match(plan.rule, /A custom plan always needs approval/);
});
