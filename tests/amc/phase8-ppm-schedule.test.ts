import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  buildPpmSchedule,
  classifyMove,
  clubbedWindow,
  clubbingGroups,
  firstWorkingDay,
  isWorkingDay,
  planLine,
  ppmActionSchema,
  ppmProgress,
  visitsOverTerm,
  windowAfterMove,
  type WorkingCalendar,
} from "@/lib/amc/ppm";

/* Phase 8 of the BRD v0.3 plan: the PPM schedule (DEV-354, 388, 389, 390). */

/* UAE: Sunday off (as AMC configuration), plus a holiday on 2 Dec 2026. */
const calendar: WorkingCalendar = { weekendDays: [0], holidays: [{ date: "2026-12-02", name: "National Day" }] };
const term = { commencementDate: "2026-11-01", endDate: "2027-10-31", termMonths: 12, windowDays: 15, calendar };

test("working days skip the weekend and holidays", () => {
  assert.equal(isWorkingDay("2026-11-01", calendar), false, "a Sunday");
  assert.equal(isWorkingDay("2026-12-02", calendar), false, "a holiday");
  assert.equal(isWorkingDay("2026-11-02", calendar), true);
  assert.equal(firstWorkingDay("2026-11-01", "2026-11-15", calendar), "2026-11-02");
  assert.equal(firstWorkingDay("2026-12-01", "2026-12-15", calendar, [3]), "2026-12-09", "the client prefers Wednesdays; 2 Dec is a holiday");
});

test("visits over the term: frequency a year, pro rata, at least one", () => {
  assert.equal(visitsOverTerm(6, 12), 6);
  assert.equal(visitsOverTerm(4, 24), 8);
  assert.equal(visitsOverTerm(1, 6), 1);
});

test("a line spreads evenly: 6 a year is every 2 months, windows of 15 days, first working day", () => {
  const visits = planLine({ entitlementId: "e1", serviceId: "ac-ppm", label: "AC PPM", frequencyPerYear: 6 }, term);
  assert.equal(visits.length, 6);
  assert.deepEqual(
    visits.map((v) => v.cycleStart),
    ["2026-11-01", "2027-01-01", "2027-03-01", "2027-05-01", "2027-07-01", "2027-09-01"],
  );
  assert.equal(visits[0].windowStart, "2026-11-01");
  assert.equal(visits[0].windowEnd, "2026-11-15");
  assert.equal(visits[0].targetDate, "2026-11-02", "1 Nov 2026 is a Sunday");
  assert.equal(visits[0].cycleEnd, "2026-12-31");
  assert.equal(visits.at(-1)!.cycleEnd, "2027-10-31", "the last cycle ends with the contract");
  /* A frequency that does not divide the term falls back to equal days. */
  const five = planLine({ entitlementId: "e2", serviceId: "x", label: "X", frequencyPerYear: 5 }, term);
  assert.equal(five.length, 5);
  assert.equal(five[1].cycleStart, "2027-01-13", "365 days / 5 = 73");
  for (const v of visits) assert.ok(v.windowStart >= v.cycleStart && v.windowEnd <= v.cycleEnd, "the window sits inside its cycle");
});

test("preferred months move the window into that month", () => {
  const visits = planLine({ entitlementId: "e1", serviceId: "ac", label: "AC", frequencyPerYear: 2, preferredMonths: [3, 9] }, term);
  assert.deepEqual(visits.map((v) => v.windowStart), ["2027-03-01", "2027-09-01"]);
});

test("the schedule lists every line's visits in date order", () => {
  const all = buildPpmSchedule({
    ...term,
    lines: [
      { entitlementId: "e1", serviceId: "ac", label: "AC PPM", frequencyPerYear: 4 },
      { entitlementId: "e2", serviceId: "plumb", label: "Plumbing", frequencyPerYear: 2 },
    ],
  });
  assert.equal(all.length, 6);
  for (let i = 1; i < all.length; i += 1) assert.ok(all[i - 1].targetDate <= all[i].targetDate);
});

test("moving a visit: inside its window is not a reschedule; outside it after confirmation needs a reason", () => {
  const v = { windowStart: "2026-11-01", windowEnd: "2026-11-15", cycleStart: "2026-11-01", cycleEnd: "2026-12-30" };
  assert.deepEqual(classifyMove(v, "2026-11-10", true), { kind: "in_window", needsReason: false });
  assert.deepEqual(classifyMove(v, "2026-11-20", true), { kind: "outside_window", needsReason: true });
  assert.deepEqual(classifyMove(v, "2026-11-20", false), { kind: "outside_window", needsReason: false }, "still planning");
  assert.deepEqual(windowAfterMove(v, "2026-11-20", 15, true), { windowStart: "2026-11-01", windowEnd: "2026-11-15" }, "adherence keeps the window");
  assert.deepEqual(windowAfterMove(v, "2026-11-20", 15, false), { windowStart: "2026-11-20", windowEnd: "2026-12-04" });
});

