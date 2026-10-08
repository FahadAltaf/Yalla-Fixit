import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  accessAlertDue,
  assignmentProblems,
  attemptState,
  boardActionSchema,
  confirmationDue,
  crewNeed,
  defaultAccessStatus,
  effectiveAccess,
  fitFor,
  slotsOverlap,
  suggestCrew,
  technicianProfileSchema,
  tradeForService,
  type TechnicianFacts,
} from "@/lib/amc/visits";

/* Phase 9 of the BRD v0.3 plan: skills, assignment, confirmation, access (DEV-356, 392-399). */

const tech = (fsmId: string, skills: TechnicianFacts["skills"], more: Partial<TechnicianFacts> = {}): TechnicianFacts => ({
  fsmId,
  name: fsmId.toUpperCase(),
  active: true,
  shift: "morning",
  skills,
  areas: [],
  hasVehicle: true,
  isDriver: false,
  accessPermissions: [],
  ...more,
});
const free = { onLeave: false, overlaps: 0, workloadMinutes: 0 };
const need = { trades: ["ac" as const], date: "2026-11-10", area: null, accessTypes: [] as string[] };

test("a service's trade: the scope first, then the catalogue, then its name", () => {
  assert.equal(tradeForService("ac-ppm", "AC PPM"), "ac");
  assert.equal(tradeForService("water-tank", "Water tank cleaning"), "plumbing");
  assert.equal(tradeForService("custom-1", "Electrical panel check"), "electrical");
  assert.equal(tradeForService("ac-ppm", "AC PPM", "civil"), "civil", "the property's scope says otherwise");
  assert.equal(tradeForService("x", "Garden"), "other");
});

test("crew and time from the visit's lines and the standard durations", () => {
  const n = crewNeed([{ trade: "ac", units: 3 }, { trade: "plumbing" }], { durationPerServiceMinutes: 60, durationPerExtraUnitMinutes: 20 });
  assert.deepEqual(n, { trades: ["ac", "plumbing"], durationMinutes: 60 + 40 + 60, headcount: 2 });
});

test("only competent technicians, with a valid certificate, free, with the access permission", () => {
  const ok = fitFor(tech("a", [{ trade: "ac", level: "competent", certificateExpires: null }]), need, free);
  assert.deepEqual([ok.covers, ok.blockers], [["ac"], []]);
  assert.match(fitFor(tech("b", [{ trade: "ac", level: "trainee", certificateExpires: null }]), need, free).blockers[0], /Not confirmed/, "a trainee is not competent");
  assert.match(fitFor(tech("c", [{ trade: "ac", level: "expert", certificateExpires: "2026-10-01" }]), need, free).blockers[0], /Certificate expired/);
  assert.match(fitFor(tech("d", [{ trade: "plumbing", level: "expert", certificateExpires: null }]), need, free).blockers[0], /Not confirmed/, "never a merely similar technician");
  assert.ok(fitFor(tech("e", [{ trade: "ac", level: "competent", certificateExpires: null }]), need, { ...free, onLeave: true }).blockers.includes("On leave that day"));
  assert.ok(fitFor(tech("f", [{ trade: "ac", level: "competent", certificateExpires: null }]), need, { ...free, overlaps: 1 }).blockers.includes("Already booked at that time"));
  const clearance = { ...need, accessTypes: ["Emaar security"] };
  assert.match(fitFor(tech("g", [{ trade: "ac", level: "competent", certificateExpires: null }]), clearance, free).blockers[0], /No access permission/);
  assert.equal(fitFor(tech("h", [{ trade: "ac", level: "competent", certificateExpires: null }], { accessPermissions: ["emaar security"] }), clearance, free).blockers.length, 0);
});

test("the suggested crew covers every trade, preferring one technician who covers several", () => {
  const twoTrades = { ...need, trades: ["ac" as const, "plumbing" as const] };
  const fits = [
    fitFor(tech("ac1", [{ trade: "ac", level: "expert", certificateExpires: null }]), twoTrades, free),
    fitFor(tech("pl1", [{ trade: "plumbing", level: "competent", certificateExpires: null }]), twoTrades, free),
    fitFor(tech("both", [{ trade: "ac", level: "competent", certificateExpires: null }, { trade: "plumbing", level: "competent", certificateExpires: null }]), twoTrades, free),
  ];
  assert.deepEqual(suggestCrew(fits, twoTrades.trades), { technicianIds: ["both"], uncovered: [] });
  assert.deepEqual(suggestCrew(fits.slice(0, 1), twoTrades.trades).uncovered, ["plumbing"]);
  assert.deepEqual(assignmentProblems(fits.slice(0, 1), twoTrades.trades), ["Nobody in the crew covers plumbing"]);
  const blocked = fitFor(tech("x", [{ trade: "ac", level: "competent", certificateExpires: null }]), need, { ...free, onLeave: true });
  assert.deepEqual(assignmentProblems([blocked], ["ac"]), ["X: on leave that day"], "blocked like leave");
});

