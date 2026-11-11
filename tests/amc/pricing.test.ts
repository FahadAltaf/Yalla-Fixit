import { test } from "node:test";
import assert from "node:assert/strict";

import {
  computeAmcPricing,
  grandTotalFromFinal,
  rowPrice,
  roundAed,
  toFils,
  vatOnFinal,
} from "@/lib/amc/pricing";
import { amountToWordsAed } from "@/components/dashboard/extensions/amc/utils/amount-to-words";

const row = (basePrice: number | null, units = 1, frequency = 1, included = true) => ({
  serviceId: `s-${Math.random()}`,
  included,
  units,
  frequency,
  basePrice,
});

test("price = base price x units x frequency", () => {
  assert.equal(rowPrice(row(100, 2, 4)), 800);
  assert.equal(rowPrice(row(12.5, 3, 2)), 75);
  assert.equal(rowPrice(row(0.01, 1, 3)), 0.03);
});

test("an unticked row and an unpriced row cost nothing", () => {
  assert.equal(rowPrice(row(100, 2, 4, false)), 0);
  assert.equal(rowPrice(row(null, 2, 4)), 0);
});

test("subtotal, discount, VAT and grand total", () => {
  const p = computeAmcPricing([row(100, 2, 4), row(50, 1, 2), row(999, 1, 1, false)], 10);
  assert.equal(p.subtotal, 900);
  assert.equal(p.discountAmount, 90);
  assert.equal(p.finalPrice, 810);
  assert.equal(p.vatAmount, 40.5);
  assert.equal(p.grandTotal, 850.5);
});

test("VAT is 5% of the fee after discount, rounded half up to the fil", () => {
  // 467.13 x 5% = 23.3565 -> 23.36
  assert.equal(vatOnFinal(467.13), 23.36);
  // 10.10 x 5% = 0.505 -> 0.51 (half up, not banker's)
  assert.equal(vatOnFinal(10.1), 0.51);
});

test("discount rounds half up to the fil (7.5% of 467.10 = 35.0325 -> 35.03)", () => {
  const p = computeAmcPricing([row(467.1)], 7.5);
  assert.equal(p.discountAmount, 35.03);
  assert.equal(p.finalPrice, 432.07);
});

test("the printed parts always add up to the printed total", () => {
  for (const discount of [0, 5, 7.5, 10, 12.5, 15, 33.33]) {
    for (let base = 1; base <= 3000; base += 7.37) {
      const p = computeAmcPricing([row(roundAed(base), 1, 1)], discount);
      assert.equal(toFils(p.subtotal) - toFils(p.discountAmount), toFils(p.finalPrice));
      assert.equal(toFils(p.finalPrice) + toFils(p.vatAmount), toFils(p.grandTotal));
      // The list computes the total from the stored final price: same answer.
      assert.equal(grandTotalFromFinal(p.finalPrice), p.grandTotal);
    }
  }
});

test("a stored float final price is normalised before VAT", () => {
  // Rows stored before server pricing could hold 467.125.
  assert.equal(grandTotalFromFinal(467.125), 490.49);
});

test("base prices with more than two decimals are rounded half up", () => {
  const p = computeAmcPricing([row(10.555, 1, 1)], 0);
  assert.equal(p.rows[0].basePrice, 10.56);
  assert.equal(p.subtotal, 10.56);
});

test("discount is clamped to 0-100", () => {
  assert.equal(computeAmcPricing([row(100)], 150).finalPrice, 0);
  assert.equal(computeAmcPricing([row(100)], -5).finalPrice, 100);
});

test("monthly fee is the annual fee / 12, half up", () => {
  assert.equal(computeAmcPricing([row(3500.5)], 0).monthlyPrice, 291.71);
});

/* ------------------------------ words ------------------------------ */

test("amount in words: whole dirhams", () => {
  assert.equal(amountToWordsAed(3675), "THREE THOUSAND SIX HUNDRED SEVENTY FIVE DIRHAMS ONLY (VAT INCLUDED)");
});

test("amount in words: fils", () => {
  assert.equal(
    amountToWordsAed(850.5),
    "EIGHT HUNDRED FIFTY DIRHAMS AND FIFTY FILS ONLY (VAT INCLUDED)",
  );
});

test("amount in words never says ONE HUNDRED FILS", () => {
  // 0.9975 printed as 1.00 used to read "ZERO DIRHAMS AND ONE HUNDRED FILS".
  assert.equal(amountToWordsAed(0.9975), "ONE DIRHAMS ONLY (VAT INCLUDED)");
  assert.equal(amountToWordsAed(99.999), "ONE HUNDRED DIRHAMS ONLY (VAT INCLUDED)");
});

test("amount in words matches the figure printed beside it", () => {
  for (const discount of [0, 7.5, 10]) {
    for (let base = 100; base <= 2000; base += 3.5) {
      const p = computeAmcPricing([row(base)], discount);
      const fils = toFils(p.grandTotal) % 100;
      const words = amountToWordsAed(p.grandTotal);
      if (fils === 0) {
        assert.ok(!words.includes(" FILS"), `${p.grandTotal}: ${words}`);
      } else {
        assert.ok(words.includes(" AND ") && words.includes(" FILS"), `${p.grandTotal}: ${words}`);
      }
    }
  }
  // 525.53 used to read "... FIFTY TWO FILS".
  assert.match(amountToWordsAed(525.53), /AND FIFTY THREE FILS/);
});

test("amount in words: zero, negatives, NaN and large numbers", () => {
  assert.equal(amountToWordsAed(0), "ZERO DIRHAMS ONLY (VAT INCLUDED)");
  assert.equal(amountToWordsAed(-5), "ZERO DIRHAMS ONLY (VAT INCLUDED)");
  assert.equal(amountToWordsAed(Number.NaN), "ZERO DIRHAMS ONLY (VAT INCLUDED)");
  assert.match(amountToWordsAed(1_234_567.89), /^ONE MILLION TWO HUNDRED THIRTY FOUR THOUSAND/);
});
