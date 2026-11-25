import assert from "node:assert/strict";
import test from "node:test";

import { aboveCardProblem, aboveCardRows } from "@/lib/amc/pricing";
import { stampRateOverrides } from "@/lib/server/amc/pricing";

/* DEV-501 (minimum, 20 Nov 2026): a rate typed above the rate card needs a reason and records who typed it. Premium tiers are not decided. */
type Row = { serviceId: string; included: boolean; free: boolean; rateOverride: boolean; basePrice: number; standardRate: number | null; rateOverrideReason?: string; rateOverrideBy?: string | null };
const row = (serviceId: string, extra: Partial<Row> = {}): Row => ({ serviceId, included: true, free: false, rateOverride: true, basePrice: 120, standardRate: 100, ...extra });

test("only a ticked, charged row typed above the card counts", () => {
  assert.equal(aboveCardRows([row("ac")]).length, 1);
  assert.equal(aboveCardRows([row("ac", { basePrice: 90 })]).length, 0, "below the card is the floor rule's business");
  assert.equal(aboveCardRows([row("ac", { rateOverride: false })]).length, 0, "the card's own rate");
  assert.equal(aboveCardRows([row("ac", { free: true })]).length, 0);
  assert.equal(aboveCardRows([row("ac", { included: false })]).length, 0);
  assert.equal(aboveCardRows([row("ac", { standardRate: null })]).length, 0, "off the card is approved as before");
});

test("submitting needs the reason", () => {
  assert.match(String(aboveCardProblem([row("ac")], () => "AC servicing")), /Say why the rate is above the rate card for AC servicing/);
  assert.equal(aboveCardProblem([row("ac", { rateOverrideReason: "Premium tower, access by crane" })]), null);
});

test("who typed it is set by the server, and kept while the reason stays the same", () => {
  const first = stampRateOverrides([row("ac", { rateOverrideReason: "Premium tower", rateOverrideBy: "Spoofed" })], [], "Sara");
  assert.equal(first[0].rateOverrideBy, "Sara", "the request's name is not trusted");
  const kept = stampRateOverrides([row("ac", { rateOverrideReason: "Premium tower" })], first, "Omar");
  assert.equal(kept[0].rateOverrideBy, "Sara");
  const changed = stampRateOverrides([row("ac", { rateOverrideReason: "Crane access" })], first, "Omar");
  assert.equal(changed[0].rateOverrideBy, "Omar");
  assert.equal(stampRateOverrides([row("ac")], first, "Omar")[0].rateOverrideBy, null);
});