test("double booking: time ranges overlap", () => {
  assert.equal(slotsOverlap({ start: "2026-11-10T05:00:00Z", end: "2026-11-10T07:00:00Z" }, { start: "2026-11-10T06:00:00Z", end: "2026-11-10T08:00:00Z" }), true);
  assert.equal(slotsOverlap({ start: "2026-11-10T05:00:00Z", end: "2026-11-10T06:00:00Z" }, { start: "2026-11-10T06:00:00Z", end: "2026-11-10T07:00:00Z" }), false, "back to back is fine");
});

test("confirmation: due N days before the window; attempts used up with no answer", () => {
  assert.equal(confirmationDue("2026-11-10", "2026-11-02", 7), false);
  assert.equal(confirmationDue("2026-11-10", "2026-11-03", 7), true);
  const rule = { attemptCount: 3, attemptIntervalDays: 2 };
  const at = (d: string) => `2026-11-0${d}T08:00:00.000Z`;
  const two = [{ outcome: "message_sent" as const, attemptedAt: at("1") }, { outcome: "no_answer" as const, attemptedAt: at("3") }];
  const s2 = attemptState(two, rule, new Date(at("4")));
  assert.deepEqual([s2.tried, s2.exhausted], [2, false]);
  assert.equal(s2.nextAllowedAt, at("5"), "two days after the last attempt");
  const three = attemptState([...two, { outcome: "no_answer", attemptedAt: at("5") }], rule, new Date(at("6")));
  assert.equal(three.exhausted, true);
  assert.equal(attemptState([...two, { outcome: "confirmed", attemptedAt: at("5") }], rule, new Date(at("6"))).exhausted, false);
});

test("access: pending where the property has rules; a pass that runs out has expired; alert when near", () => {
  assert.equal(defaultAccessStatus(2), "pending");
  assert.equal(defaultAccessStatus(0), "not_required");
  assert.equal(effectiveAccess("approved", "2026-11-05", "2026-11-10"), "expired");
  assert.equal(effectiveAccess("approved", "2026-11-30", "2026-11-10"), "approved");
  assert.equal(accessAlertDue("pending", "2026-11-10", "2026-11-07", 3), true);
  assert.equal(accessAlertDue("pending", "2026-11-10", "2026-11-06", 3), false);
  assert.equal(accessAlertDue("approved", "2026-11-10", "2026-11-09", 3), false);
});

test("what the routes accept", () => {
  const id = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";
  assert.equal(boardActionSchema.safeParse({ action: "place", visitId: id, date: "2026-11-10", startTime: "09:00", technicianIds: [] }).success, false, "a crew is needed");
  assert.equal(boardActionSchema.safeParse({ action: "place", visitId: id, date: "2026-11-10", startTime: "25:00", technicianIds: ["t1"] }).success, false);
  assert.equal(boardActionSchema.safeParse({ action: "move", visitIds: [id], date: "2026-11-12" }).success, true);
  assert.equal(
    technicianProfileSchema.safeParse({ areas: [], hasVehicle: true, isDriver: false, tools: [], accessPermissions: [], skills: [{ trade: "ac", level: "expert" }, { trade: "ac", level: "trainee" }] }).success,
    false,
    "one row per trade",
  );
});

test("migration: new AMC tables reference the roster but change no live scheduling table", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261008120000_amc_visit_assignment_and_confirmation.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.doesNotMatch(sql, /ALTER TABLE public\.(technician_reference|schedule_entries|schedule_entry_assignments|leave_records|lookup_options)/);
  assert.doesNotMatch(sql, /INSERT INTO public\.schedule_entries/);
  assert.match(sql, /REFERENCES public\.technician_reference\(fsm_resource_id\) ON DELETE RESTRICT/);
  for (const t of ["amc_technician_profiles", "amc_technician_skills", "amc_visit_attempts"]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`), `${t} revoked`);
  }
  assert.match(sql, /amc_visit_attempts_locked/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE|DROP TABLE|SECURITY DEFINER/);
  assert.doesNotMatch(sql, /amc_submissions/);
});
