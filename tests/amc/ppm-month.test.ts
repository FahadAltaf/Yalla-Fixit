import assert from "node:assert/strict";
import test from "node:test";

import { ppmContactState } from "@/lib/amc/visits";
import { monthBounds, ppmMonth } from "@/lib/server/amc/ppm-month";
import { fakeSupabase } from "./fake-supabase";

/* DEV-492 (BRD v0.4 5.11): the coordinators' month of PPM visits, split into confirmed, contacted and not yet contacted. */
test("a visit is confirmed, contacted (an attempt or an answer logged) or not contacted yet", () => {
  assert.equal(ppmContactState("confirmed", 0), "confirmed");
  assert.equal(ppmContactState("pending", 1), "contacted");
  assert.equal(ppmContactState("no_answer", 0), "contacted");
  assert.equal(ppmContactState("pending", 0), "not_contacted", "pending is set when the to-do opens, before anyone calls");
  assert.equal(ppmContactState(null, 0), "not_contacted");
});

test("month bounds", () => {
  assert.deepEqual(monthBounds("2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthBounds("2026-11"), { from: "2026-11-01", to: "2026-11-30" });
  assert.equal(monthBounds("2026-13"), null);
  assert.equal(monthBounds("Nov"), null);
});

test("the month lists its visits with client, property, services, date and coordinator", async () => {
  const contract = (owner: string, status = "active") => ({ id: "c-" + owner, status, contract_number: "AMC-C-" + owner, customer_name: null, customer: { customerName: "Client " + owner }, property_label: "Villa " + owner, submission: { owner_id: owner } });
  const w = fakeSupabase({
    amc_visits: [
      { id: "v1", contract_id: "c-a", visit_no: 1, status: "scheduled", target_date: "2026-11-05", scheduled_start: null, client_confirmation: "pending", lines: [{ service_label: "AC service", status: "planned" }], contract: contract("a") },
      { id: "v2", contract_id: "c-a", visit_no: 2, status: "confirmed", target_date: "2026-11-20", scheduled_start: "2026-11-20T05:00:00Z", client_confirmation: "confirmed", lines: [], contract: contract("a") },
      { id: "v3", contract_id: "c-b", visit_no: 1, status: "scheduled", target_date: "2026-11-12", scheduled_start: null, client_confirmation: null, lines: [{ service_label: "Pest control", status: "planned" }, { service_label: "Old", status: "cancelled" }], contract: contract("b") },
      { id: "v4", contract_id: "c-b", visit_no: 2, status: "cancelled", target_date: "2026-11-15", scheduled_start: null, client_confirmation: null, lines: [], contract: contract("b") },
      { id: "v5", contract_id: "c-b", visit_no: 3, status: "scheduled", target_date: "2026-12-01", scheduled_start: null, client_confirmation: null, lines: [], contract: contract("b") },
      { id: "v6", contract_id: "c-c", visit_no: 1, status: "scheduled", target_date: "2026-11-10", scheduled_start: null, client_confirmation: null, lines: [], contract: contract("c", "terminated") },
    ],
    amc_visit_attempts: [
      { visit_id: "v1", attempted_at: "2026-10-30T08:00:00Z" },
      { visit_id: "v1", attempted_at: "2026-11-01T08:00:00Z" },
    ],
    user_profile: [{ id: "a", full_name: "Coordinator A", email: "a@x.test" }],
  });
  const all = await ppmMonth(w.client as never, "2026-11");
  assert.deepEqual(all.items.map((i) => i.visitId).sort(), ["v1", "v2", "v3"], "in the month, not cancelled, on a live contract");
  const v1 = all.items.find((i) => i.visitId === "v1")!;
  assert.equal(v1.state, "contacted");
  assert.equal(v1.attempts, 2);
  assert.equal(v1.lastAttemptAt, "2026-11-01T08:00:00Z");
  assert.equal(v1.customerName, "Client a");
  assert.equal(v1.coordinatorName, "Coordinator A");
  assert.equal(all.items.find((i) => i.visitId === "v2")!.state, "confirmed");
  const v3 = all.items.find((i) => i.visitId === "v3")!;
  assert.equal(v3.state, "not_contacted");
  assert.deepEqual(v3.services, ["Pest control"]);

  const mine = await ppmMonth(w.client as never, "2026-11", "b");
  assert.deepEqual(mine.items.map((i) => i.visitId), ["v3"], "a coordinator's own contracts only");
});
