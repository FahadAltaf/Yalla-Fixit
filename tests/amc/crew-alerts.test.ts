import assert from "node:assert/strict";
import test from "node:test";

import { alertCrew, alertCrewChange, crewChanges } from "@/lib/server/amc/crew-alerts";
import { fakeSupabase } from "./fake-supabase";

/* 22 Nov 2026: AMC work alerts on the technician's / inspector's phone, as Snagging's. */
const seed = () =>
  fakeSupabase({
    technician_reference: [
      { fsm_resource_id: "f1", user_profile_id: "u1" },
      { fsm_resource_id: "f2", user_profile_id: "u2" },
      { fsm_resource_id: "f3", user_profile_id: null },
    ],
    snagging_notifications: [],
  });

test("who joined, who left, and whether the time moved", () => {
  const c = crewChanges({ ids: ["f1", "f2"], start: "2026-11-24T05:00:00Z" }, { ids: ["f2", "f3"], start: "2026-11-25T05:00:00Z" });
  assert.deepEqual(c, { added: ["f3"], removed: ["f1"], kept: ["f2"], moved: true });
});

test("a new crew is told it is theirs; only technicians with a login get it", async () => {
  const w = seed();
  const n = await alertCrewChange(w.client as never, { kind: "call_out", id: "co1", what: "call out CO-1", where: "Client, Villa", before: { ids: [], start: null }, after: { ids: ["f1", "f3"], start: "2026-11-24T05:00:00Z" } });
  assert.equal(n, 1);
  const a = w.table("snagging_notifications")[0];
  assert.deepEqual([a.user_id, a.type, a.amc_kind, a.amc_id], ["u1", "assigned", "call_out", "co1"]);
  assert.match(String(a.title), /New call out CO-1/);
  assert.equal(a.when_at, "2026-11-24T05:00:00Z");
});

test("moved: those staying hear the new time; removed: told it is off their list", async () => {
  const w = seed();
  await alertCrewChange(w.client as never, { kind: "ppm", id: "v1", what: "AMC visit 2", where: "Client, Villa", before: { ids: ["f1", "f2"], start: "2026-11-24T05:00:00Z" }, after: { ids: ["f2"], start: "2026-11-25T06:00:00Z" } });
  const rows = w.table("snagging_notifications");
  assert.equal(rows.length, 2);
  const u1 = rows.find((r) => r.user_id === "u1")!;
  const u2 = rows.find((r) => r.user_id === "u2")!;
  assert.match(String(u1.title), /Taken off AMC visit 2/);
  assert.equal(u1.amc_id, null, "taken off: nothing to open");
  assert.equal(u2.amc_id, "v1");
  assert.match(String(u2.title), /AMC visit 2 moved/);
  assert.equal(u2.type, "rescheduled");
});

test("nothing changed: nothing sent; a sent-back alert goes to the user named", async () => {
  const w = seed();
  assert.equal(await alertCrewChange(w.client as never, { kind: "ppm", id: "v1", what: "AMC visit 2", where: "x", before: { ids: ["f1"], start: "2026-11-24T05:00:00Z" }, after: { ids: ["f1"], start: "2026-11-24T05:00:00Z" } }), 0);
  await alertCrew(w.client as never, { kind: "site_visit", id: "a1", type: "visit_sent_back", userIds: ["u9"], title: "Site visit SV-1 sent back", body: "Add the photos" });
  assert.equal(w.table("snagging_notifications").at(-1)?.amc_kind, "site_visit");
});

test("only the people on the work: never a switched-off user, never the one who made the change, never twice in a minute", async () => {
  const w = fakeSupabase({
    technician_reference: [
      { fsm_resource_id: "f1", user_profile_id: "u1" },
      { fsm_resource_id: "f2", user_profile_id: "u2" },
      { fsm_resource_id: "f3", user_profile_id: "u3" },
    ],
    user_profile: [
      { id: "u1", is_active: true },
      { id: "u2", is_active: false },
      { id: "u3", is_active: true },
    ],
    snagging_notifications: [],
  });
  const change = { kind: "call_out" as const, id: "co9", what: "call out CO-9", where: "Client", before: { ids: [], start: null }, after: { ids: ["f1", "f2", "f3"], start: "2026-11-24T05:00:00Z" }, actorId: "u3" };
  assert.equal(await alertCrewChange(w.client as never, change), 1, "u2 is switched off, u3 made the change");
  assert.deepEqual(w.table("snagging_notifications").map((n) => n.user_id), ["u1"]);
  assert.equal(await alertCrewChange(w.client as never, change), 0, "a double save sends nothing more");
  assert.equal(w.table("snagging_notifications").length, 1);
});
