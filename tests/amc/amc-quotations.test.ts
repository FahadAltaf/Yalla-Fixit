import { test } from "node:test";
import assert from "node:assert/strict";

import { decideAmcQuotation, publicQuotation, quoteLinesFrom, quotationByToken } from "@/lib/server/amc/quotations";
import { hashLinkToken } from "@/lib/server/link-token";
import { fakeSupabase } from "./fake-supabase";

/* Zoho FSM is never called from these tests: writes off. */
process.env.ZOHO_FSM = "read";

/*
  27 Nov 2026: AMC call outs' and additional works' quotations, as
  Snagging's: a document the client approves (with their name) or rejects
  (with a reason) on a link, once. Zoho FSM stays out of these tests.
*/

test("the quotation's lines: a charged line at its price, a free one at no charge and said so", () => {
  const lines = quoteLinesFrom([
    { serviceId: null, label: "Replace AC drain pan", unit: "per job", units: 1, unitPrice: 350, cardPrice: null, charged: true },
    { serviceId: "ac-ppm", label: "Inspection", unit: "per visit", units: 2, unitPrice: 120, cardPrice: 120, charged: false, freeReason: "Goodwill" },
  ]);
  assert.deepEqual(lines, [
    { description: "Replace AC drain pan", qty: 1, unit: "per job", unit_price: 350, amount: 350 },
    { description: "Inspection (no charge)", qty: 2, unit: "per visit", unit_price: 0, amount: 0 },
  ]);
});

const TOKEN = "t".repeat(43);
const seed = (status: string, entity: "call_out" | "additional_work", extra: Record<string, unknown> = {}) =>
  fakeSupabase({
    amc_quotations: [
      {
        id: "q1",
        quote_number: "EST-1001",
        entity_type: entity,
        entity_id: entity === "call_out" ? "co1" : "aw1",
        contract_id: "c1",
        status,
        lines: [{ description: "Replace AC drain pan", qty: 1, unit: "", unit_price: 350, amount: 350 }],
        subtotal: 350,
        tax_rate: 5,
        tax_amount: 17.5,
        total: 367.5,
        client_snapshot: { client_name: "Test Client QA", unit_label: "Unit 101" },
        approval_token_hash: hashLinkToken(TOKEN),
        approval_token_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        created_by: "internal-user",
        fsm_estimate_id: "internal-fsm-id",
        ...extra,
      },
    ],
    amc_call_outs: [{ id: "co1", call_out_no: "CO-2026-0001", contract_id: "c1", issue: "AC not cooling", status: "open" }],
    amc_additional_works: [{ id: "aw1", work_no: "AW-2026-0001", contract_id: "c1", finding: "Drain pan cracked", status: "shared" }],
    amc_contracts: [{ id: "c1", contract_number: "AMC-C-2026-0001", customer_id: null, property_id: null, customer_name: "Test Client QA", property_label: "Unit 101", customer: {} }],
  });

test("the client approves on the link once, with their name; the work is approved with it", async () => {
  const w = seed("sent", "additional_work");
  const calls: Array<[string, string]> = [];
  const result = await decideAmcQuotation(w.client as never, TOKEN, { decision: "approve", name: "Test Client QA", reason: null }, async (d, input) => {
    calls.push([d, input.name]);
  });
  assert.equal(result.status, "approved");
  const q = w.table("amc_quotations")[0];
  assert.equal(q.status, "approved");
  assert.equal(q.approved_by_name, "Test Client QA");
  assert.equal(q.decided_origin, "client");
  assert.deepEqual(calls, [["approve", "Test Client QA"]], "the additional work follows the client's answer");
  assert.ok(w.table("amc_audit_events").some((e) => e.event_type === "quotation_approved_by_client"));
  await assert.rejects(decideAmcQuotation(w.client as never, TOKEN, { decision: "reject", name: "X", reason: "changed my mind" }, async () => undefined), /already been answered/);
});

test("a rejection needs a reason and a name; a call out's answer is recorded without moving any work", async () => {
  const w = seed("sent", "call_out");
  let workCalled = false;
  await assert.rejects(decideAmcQuotation(w.client as never, TOKEN, { decision: "reject", name: "Test Client QA", reason: " " }, async () => void (workCalled = true)), /reason is required/);
  await assert.rejects(decideAmcQuotation(w.client as never, TOKEN, { decision: "approve", name: " ", reason: null }, async () => void (workCalled = true)), /your name/);
  const result = await decideAmcQuotation(w.client as never, TOKEN, { decision: "reject", name: "Test Client QA", reason: "Too expensive" }, async () => void (workCalled = true));
  assert.equal(result.status, "rejected");
  assert.equal(w.table("amc_quotations")[0].rejected_reason, "Too expensive");
  assert.equal(workCalled, false, "a call out has no approval step to move");
});

test("a link opens only while the quotation is sent and in date; the client sees no internal fields", async () => {
  const open = await quotationByToken(seed("sent", "call_out").client as never, TOKEN);
  assert.ok("row" in open);
  const shown = JSON.stringify(publicQuotation((open as { row: Record<string, unknown> }).row));
  for (const internal of ["internal-user", "internal-fsm-id", "approval_token_hash"]) assert.ok(!shown.includes(internal), internal);
  assert.match(shown, /EST-1001/);

  const expired = await quotationByToken(seed("sent", "call_out", { approval_token_expires_at: "2020-01-01T00:00:00Z" }).client as never, TOKEN);
  assert.deepEqual("error" in expired ? expired.status : null, 410);
  const wrong = await quotationByToken(seed("sent", "call_out").client as never, "x".repeat(43));
  assert.deepEqual("error" in wrong ? wrong.status : null, 404);
  await assert.rejects(decideAmcQuotation(seed("void", "call_out").client as never, TOKEN, { decision: "approve", name: "A", reason: null }, async () => undefined), /no longer open/);
});
