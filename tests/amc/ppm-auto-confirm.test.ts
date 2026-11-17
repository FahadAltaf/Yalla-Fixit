import { test } from "node:test";
import assert from "node:assert/strict";

import { rewindowVisit, visitRenumbering } from "@/lib/amc/ppm";
import { confirmPpmSchedule } from "@/lib/server/amc/ppm";
import { fakeSupabase } from "./fake-supabase";

/* 17 Nov 2026: the PPM schedule is confirmed when the contract starts; no Confirm button. */
const seed = () =>
  fakeSupabase({
    amc_contracts: [{ id: "c1", status: "active", ppm_confirmed_at: null }],
    amc_visits: [
      { id: "v1", contract_id: "c1", status: "not_scheduled" },
      { id: "v2", contract_id: "c1", status: "not_scheduled" },
      { id: "v3", contract_id: "c1", status: "cancelled" },
    ],
  });
const actor = { id: "u1", label: "Tester" };

test("confirming makes the open visits Scheduled and records it once", async () => {
  const w = seed();
  assert.equal(await confirmPpmSchedule(w.client as never, "c1", actor, { auto: true }), 2);
  assert.ok(w.table("amc_contracts")[0].ppm_confirmed_at, "the contract is confirmed");
  assert.deepEqual(w.table("amc_visits").map((v) => v.status), ["scheduled", "scheduled", "cancelled"]);
  assert.equal(w.table("amc_visit_changes").length, 1);

  /* A second call (the page read, or a second payment) changes nothing. */
  await confirmPpmSchedule(w.client as never, "c1", actor, { auto: true });
  assert.equal(w.table("amc_visit_changes").length, 1, "confirmed once");
});

test("nothing to confirm without visits", async () => {
  const w = fakeSupabase({ amc_contracts: [{ id: "c1", status: "active", ppm_confirmed_at: null }] });
  assert.equal(await confirmPpmSchedule(w.client as never, "c1", actor, { auto: true }), 0);
  assert.equal(w.table("amc_contracts")[0].ppm_confirmed_at, null);
});

/* 17 Nov 2026: a new window length reaches the visits not yet done. */
const cal = { weekendDays: [0, 6], holidays: [] };

test("a shorter window keeps the start, ends sooner, and pulls a date inside it", () => {
  /* 17 Nov 2026 is a Tuesday; 15 days ran to 1 Dec. */
  assert.deepEqual(rewindowVisit({ windowStart: "2026-11-17", cycleEnd: "2027-01-16", targetDate: "2026-11-17", keepDate: false }, 5, cal), { windowEnd: "2026-11-21", targetDate: "2026-11-17" });
  assert.deepEqual(rewindowVisit({ windowStart: "2026-11-17", cycleEnd: "2027-01-16", targetDate: "2026-11-25", keepDate: false }, 5, cal), { windowEnd: "2026-11-21", targetDate: "2026-11-17" });
});

test("a date moved on purpose or agreed with the client is kept", () => {
  assert.equal(rewindowVisit({ windowStart: "2026-11-17", cycleEnd: "2027-01-16", targetDate: "2026-11-25", keepDate: true }, 5, cal).targetDate, "2026-11-25");
});

test("the window never runs past its cycle", () => {
  assert.equal(rewindowVisit({ windowStart: "2026-11-17", cycleEnd: "2026-11-30", targetDate: "2026-11-17", keepDate: false }, 60, cal).windowEnd, "2026-11-30");
});

/* 17 Nov 2026: visit numbers follow the dates after club, separate, add or remove. */
test("a separated trade takes its place in date order, not the next free number", () => {
  const moves = visitRenumbering([
    { id: "a", visitNo: 1, status: "scheduled", targetDate: "2026-11-17" },
    { id: "s", visitNo: 17, status: "scheduled", targetDate: "2026-11-17" },
    { id: "c", visitNo: 3, status: "cancelled", targetDate: "2026-11-17" },
    { id: "d", visitNo: 4, status: "scheduled", targetDate: "2027-01-02" },
  ]);
  assert.deepEqual(Object.fromEntries(moves), { s: 2, d: 3, c: 4 });
});

test("a visit that has started or is done keeps its number", () => {
  const moves = visitRenumbering([
    { id: "done", visitNo: 2, status: "completed", targetDate: "2026-11-01" },
    { id: "x", visitNo: 5, status: "scheduled", targetDate: "2026-10-01" },
    { id: "y", visitNo: 1, status: "scheduled", targetDate: "2026-12-01" },
  ]);
  assert.deepEqual(Object.fromEntries(moves), { x: 1, y: 3 });
});