test("clubbing: where the windows meet, the earlier target; never two visits of one service", () => {
  assert.deepEqual(
    clubbedWindow(
      [
        { windowStart: "2026-11-01", windowEnd: "2026-11-15", targetDate: "2026-11-02" },
        { windowStart: "2026-11-05", windowEnd: "2026-11-20", targetDate: "2026-11-05" },
      ],
      calendar,
    ),
    { windowStart: "2026-11-05", windowEnd: "2026-11-15", targetDate: "2026-11-05" },
  );
  assert.equal(
    clubbedWindow(
      [
        { windowStart: "2026-11-01", windowEnd: "2026-11-15", targetDate: "2026-11-02" },
        { windowStart: "2026-12-01", windowEnd: "2026-12-15", targetDate: "2026-12-01" },
      ],
      calendar,
    ),
    null,
  );
  const groups = clubbingGroups([
    { id: "a", windowStart: "2026-11-01", windowEnd: "2026-11-15", lineIds: ["ac"] },
    { id: "b", windowStart: "2026-11-03", windowEnd: "2026-11-17", lineIds: ["plumb"] },
    { id: "c", windowStart: "2026-11-04", windowEnd: "2026-11-18", lineIds: ["ac"] },
    { id: "d", windowStart: "2027-01-01", windowEnd: "2027-01-15", lineIds: ["elec"] },
  ]);
  assert.deepEqual(groups.map((g) => g.map((v) => v.id)), [["a", "b"]], "c is AC again, d is alone");
});

test("progress: completed, remaining, overdue", () => {
  const p = ppmProgress(
    [
      { id: "1", status: "completed", windowEnd: "2026-11-15", targetDate: "2026-11-02" },
      { id: "2", status: "scheduled", windowEnd: "2026-12-15", targetDate: "2026-12-01" },
      { id: "3", status: "scheduled", windowEnd: "2027-01-15", targetDate: "2027-01-04" },
      { id: "4", status: "cancelled", windowEnd: "2027-02-15", targetDate: "2027-02-01" },
    ],
    "2026-12-20",
  );
  assert.deepEqual([p.total, p.completed, p.remaining, p.overdue, p.cancelled], [3, 1, 2, 1, 1]);
  assert.deepEqual(p.nextVisit, { id: "3", targetDate: "2027-01-04" });
});

test("actions are checked", () => {
  const id = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";
  assert.equal(ppmActionSchema.safeParse({ action: "remove", visitId: id, reason: "" }).success, false, "removing says why");
  assert.equal(ppmActionSchema.safeParse({ action: "add", entitlementId: id, date: "2026-11-10", reason: "Client asked" }).success, true);
  assert.equal(ppmActionSchema.safeParse({ action: "club", visitIds: [id] }).success, false, "clubbing takes two or more");
  assert.equal(ppmActionSchema.safeParse({ action: "move", visitId: id, date: "2026-11-10" }).success, true, "a reason only when outside the window (checked on the server)");
  assert.equal(
    ppmActionSchema.safeParse({ action: "rules", windowDays: null, attemptCount: 3, attemptIntervalDays: 2, attemptChannels: ["whatsapp"], escalationUserId: null }).success,
    true,
  );
});

test("migration: branch-only tables, twelve statuses, history append-only, visit-level FSM link", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261008110000_amc_ppm_schedule.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const s of ["not_scheduled", "scheduled", "confirmed", "in_progress", "submitted", "completed", "completed_with_additional_work", "partially_completed", "pending_access", "rescheduled", "not_completed", "cancelled"]) {
    assert.match(sql, new RegExp(`'${s}'`), s);
  }
  for (const t of ["amc_visits", "amc_visit_lines", "amc_visit_changes"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), `${t} RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`), `${t} revoked`);
  }
  assert.match(sql, /amc_visit_changes_locked/);
  assert.match(sql, /ALTER TABLE public\.amc_fsm_links\s+ADD COLUMN IF NOT EXISTS visit_id/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /amc_submissions/, "the live table is not touched");
  assert.doesNotMatch(sql, /DROP TABLE|SECURITY DEFINER/);
});
