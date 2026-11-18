import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldStartProblems } from "@/lib/amc/field-start";
import { chargeTotals, paymentTimingSchema, recordChargePaymentSchema } from "@/lib/amc/visit-charges";
import { recordChargePayment } from "@/lib/server/amc/visit-charges";
import { fakeSupabase } from "./fake-supabase";

/* 18 Nov 2026: what a call out or additional work costs the client, and when it is paid. */

test("only charged lines count; VAT is 5% once on the subtotal", () => {
  const totals = chargeTotals([
    { units: 2, unitPrice: 150, charged: true },
    { units: 1, unitPrice: 99.99, charged: false },
    { units: 1, unitPrice: 10.01, charged: true },
  ]);
  assert.deepEqual(totals, { subtotal: 310.01, vatAmount: 15.5, total: 325.51 });
  assert.deepEqual(chargeTotals([{ units: 3, unitPrice: 200, charged: false }]), { subtotal: 0, vatAmount: 0, total: 0 });
});

test("after the visit needs a reason; a transfer needs its reference", () => {
  assert.equal(paymentTimingSchema.safeParse({ timing: "before_visit", reason: null }).success, true);
  assert.equal(paymentTimingSchema.safeParse({ timing: "after_visit", reason: " " }).success, false);
  assert.equal(paymentTimingSchema.safeParse({ timing: "after_visit", reason: "Pays the technician on site" }).success, true);
  assert.equal(recordChargePaymentSchema.safeParse({ amount: 105, paidOn: "2026-11-18", mode: "transfer", reference: null, note: null }).success, false);
  assert.equal(recordChargePaymentSchema.safeParse({ amount: 105, paidOn: "2026-11-18", mode: "cash", reference: null, note: null }).success, true);
});

test("starting: services first on a chargeable call out, then paid before or a reason for after", () => {
  const ready = { kind: "call_out" as const, priority: "routine", technicianIds: ["t1"], scheduledStart: "2026-11-20T05:00:00Z", scheduledEnd: "2026-11-20T07:00:00Z", accessStatus: "approved" };
  assert.equal(fieldStartProblems({ ...ready, servicesMissing: true })[0].key, "services");
  assert.equal(fieldStartProblems({ ...ready, payment: { paid: false, timing: "before_visit", reason: null } })[0].key, "payment");
  assert.equal(fieldStartProblems({ ...ready, payment: { paid: false, timing: "after_visit", reason: null } })[0].key, "payment");
  assert.deepEqual(fieldStartProblems({ ...ready, payment: { paid: false, timing: "after_visit", reason: "On site" } }), []);
  assert.deepEqual(fieldStartProblems({ ...ready, payment: { paid: true, timing: null, reason: null } }), []);
  assert.deepEqual(fieldStartProblems({ ...ready, payment: null }), []);
});

test("a charge is paid once, for its full amount", async () => {
  const db = fakeSupabase({
    amc_visit_charges: [{ id: "ch1", contract_id: "c1", call_out_id: "co1", additional_work_id: null, lines: [], subtotal: 100, vat_amount: 5, total: 105, status: "due", created_at: "2026-11-18T08:00:00Z" }],
  });
  const actor = { id: "u1", label: "Office" };
  await assert.rejects(recordChargePayment(db.client as never, "call_out", "co1", { amount: 100, paidOn: "2026-11-18", mode: "cash", reference: null, note: null }, actor), /full amount/);
  await recordChargePayment(db.client as never, "call_out", "co1", { amount: 105, paidOn: "2026-11-18", mode: "cash", reference: null, note: null }, actor);
  const row = db.table("amc_visit_charges")[0];
  assert.equal(row.status, "paid");
  assert.equal(row.paid_amount, 105);
  await assert.rejects(recordChargePayment(db.client as never, "call_out", "co1", { amount: 105, paidOn: "2026-11-18", mode: "cash", reference: null, note: null }, actor), /already paid/);
});
