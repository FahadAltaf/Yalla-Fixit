import { test } from "node:test";
import assert from "node:assert/strict";

import { fieldStartChecks, fieldStartProblems } from "@/lib/amc/field-start";
import { fitFor } from "@/lib/amc/visits";

/* 17 Nov 2026: call outs and additional work start as a planned visit does. */
const slot = { scheduledStart: "2026-11-20T05:00:00Z", scheduledEnd: "2026-11-20T07:00:00Z" };

test("a call out needs crew, time and access, never a client confirmation", () => {
  const keys = fieldStartChecks({ kind: "call_out", priority: "routine", technicianIds: [], scheduledStart: null, scheduledEnd: null, accessStatus: null }).map((c) => c.key);
  assert.deepEqual(keys, ["crew", "time", "access"]);
  assert.deepEqual(fieldStartProblems({ kind: "call_out", priority: "urgent", technicianIds: ["t1"], ...slot, accessStatus: "approved" }), []);
});

test("an emergency call out needs only its crew and access", () => {
  const keys = fieldStartChecks({ kind: "call_out", priority: "emergency", technicianIds: [], scheduledStart: null, scheduledEnd: null, accessStatus: null }).map((c) => c.key);
  assert.deepEqual(keys, ["crew", "access"]);
  assert.deepEqual(fieldStartProblems({ kind: "call_out", priority: "emergency", technicianIds: ["t1"], scheduledStart: null, scheduledEnd: null, accessStatus: "not_required" }), []);
  assert.equal(fieldStartProblems({ kind: "call_out", priority: "emergency", technicianIds: ["t1"], scheduledStart: null, scheduledEnd: null, accessStatus: "pending" })[0].key, "access");
});

/* 19 Nov 2026: additional work as a call out -- no client confirmation; the client's approval of the quotation first. */
test("additional work: approval, crew, time and access, no client confirmation", () => {
  const base = { kind: "additional_work" as const, technicianIds: ["t1"], ...slot, accessStatus: "approved" };
  assert.deepEqual(fieldStartChecks({ ...base, approved: false }).map((c) => c.key), ["approval", "crew", "time", "access"]);
  assert.deepEqual(fieldStartProblems({ ...base, clientConfirmation: null, approved: true }), [], "the client's confirmation is not asked");
  assert.equal(fieldStartProblems({ ...base, approved: false })[0].key, "approval");
});

test("access says what is wrong with the pass", () => {
  const problems = fieldStartProblems({ kind: "call_out", priority: "routine", technicianIds: ["t1"], ...slot, accessStatus: "rejected" });
  assert.equal(problems.length, 1);
  assert.match(problems[0].text, /rejected/);
});

/* 23 Nov 2026: access permissions on a technician's profile are not checked. */
test("a property's security clearance never blocks or notes a technician", () => {
  const tech = { fsmId: "t1", name: "Ahmed", active: true, shift: null, skills: [], areas: [], hasVehicle: true, isDriver: false, accessPermissions: [] };
  const free = { onLeave: false, overlaps: 0, workloadMinutes: 0 };
  const need = { trades: [], date: "2026-11-26", accessTypes: ["Emaar Community Management"] };
  const fit = fitFor(tech, need, free);
  assert.deepEqual(fit.blockers, []);
  assert.doesNotMatch(fit.notes.join(" "), /permission/);
});
