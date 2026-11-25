import { test } from "node:test";
import assert from "node:assert/strict";

import { callOutActionSchema, additionalWorkActionSchema } from "@/lib/amc/call-outs";
import { chargeableHandymanHours, fsmQuotationSkipSchema } from "@/lib/amc/fsm-quotation";
import { jobSheetActionSchema } from "@/lib/amc/job-sheets";

/* 25 Nov 2026: closing a chargeable call out without the FSM quotation number, with a reason. */

test("closing without the number needs a choice and a reason", () => {
  assert.equal(fsmQuotationSkipSchema.safeParse({ kind: "not_chargeable", reason: "Goodwill, agreed with the manager" }).success, true);
  assert.equal(fsmQuotationSkipSchema.safeParse({ kind: "later", reason: "Quotation being prepared" }).success, true);
  assert.equal(fsmQuotationSkipSchema.safeParse({ kind: "later", reason: " " }).success, false, "a reason is required");
  assert.equal(fsmQuotationSkipSchema.safeParse({ kind: "waived", reason: "Because" }).success, false, "only the two choices");
});

test("the close and complete actions carry it", () => {
  const skip = { kind: "later", reason: "Number to follow tomorrow" };
  assert.equal(callOutActionSchema.safeParse({ action: "close", fsmQuotationSkip: skip, hoursUsed: 8 }).success, true);
  assert.equal(additionalWorkActionSchema.safeParse({ action: "complete", fsmQuotationSkip: skip }).success, true);
  assert.equal(jobSheetActionSchema.safeParse({ action: "close", comment: null, send: "link", fsmQuotationSkip: skip, hoursUsed: 8 }).success, true);
});

test("hours beyond the free hours left are chargeable", () => {
  assert.equal(chargeableHandymanHours(8, 6, true), 2, "6 free hours left, 8 used: 2 chargeable");
  assert.equal(chargeableHandymanHours(5, 6, true), 0);
  assert.equal(chargeableHandymanHours(3, 0, true), 3, "none left: all chargeable");
  assert.equal(chargeableHandymanHours(4, null, true), 0, "unlimited: none chargeable");
  assert.equal(chargeableHandymanHours(4, 6, false), 4, "a chargeable booking: all chargeable");
});
