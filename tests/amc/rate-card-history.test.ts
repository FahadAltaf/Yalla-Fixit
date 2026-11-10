import assert from "node:assert/strict";
import test from "node:test";

import { diffRateCards, emptyRateCard, type RateCard } from "@/lib/amc/rate-card";
import { describeRateCardField } from "@/lib/amc/rate-card-history";

const LABELS: Record<string, string> = { "plumbing-ppm": "Plumbing PPM", "electrical-ppm": "Electrical PPM", "ac-ppm": "AC PPM" };
const label = (id: string) => LABELS[id] ?? id;

const card = (overrides: Partial<RateCard>): RateCard => ({ ...emptyRateCard(), ...overrides });
const gold = (lines: Array<{ serviceId: string; units: number; frequency: number }>) => ({
  id: "gold",
  name: "Gold",
  description: "",
  models: [],
  lines,
  active: true,
});
const described = (before: RateCard, after: RateCard) =>
  diffRateCards(before, after, label).flatMap((c) => c.fields.map((f) => describeRateCardField(f, label)));

test("a package's services read as what changed, never [object Object]", () => {
  const before = card({ packages: [gold([{ serviceId: "plumbing-ppm", units: 1, frequency: 2 }])] });
  const after = card({
    packages: [
      gold([
        { serviceId: "plumbing-ppm", units: 2, frequency: 4 },
        { serviceId: "electrical-ppm", units: 1, frequency: 4 },
        { serviceId: "ac-ppm", units: 3, frequency: 2 },
      ]),
    ],
  });
  const [line] = described(before, after);
  assert.equal(
    line,
    "Services: Plumbing PPM units 1 → 2, visits a year 2 → 4; Electrical PPM added (1 unit, 4 a year); AC PPM added (3 units, 2 a year)",
  );
  assert.ok(!line.includes("[object Object]"));
});

test("a removed package service is named", () => {
  const before = card({ packages: [gold([{ serviceId: "plumbing-ppm", units: 1, frequency: 2 }, { serviceId: "ac-ppm", units: 1, frequency: 2 }])] });
  const after = card({ packages: [gold([{ serviceId: "plumbing-ppm", units: 1, frequency: 2 }])] });
  assert.deepEqual(described(before, after), ["Services: AC PPM removed"]);
});

test("rates read in AED, visits a year and plain words", () => {
  const rate = { id: "r1", serviceId: "plumbing-ppm", model: "apartment" as const, unit: "visit", basis: "per_visit" as const, standardRate: 40, floorRate: 30, allowedFrequencies: [2], retired: false };
  const lines = described(
    card({ items: [rate] }),
    card({ items: [{ ...rate, standardRate: 43, allowedFrequencies: [2, 4], retired: true }] }),
  );
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^Standard rate: AED\s?40\.00 → AED\s?43\.00$/);
  assert.equal(lines[1], "Visits a year: 2 a year → 2, 4 a year");
  assert.equal(lines[2], "Retired: No → Yes");
});

test("promotion dates, percentages and scope read as on the screen", () => {
  const promo = { id: "p1", name: "Summer AC Offer", startDate: "2026-06-01", endDate: "2026-08-31", percentOff: 10, serviceIds: [] as string[], models: [] as Array<"villa" | "apartment" | "office">, active: true };
  const lines = described(
    card({ promotions: [promo] }),
    card({ promotions: [{ ...promo, endDate: "2026-09-30", percentOff: 15, serviceIds: ["ac-ppm"], models: ["villa"] }] }),
  );
  assert.deepEqual(lines, [
    "Ends: 31/08/2026 → 30/09/2026",
    "Off: 10% → 15%",
    "Services: Every service → AC PPM",
    "Property models: Every property model → Villa",
  ]);
});
