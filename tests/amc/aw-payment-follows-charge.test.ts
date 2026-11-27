import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
  27 Nov 2026: additional work showed "Paid" on its charge and a second
  "Paid" button in the header. The payment is recorded once, on the charge,
  as a call out's is, and invoiced work follows it to Paid.
*/
const read = (p: string) => readFileSync(p, "utf8");

test("invoiced work follows its paid charge, from both directions", () => {
  const works = read("lib/server/amc/additional-works.ts");
  assert.match(works, /export async function settleWorkFromCharge/);
  assert.match(works, /case "invoice":[\s\S]*?settleWorkFromCharge\(admin, id, actor\)/, "invoicing a work whose charge is paid closes it");
  const route = read("app/api/amc-field-work/[kind]/[id]/charge/route.ts");
  assert.match(route, /if \(kind === "additional_work"\) await settleWorkFromCharge/, "recording the charge payment closes invoiced work");
});

test("the header records the payment on the charge, and never asks twice", () => {
  const ui = read("components/dashboard/extensions/amc-contracts/additional-work-sections.tsx");
  assert.match(ui, /charge\?\.status === "due" \? \([\s\S]*?Record payment/);
  assert.match(ui, /<RecordChargePaymentDialog/);
  assert.doesNotMatch(ui, /description: "The client paid the invoice\."/, "no second, reference-only payment for a charged work");
});
