import { test } from "node:test";
import assert from "node:assert/strict";

import { MOVE_MAX_DAYS_AHEAD, moveDayProblem, moveEntriesSchema, moveSummary, movedFrom, slotOnDay } from "@/lib/scheduling/move-entries";

/* DEV-393 (25 Nov 2026): moving entries across days and in bulk on the Scheduling board. */

const DUBAI = "Asia/Dubai";
const ID = "11111111-1111-4111-8111-111111111111";

test("an entry keeps its clock time and length on the new day", () => {
  /* 09:00 to 11:00 Dubai on 25 Nov (05:00Z to 07:00Z). */
  const moved = slotOnDay({ startAt: "2026-11-25T05:00:00.000Z", endAt: "2026-11-25T07:00:00.000Z", operatingDate: "2026-11-25" }, "2026-11-28", DUBAI);
  assert.deepEqual(moved, { startAt: "2026-11-28T05:00:00.000Z", endAt: "2026-11-28T07:00:00.000Z" });
});

test("a night job after midnight stays after midnight of the night it belongs to", () => {
  /* Listed on 25 Nov, runs 01:00 to 03:00 Dubai on the 26th. */
  const moved = slotOnDay({ startAt: "2026-11-25T21:00:00.000Z", endAt: "2026-11-25T23:00:00.000Z", operatingDate: "2026-11-25" }, "2026-11-27", DUBAI);
  assert.deepEqual(moved, { startAt: "2026-11-27T21:00:00.000Z", endAt: "2026-11-27T23:00:00.000Z" });
});

test("entries move from today up to the planning horizon, not into the past", () => {
  assert.equal(moveDayProblem("2026-11-25", "2026-11-25"), null);
  assert.equal(moveDayProblem("2026-12-09", "2026-11-25"), null, `${MOVE_MAX_DAYS_AHEAD} days ahead is allowed`);
  assert.match(moveDayProblem("2026-11-24", "2026-11-25") ?? "", /past/);
  assert.match(moveDayProblem("2026-12-10", "2026-11-25") ?? "", /up to 14 days ahead/);
});

test("a moved entry remembers the day it was first planned for", () => {
  assert.equal(movedFrom({ operating_date: "2026-11-27", original_operating_date: "2026-11-25" }), "2026-11-25");
  assert.equal(movedFrom({ operating_date: "2026-11-25", original_operating_date: "2026-11-25" }), null, "moved back: nothing to say");
  assert.equal(movedFrom({ operating_date: "2026-11-25", original_operating_date: null }), null);
  assert.equal(movedFrom({ operating_date: "2026-11-25" }), null, "before the migration the column is missing");
});

test("a move needs a day or a crew, and names the entries", () => {
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [ID] }).success, false, "nothing to change");
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [], toDate: "2026-11-26" }).success, false, "nothing selected");
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [ID], toDate: "2026-11-26" }).success, true);
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [ID], technicianFsmIds: ["T1"] }).success, true, "crew only: a bulk reassignment");
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [ID], technicianFsmIds: [] }).success, false, "an empty crew is not a crew");
  assert.equal(moveEntriesSchema.safeParse({ entryIds: [ID], toDate: "26/11/2026" }).success, false);
  assert.equal(moveEntriesSchema.safeParse({ entryIds: Array(51).fill(ID), toDate: "2026-11-26" }).success, false, "at most 50 at a time");
});

test("the toast says what moved and what did not", () => {
  const moved = { entryId: "a", label: "A", status: "moved" as const };
  const skipped = { entryId: "b", label: "B", status: "skipped" as const, reason: "On leave" };
  assert.equal(moveSummary([moved, { ...moved, entryId: "c" }]), "2 entries changed");
  assert.equal(moveSummary([moved, skipped]), "1 entry changed, 1 entry not");
  assert.equal(moveSummary([skipped]), "Nothing changed: 1 entry could not be changed");
});
