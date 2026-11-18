import { test } from "node:test";
import assert from "node:assert/strict";

import { VARIANCE_TOLERANCE_AED, invoiceVariance, varianceNeedsReason } from "@/lib/finance/variance";

// The MAHER total against the portal's (Sami, 9 and 13 Nov 2026). The database checks the same AED 1.00 (20261118150000).

test("the difference is MAHER less the portal, to the fils", () => {
  assert.equal(invoiceVariance(1050.4, 1050), 0.4);
  assert.equal(invoiceVariance(1000, 1050), -50);
  assert.equal(invoiceVariance(0.3 + 0.1, 0.4), 0, "no floating-point noise");
});

test("up to AED 1.00 is rounding and needs no reason; beyond it a reason is required", () => {
  assert.equal(VARIANCE_TOLERANCE_AED, 1);
  assert.equal(varianceNeedsReason(1050, 1050), false);
  assert.equal(varianceNeedsReason(1051, 1050), false, "exactly AED 1.00");
  assert.equal(varianceNeedsReason(1049, 1050), false, "AED 1.00 less");
  assert.equal(varianceNeedsReason(1051.01, 1050), true);
  assert.equal(varianceNeedsReason(1000, 1050), true);
});

test("no MAHER total entered: nothing to explain", () => {
  assert.equal(varianceNeedsReason(null, 1050), false);
  assert.equal(varianceNeedsReason(undefined, 1050), false);
  assert.equal(varianceNeedsReason(Number.NaN, 1050), false);
});
