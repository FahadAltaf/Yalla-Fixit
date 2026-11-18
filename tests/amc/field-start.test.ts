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

test("additional work also needs the client's confirmation", () => {
  const base = { kind: "additional_work" as const, technicianIds: ["t1"], ...slot, accessStatus: "approved" };
  assert.deepEqual(fieldStartChecks({ ...base, clientConfirmation: null }).map((c) => c.key), ["crew", "time", "client", "access"]);
  assert.equal(fieldStartProblems({ ...base, clientConfirmation: "pending" })[0].key, "client");
  assert.equal(fieldStartProblems({ ...base, clientConfirmation: "declined" })[0].key, "client");
  assert.deepEqual(fieldStartProblems({ ...base, clientConfirmation: "confirmed" }), []);
});

test("access says what is wrong with the pass", () => {
  const problems = fieldStartProblems({ kind: "call_out", priority: "routine", technicianIds: ["t1"], ...slot, accessStatus: "rejected" });
  assert.equal(problems.length, 1);
  assert.match(problems[0].text, /rejected/);
});

test("a missing access permission blocks a planned visit's crew, but is only noted for a call out", () => {
  const tech = { fsmId: "t1", name: "Ahmed", active: true, shift: null, skills: [], areas: [], hasVehicle: true, isDriver: false, accessPermissions: [] };
  const free = { onLeave: false, overlaps: 0, workloadMinutes: 0 };
  const need = { trades: [], date: "2026-11-26", accessTypes: ["Emaar Community Management"] };
  assert.match(fitFor(tech, need, free).blockers.join(" "), /No access permission/);
  const callOut = fitFor(tech, { ...need, accessAsNote: true }, free);
  assert.deepEqual(callOut.blockers, []);
  assert.match(callOut.notes.join(" "), /pass covers access/);
});
