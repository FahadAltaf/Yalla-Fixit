import assert from "node:assert/strict";
import test from "node:test";

import { freeLineProblems, newlyFreeLines, type ChargeLine } from "@/lib/amc/visit-charges";

/* DEV-498 (20 Nov 2026): a chargeable call out line marked Free needs a reason and the right; it is kept in history. */
const line = (label: string, charged: boolean, extra: Partial<ChargeLine> = {}): ChargeLine => ({ serviceId: label.toLowerCase(), label, unit: null, units: 1, unitPrice: 100, cardPrice: 100, charged, ...extra });

test("a line made free on chargeable work needs the right and a reason", () => {
  const before = [line("AC service", true)];
  const next = [line("AC service", false)];
  assert.equal(newlyFreeLines(next, before, true).length, 1);
  assert.match(freeLineProblems(next, before, true, false)[0], /needs AMC Allowances/);
  assert.match(freeLineProblems(next, before, true, true)[0], /Say why/);
  assert.deepEqual(freeLineProblems([line("AC service", false, { freeReason: "Goodwill after a late visit" })], before, true, true), []);
});

test("a covered call out is free by default and asks nothing; a line already free is not asked again", () => {
  assert.deepEqual(freeLineProblems([line("AC service", false)], [], false, false), [], "covered: free by default");
  assert.deepEqual(freeLineProblems([line("AC service", false)], [line("AC service", false)], true, false), [], "already free before");
  assert.deepEqual(freeLineProblems([line("AC service", true)], [], true, false), [], "charged lines need nothing");
});

test("a custom service is matched by its name", () => {
  const custom = (charged: boolean) => line("Replace valve", charged, { serviceId: null });
  assert.deepEqual(newlyFreeLines([custom(false)], [custom(false)], true), []);
  assert.equal(newlyFreeLines([custom(false)], [custom(true)], true).length, 1);
});

/* The save itself: refused without the right or the reason; with both, the reason and who decided stay on the line and in the history. */
test("saving a chargeable call out's services enforces and records the free line", async () => {
  const { saveCallOutServices } = await import("@/lib/server/amc/visit-charges");
  const { fakeSupabase } = await import("./fake-supabase");
  const w = fakeSupabase({
    amc_call_outs: [{ id: "co1", call_out_no: "CO-2026-0001", contract_id: "c1", status: "scheduled", coverage: "chargeable" }],
    amc_visit_charges: [{ id: "ch1", call_out_id: "co1", contract_id: "c1", lines: [line("AC service", true)], subtotal: 100, vat_amount: 5, total: 105, status: "due", created_at: "2026-11-20T00:00:00Z" }],
    amc_contracts: [{ id: "c1", property: {} }],
  });
  const actor = { id: "u1", label: "Ops Lead" };
  await assert.rejects(() => saveCallOutServices(w.client as never, "co1", [line("AC service", false, { freeReason: "Goodwill" })], actor, false), (e: { status?: number }) => e.status === 403);
  await assert.rejects(() => saveCallOutServices(w.client as never, "co1", [line("AC service", false)], actor, true), (e: { status?: number }) => e.status === 400);
  const saved = await saveCallOutServices(w.client as never, "co1", [line("AC service", false, { freeReason: "Goodwill after a late visit" })], actor, true);
  assert.equal(saved?.lines[0].freeReason, "Goodwill after a late visit");
  assert.equal(saved?.lines[0].freedBy, "Ops Lead");
  assert.equal(saved?.status, "waived");
  const events = w.table("amc_audit_events").filter((e) => e.event_type === "charge_line_marked_free");
  assert.equal(events.length, 1);
  assert.equal((events[0].payload as { reason: string }).reason, "Goodwill after a late visit");
  /* Saved again unchanged: the line stays free with its reason, and nothing new is asked or logged. */
  const again = await saveCallOutServices(w.client as never, "co1", [line("AC service", false)], { id: "u2", label: "Other" }, false);
  assert.equal(again?.lines[0].freeReason, "Goodwill after a late visit");
  assert.equal(w.table("amc_audit_events").filter((e) => e.event_type === "charge_line_marked_free").length, 1);
});
