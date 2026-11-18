import { test } from "node:test";
import assert from "node:assert/strict";

import { applyRateCard, emptyRateCard, type RateCard } from "@/lib/amc/rate-card";

/* One rate: AC PPM at 200, floor 150, any model. */
function card(): RateCard {
  const c = emptyRateCard();
  c.items = [
    { id: "r-ac", serviceId: "ac-ppm", model: "any", unit: "AC unit", basis: "per_unit", standardRate: 200, floorRate: 150, allowedFrequencies: [], retired: false } as RateCard["items"][number],
  ];
  return c;
}
const run = (rows: Parameters<typeof applyRateCard>[0]) => applyRateCard(rows, card(), "villa", "2026-11-16", 0);

test("without an override the card sets the rate", () => {
  const { rows, belowFloor } = run([{ serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 999 }]);
  assert.equal(rows[0].basePrice, 200);
  assert.equal(belowFloor, false);
});

test("a changed rate at or above the floor is kept and needs no approval", () => {
  const { rows, belowFloor } = run([{ serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 170, rateOverride: true }]);
  assert.equal(rows[0].basePrice, 170);
  assert.equal(rows[0].standardRate, 200, "the card's rate is kept beside it");
  assert.equal(rows[0].belowFloor, false);
  assert.equal(belowFloor, false);
});

test("a changed rate under the floor is kept and sends the proposal for approval", () => {
  const { rows, belowFloor } = run([{ serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 120, rateOverride: true }]);
  assert.equal(rows[0].basePrice, 120);
  assert.equal(rows[0].belowFloor, true);
  assert.equal(belowFloor, true);
});

test("a rate entered for a service the card does not price is kept, needs approval, and is no longer a problem", () => {
  const { rows, belowFloor, problems } = run([{ serviceId: "plumbing-ppm", included: true, units: 1, frequency: 3, basePrice: 80, rateOverride: true }]);
  assert.equal(rows[0].basePrice, 80);
  assert.equal(rows[0].belowFloor, true);
  assert.equal(belowFloor, true);
  assert.deepEqual(problems, []);
});

test("an emptied override stays unpriced instead of snapping back to the card", () => {
  const { rows } = run([{ serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: undefined, rateOverride: true }]);
  assert.equal(rows[0].basePrice, null);
});
