import { test } from "node:test";
import assert from "node:assert/strict";

import { invoiceDateOf } from "@/lib/server/finance/invoice-scan";

test("the invoice date comes back as YYYY-MM-DD whatever format was printed (day-first, as in the UAE)", () => {
  assert.equal(invoiceDateOf("2026-10-23"), "2026-10-23");
  assert.equal(invoiceDateOf("23/10/2026"), "2026-10-23");
  assert.equal(invoiceDateOf("05/10/2026"), "2026-10-05");
  assert.equal(invoiceDateOf("5-10-26"), "2026-10-05");
  assert.equal(invoiceDateOf("Oct 23, 2026"), "2026-10-23");
  assert.equal(invoiceDateOf("23 October 2026"), "2026-10-23");
  assert.equal(invoiceDateOf("23rd Oct 2026"), "2026-10-23");
});

test("no date, or not a real one, is null: the person enters it", () => {
  assert.equal(invoiceDateOf("31/02/2026"), null);
  assert.equal(invoiceDateOf(""), null);
  assert.equal(invoiceDateOf(null), null);
  assert.equal(invoiceDateOf("next week"), null);
});
