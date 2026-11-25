import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { additionalWorkActionSchema, callOutActionSchema, fsmQuotationRequired } from "@/lib/amc/call-outs";
import { assertFsmQuotation, fsmQuotationState, setFsmQuotation } from "@/lib/server/amc/fsm-quotation";
import { fakeSupabase } from "./fake-supabase";

/* DEV-508 (24 Nov 2026): the FSM quotation number on chargeable call outs and additional work. */

const CALL = "11111111-1111-4111-8111-111111111111";
const WORK = "22222222-2222-4222-8222-222222222222";
const ME = "33333333-3333-4333-8333-333333333333";

test("who needs the number: a chargeable call out, a covered one with a charge, work with a value", () => {
  assert.equal(fsmQuotationRequired({ kind: "call_out", coverage: "chargeable", chargeTotal: 0 }), true);
  assert.equal(fsmQuotationRequired({ kind: "call_out", coverage: "covered", chargeTotal: 0 }), false);
  assert.equal(fsmQuotationRequired({ kind: "call_out", coverage: "covered", chargeTotal: 150 }), true, "parts or extra time on a covered call out");
  assert.equal(fsmQuotationRequired({ kind: "additional_work", workTotal: 840 }), true);
  assert.equal(fsmQuotationRequired({ kind: "additional_work", workTotal: 0 }), false, "free work has nothing to invoice");
});

test("the actions take the number, trimmed, and refuse a blank one", () => {
  const set = callOutActionSchema.parse({ action: "set_fsm_quotation", fsmQuotationNo: "  QT-00123 " });
  assert.equal(set.action === "set_fsm_quotation" && set.fsmQuotationNo, "QT-00123");
  assert.equal(callOutActionSchema.safeParse({ action: "set_fsm_quotation", fsmQuotationNo: "  " }).success, false);
  assert.equal(callOutActionSchema.safeParse({ action: "close", note: null, fsmQuotationNo: "QT-1" }).success, true);
  assert.equal(additionalWorkActionSchema.safeParse({ action: "complete", fsmQuotationNo: "QT-2" }).success, true);
});

function setup() {
  const fake = fakeSupabase({
    amc_call_outs: [{ id: CALL, coverage: "chargeable", fsm_quotation_no: null }],
    amc_additional_works: [{ id: WORK, total: 840, fsm_quotation_no: null }],
    amc_visit_charges: [],
    amc_audit_log: [],
  });
  return { fake, admin: fake.client as unknown as SupabaseClient };
}

test("closing a chargeable call out waits for the number; once recorded it may close", async () => {
  const { admin, fake } = setup();
  await assert.rejects(assertFsmQuotation(admin, "call_out", CALL), /FSM quotation number/);
  await setFsmQuotation(admin, "call_out", CALL, " QT-00123 ", { id: ME, label: "Coordinator" });
  assert.equal(fake.table("amc_call_outs")[0].fsm_quotation_no, "QT-00123");
  assert.equal(fake.table("amc_call_outs")[0].fsm_quotation_by, ME);
  await assertFsmQuotation(admin, "call_out", CALL);
});

test("additional work with a value is completed only with the number", async () => {
  const { admin } = setup();
  assert.deepEqual(await fsmQuotationState(admin, "additional_work", WORK), { migrated: true, value: null, required: true });
  await assert.rejects(assertFsmQuotation(admin, "additional_work", WORK), /Finance cannot record the revenue/);
  await setFsmQuotation(admin, "additional_work", WORK, "QT-77", { id: ME, label: null });
  await assertFsmQuotation(admin, "additional_work", WORK);
});
