import { test } from "node:test";
import assert from "node:assert/strict";

import { priceSubmission, submittableProblem } from "@/lib/server/amc/pricing";
import { amcServiceRowsInputSchema } from "@/lib/amc/pricing";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";

const settings = getAmcSettingsDefaults();

test("the server derives totals from the rows and ignores sent totals", () => {
  const result = priceSubmission({
    services: [
      { serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 100, price: 1 },
      { serviceId: "handyman", included: false, units: 1, frequency: 1, basePrice: 500, price: 500 },
    ],
    discountPercent: 0,
    unitType: "apartment",
    settings,
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.final_price, 800);
  assert.equal(result.services[0].price, 800);
  assert.equal(result.services[1].price, 0);
});

test("a ticked service not offered on this kind of property is refused", () => {
  const villaOnly = settings.services.find((s) => s.villaOnly || (s.unitTypes?.length === 1 && s.unitTypes[0] === "villa"));
  assert.ok(villaOnly, "the shipped catalogue has a villa-only service");
  const result = priceSubmission({
    services: [{ serviceId: villaOnly!.id, included: true, units: 1, frequency: 1, basePrice: 100 }],
    discountPercent: 0,
    unitType: "apartment",
    settings,
  });
  assert.equal(result.ok, false);
});

test("a ticked service switched off in Settings is refused", () => {
  const off = {
    services: settings.services.map((s) => (s.id === "ac-ppm" ? { ...s, enabled: false } : s)),
  };
  const result = priceSubmission({
    services: [{ serviceId: "ac-ppm", included: true, units: 1, frequency: 1, basePrice: 100 }],
    discountPercent: 0,
    unitType: "villa",
    settings: off,
  });
  assert.equal(result.ok, false);
  // An unticked row for it is fine: it costs nothing and prints nowhere.
  const unticked = priceSubmission({
    services: [{ serviceId: "ac-ppm", included: false, units: 1, frequency: 1, basePrice: 100 }],
    discountPercent: 0,
    unitType: "villa",
    settings: off,
  });
  assert.equal(unticked.ok, true);
});

test("structurally invalid rows are rejected by the API schema", () => {
  const bad = [
    [{ serviceId: "a", included: true, units: 0, frequency: 1 }],
    [{ serviceId: "a", included: true, units: 1.5, frequency: 1 }],
    [{ serviceId: "a", included: true, units: 1, frequency: 1, basePrice: -1 }],
    [{ serviceId: "", included: true, units: 1, frequency: 1 }],
    [
      { serviceId: "a", included: true, units: 1, frequency: 1 },
      { serviceId: "a", included: false, units: 1, frequency: 1 },
    ],
  ];
  for (const rows of bad) {
    assert.equal(amcServiceRowsInputSchema.safeParse(rows).success, false, JSON.stringify(rows));
  }
  assert.equal(
    amcServiceRowsInputSchema.safeParse([
      { serviceId: "a", included: true, units: 1, frequency: 1, basePrice: null },
    ]).success,
    true,
  );
});

test("submit needs a ticked service and a base price on every ticked row", () => {
  assert.match(submittableProblem([]) ?? "", /Tick at least one/);
  assert.match(
    submittableProblem([{ serviceId: "a", included: true, basePrice: null }]) ?? "",
    /base price/,
  );
  assert.equal(submittableProblem([{ serviceId: "a", included: true, basePrice: 0 }]), null);
});
