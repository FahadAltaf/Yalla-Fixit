import { test } from "node:test";
import assert from "node:assert/strict";

import { accessFromPasses, startProblems } from "@/lib/amc/visits";
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
