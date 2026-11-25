import { test } from "node:test";
import assert from "node:assert/strict";

import { paymentWhenRange } from "@/lib/amc/payments";

/* Finance's payment filters (23 Nov 2026): the late bands match the ageing cards. */
test("late bands, next days and this month as date ranges", () => {
  const today = "2026-11-23";
  assert.deepEqual(paymentWhenRange("overdue_1_30", today), { from: "2026-10-24", to: "2026-11-22", late: true });
  assert.deepEqual(paymentWhenRange("overdue_31_60", today), { from: "2026-09-24", to: "2026-10-23", late: true });
  assert.deepEqual(paymentWhenRange("overdue_90_plus", today), { from: null, to: "2026-08-24", late: true });
  assert.deepEqual(paymentWhenRange("next_7", today), { from: "2026-11-23", to: "2026-11-29", late: false });
  assert.deepEqual(paymentWhenRange("this_month", today), { from: "2026-11-01", to: "2026-11-30", late: false });
  assert.deepEqual(paymentWhenRange("this_month", "2026-12-31"), { from: "2026-12-01", to: "2026-12-31", late: false });
});
