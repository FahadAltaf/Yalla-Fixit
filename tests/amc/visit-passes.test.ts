import { test } from "node:test";
import assert from "node:assert/strict";

import { accessFromPasses, defaultPassStatus, startProblems } from "@/lib/amc/visits";
import { refreshPropertyVisitsAccess } from "@/lib/server/amc/visits";
import { fakeSupabase } from "./fake-supabase";

/* 17 Nov 2026: a visit's access is worked out from its passes. */
const day = "2026-11-20";
const pass = (id: string, validUntil: string | null, uploadedAt = "2026-11-17T10:00:00Z") => ({ id, validUntil, uploadedAt });

test("a pass valid on the visit day approves it, until the latest such date", () => {
  assert.deepEqual(accessFromPasses([pass("a", "2026-11-25"), pass("b", "2026-11-30", "2026-11-17T11:00:00Z")], day, true), { status: "approved", validUntil: "2026-11-30", documentId: "b" });
});

test("a pass with no end date approves it with no end date", () => {
  assert.deepEqual(accessFromPasses([pass("a", null), pass("b", "2026-11-25")], day, true).validUntil, null);
});

test("passes that all run out before the visit leave it expired", () => {
  assert.equal(accessFromPasses([pass("a", "2026-11-18")], day, true).status, "expired");
});

test("no pass: pending when the property asks for one, else not required", () => {
  assert.equal(accessFromPasses([], day, true).status, "pending");
  assert.equal(accessFromPasses([], day, false).status, "not_required");
});

/* 17 Nov 2026: a visit starts only with its crew, time, client confirmation and access in place. */
test("start: every missing piece is named, with its tab", () => {
  const problems = startProblems({ status: "scheduled", contractActive: true, technicianIds: [], scheduledStart: null, scheduledEnd: null, clientConfirmation: "pending", accessStatus: "pending" });
  assert.deepEqual(problems.map((p) => p.tab), ["crew", "crew", "client", "access"]);
});

test("start: nothing missing, nothing to fix", () => {
  assert.deepEqual(startProblems({ status: "confirmed", contractActive: true, technicianIds: ["t1"], scheduledStart: "2026-11-20T05:00:00Z", scheduledEnd: "2026-11-20T11:00:00Z", clientConfirmation: "confirmed", accessStatus: "not_required" }), []);
});

test("start: a visit already under way cannot start again", () => {
  assert.equal(startProblems({ status: "in_progress", contractActive: true, technicianIds: ["t1"], scheduledStart: "x", scheduledEnd: "y", clientConfirmation: "confirmed", accessStatus: "approved" })[0].tab, null);
});

test("a property pass valid on the visit day approves the visits there", async () => {
  const w = fakeSupabase({
    amc_contracts: [{ id: "c1", property_id: "p1" }],
    amc_visits: [{ id: "v1", contract_id: "c1", status: "pending_access", target_date: "2026-11-20", scheduled_start: null, client_confirmation: "confirmed", access_status: "pending", access_valid_until: null, access_document_id: null }],
    amc_property_access_rules: [{ id: "r1", property_id: "p1", active: true }],
    amc_documents: [{ id: "d1", level: "property", entity_id: "p1", category: "Gate pass", expires_on: "2026-12-31", uploaded_at: "2026-11-17T10:00:00Z", superseded_by: null }],
  });
  assert.equal(await refreshPropertyVisitsAccess(w.client as never, "p1"), 1);
  const v = w.table("amc_visits")[0];
  assert.equal(v.access_status, "approved");
  assert.equal(v.status, "confirmed", "released from waiting for access");
});

/* 27 Nov 2026: approving a client's pass turned a planned visit of a confirmed schedule (no slot yet) into Not scheduled. */
test("released from waiting for access, a visit of a confirmed schedule is Scheduled again, slot or not", async () => {
  const visit = (id: string, contractId: string) => ({ id, contract_id: contractId, status: "pending_access", target_date: "2026-11-20", scheduled_start: null, client_confirmation: "pending", access_status: "pending", access_valid_until: null, access_document_id: null });
  const w = fakeSupabase({
    amc_contracts: [
      { id: "c1", property_id: "p1", ppm_confirmed_at: "2026-11-27T05:19:47Z" },
      { id: "c2", property_id: "p1", ppm_confirmed_at: null },
    ],
    amc_visits: [visit("v1", "c1"), visit("v2", "c2")],
    amc_property_access_rules: [{ id: "r1", property_id: "p1", active: true }],
    amc_documents: [{ id: "d1", level: "property", entity_id: "p1", category: "Gate pass", expires_on: "2026-12-31", uploaded_at: "2026-11-17T10:00:00Z", superseded_by: null }],
  });
  assert.equal(await refreshPropertyVisitsAccess(w.client as never, "p1"), 2);
  const status = (id: string) => w.table("amc_visits").find((v) => v.id === id)!.status;
  assert.equal(status("v1"), "scheduled", "part of a confirmed schedule");
  assert.equal(status("v2"), "not_scheduled", "a schedule not confirmed yet");
});

/* 17 Nov 2026: each pass has an access type and a status. */
const typed = (id: string, status: "approved" | "pending" | "rejected" | "expired" | "not_required", validUntil: string | null = null, uploadedAt = "2026-11-17T10:00:00Z") => ({ id, validUntil, uploadedAt, status });

test("a pass for an access rule starts approved; one for no rule starts pending", () => {
  assert.equal(defaultPassStatus("rule-1"), "approved");
  assert.equal(defaultPassStatus(null), "pending");
});

test("only an approved pass valid on the day approves the visit", () => {
  assert.equal(accessFromPasses([typed("a", "pending"), typed("b", "approved", "2026-11-25")], day, true).status, "approved");
  assert.deepEqual(accessFromPasses([typed("a", "pending", "2026-11-25")], day, true), { status: "pending", validUntil: "2026-11-25", documentId: "a" });
  assert.equal(accessFromPasses([typed("a", "rejected")], day, true).status, "rejected");
  assert.equal(accessFromPasses([typed("a", "not_required")], day, true).status, "not_required");
});

test("pending beats rejected; approved passes that ran out leave it expired", () => {
  assert.equal(accessFromPasses([typed("a", "rejected"), typed("b", "pending")], day, true).status, "pending");
  assert.equal(accessFromPasses([typed("a", "approved", "2026-11-10")], day, true).status, "expired");
  assert.equal(accessFromPasses([typed("a", "expired")], day, true).status, "expired");
});

test("a pass from before statuses counts as approved", () => {
  assert.equal(accessFromPasses([{ ...pass("a", null), status: null }], day, true).status, "approved");
});

test("a visit starts only with an approved pass valid on the day; the message says what is wrong", () => {
  const base = { status: "confirmed", contractActive: true, technicianIds: ["t1"], scheduledStart: "2026-11-20T05:00:00Z", scheduledEnd: "2026-11-20T07:00:00Z", clientConfirmation: "confirmed" };
  assert.deepEqual(startProblems({ ...base, accessStatus: "approved" }), []);
  assert.deepEqual(startProblems({ ...base, accessStatus: "not_required" }), []);
  for (const [status, word] of [["pending", "approved"], ["rejected", "rejected"], ["expired", "runs out"]] as const) {
    const problems = startProblems({ ...base, accessStatus: status });
    assert.equal(problems.length, 1);
    assert.equal(problems[0].tab, "access");
    assert.match(problems[0].text, new RegExp(word));
  }
});
