import { test } from "node:test";
import assert from "node:assert/strict";

import { amcServiceRowInputSchema, computeAmcPricing } from "@/lib/amc/pricing";
import { priceSubmission, submittableProblem } from "@/lib/server/amc/pricing";
import { getAmcSettingsDefaults, mergeAmcSettings } from "@/components/dashboard/extensions/amc/amc-settings";

/*
  The client's October 2026 proposal changes (merged from main), carried
  through the shared, server-checked pricing.
*/

const settings = getAmcSettingsDefaults();

test("a service included at no charge costs 0 and needs no base price", () => {
  const pricing = computeAmcPricing([
    { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: null, free: true },
    { serviceId: "ac-ppm", included: true, units: 1, frequency: 4, basePrice: 250 },
  ]);
  assert.equal(pricing.rows[0].price, 0);
  assert.equal(pricing.rows[0].free, true);
  assert.equal(pricing.subtotal, 1000, "only the priced row counts");
  const stray = computeAmcPricing([{ serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: 999, free: true }]);
  assert.equal(stray.subtotal, 0, "a stray base price on a free row is not charged");
  assert.equal(
    submittableProblem([
      { serviceId: "helpdesk", included: true, basePrice: null, free: true },
      { serviceId: "ac-ppm", included: true, basePrice: 250 },
    ]),
    null,
    "submit does not ask for a price on a free row",
  );
  assert.match(String(submittableProblem([{ serviceId: "ac-ppm", included: true, basePrice: null }])), /base price/, "a priced row still needs one");
});

test("the server keeps the free flag and defaults it for older drafts", () => {
  assert.equal(amcServiceRowInputSchema.parse({ serviceId: "ac-ppm", included: true, units: 1, frequency: 1 }).free, false);
  const result = priceSubmission({
    services: [
      { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: null, free: true },
      { serviceId: "ac-ppm", included: true, units: 1, frequency: 4, basePrice: 250 },
    ],
    discountPercent: 0,
    unitType: "villa",
    settings,
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.services.find((s) => s.serviceId === "helpdesk")?.free, true, "saved with the row");
  assert.equal(result.final_price, 1000);
});

test("the monthly figure is spread over the contract term, not always 12 months", () => {
  const rows = [{ serviceId: "ac-ppm", included: true, units: 1, frequency: 4, basePrice: 300 }];
  assert.equal(computeAmcPricing(rows, 0, 6).monthlyPrice, 200, "six-month contract");
  assert.equal(computeAmcPricing(rows, 0, 12).monthlyPrice, 100);
  assert.equal(computeAmcPricing(rows).monthlyPrice, 100, "a year when no term is given");
  assert.equal(computeAmcPricing(rows, 0, 0).monthlyPrice, 100, "a nonsensical term falls back to a year");
});

test("the helpdesk is included free by default, also for settings saved before the flag", () => {
  assert.equal(settings.services.find((s) => s.id === "helpdesk")?.includedFree, true);
  /* As saved before the flag existed: no includedFree at all. */
  const saved = settings.services.map((service) => ({ ...service, includedFree: undefined }));
  const merged = mergeAmcSettings(getAmcSettingsDefaults(), { services: saved });
  assert.equal(merged.services.find((s) => s.id === "helpdesk")?.includedFree, true, "shipped value fills the gap");
  assert.equal(merged.services.find((s) => s.id === "ac-ppm")?.includedFree, false);
});
