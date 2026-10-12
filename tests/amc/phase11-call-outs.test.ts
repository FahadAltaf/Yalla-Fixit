import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  additionalWorkActionSchema,
  additionalWorkCreateSchema,
  allowanceBalance,
  callOutActionSchema,
  callOutCreateSchema,
  canMoveCallOut,
  canMoveWork,
  checkCallOutCoverage,
  loggedInTime,
  nearZero,
  needsAdditionalWork,
  quotationTotals,
  slaDeadlines,
  slaState,
  type CoverageInput,
} from "@/lib/amc/call-outs";
import { fitFor } from "@/lib/amc/visits";
import { ResourceType } from "@/types/types";
import { RESOURCE_PARENT } from "@/components/dashboard/permissions/constants";

/* Phase 11 of the BRD v0.3 plan: call outs, additional works, allowances (DEV-355, 405-409, to-do 8). */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const sql = read("supabase/migrations/20261012120000_amc_call_outs_additional_work_allowances.sql")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");
const SLA = { emergencyLogMinutes: 60, emergencyAttendMinutes: 120, nonEmergencyScheduleHours: 48, minorFixHours: 2, atRiskPercent: 75 };

const entitlement = (more: Partial<NonNullable<CoverageInput["entitlement"]>> = {}): NonNullable<CoverageInput["entitlement"]> => ({
  serviceLabel: "Non-emergency call out",
  entitlementType: "visits",
  includedQuantity: 4,
  usedQuantity: 1,
  reservedQuantity: 1,
  labourCovered: true,
  materialCoverage: "consumables",
  valueLimitAed: null,
  exclusions: "Glass breakage",
  ...more,
});
const input = (more: Partial<CoverageInput> = {}): CoverageInput => ({
  contractInForce: true,
  entitlement: entitlement(),
  quantity: 1,
  partsExpected: false,
  partsValueAed: null,
  excluded: false,
  ...more,
});

test("the balance counts what is booked as well as what is used", () => {
  assert.deepEqual(allowanceBalance(entitlement()), { unlimited: false, included: 4, used: 1, reserved: 1, remaining: 2 });
  assert.equal(allowanceBalance(entitlement({ entitlementType: "unlimited", includedQuantity: null })).remaining, null);
  assert.equal(nearZero(allowanceBalance(entitlement({ usedQuantity: 2 })), 1), true, "one left warns");
  assert.equal(nearZero(allowanceBalance(entitlement()), 1), false);
});

test("covered: in force, on the contract, a unit left; the booking reserves it", () => {
  const a = checkCallOutCoverage(input());
  assert.equal(a.coverage, "covered");
  assert.equal(a.reserves, true);
  assert.match(a.reasons[0], /2 of 4 left/);
  const unlimited = checkCallOutCoverage(input({ entitlement: entitlement({ entitlementType: "unlimited", includedQuantity: null }) }));
  assert.equal(unlimited.coverage, "covered");
  assert.equal(unlimited.reserves, false, "an unlimited allowance has nothing to hold");
});

test("chargeable, and why: no contract, not included, used up, labour, exclusions", () => {
  assert.match(checkCallOutCoverage(input({ contractInForce: false })).reasons[0], /No AMC is in force/);
  assert.match(checkCallOutCoverage(input({ entitlement: null })).reasons[0], /does not include/);
  const usedUp = checkCallOutCoverage(input({ entitlement: entitlement({ usedQuantity: 3 }) }));
  assert.equal(usedUp.coverage, "chargeable");
  assert.match(usedUp.reasons[1], /used up \(3 used, 1 booked, 4 included\)/, "a booked unit counts against the allowance");
  assert.match(checkCallOutCoverage(input({ entitlement: entitlement({ labourCovered: false }) })).reasons.join(" "), /Labour is not covered/);
  assert.match(checkCallOutCoverage(input({ excluded: true })).reasons.join(" "), /Excluded by the contract: Glass breakage/);
  assert.equal(checkCallOutCoverage(input({ excluded: true })).reserves, false, "a chargeable booking holds nothing");
});

test("materials: covered visit, chargeable parts beyond the contract's coverage", () => {
  assert.deepEqual(checkCallOutCoverage(input({ partsExpected: true })).chargeableExtras, ["Parts are chargeable (the contract covers consumables only)."]);
  const limit = entitlement({ materialCoverage: "parts_within_limit", valueLimitAed: 300 });
  assert.deepEqual(checkCallOutCoverage(input({ entitlement: limit, partsExpected: true, partsValueAed: 200 })).chargeableExtras, []);
  assert.match(checkCallOutCoverage(input({ entitlement: limit, partsExpected: true, partsValueAed: 450 })).chargeableExtras[0], /above AED 300/);
  assert.equal(checkCallOutCoverage(input({ entitlement: entitlement({ materialCoverage: "all" }), partsExpected: true })).chargeableExtras.length, 0);
  assert.equal(checkCallOutCoverage(input({ partsExpected: true })).coverage, "covered", "the visit itself stays covered");
});

test("the SLA: emergency attended within 120 minutes, non emergency within 48 hours; at risk at 75%", () => {
  const e = slaDeadlines("emergency", "2026-11-10T20:00:00.000Z", SLA);
  assert.deepEqual(e, { attendDueAt: "2026-11-10T22:00:00.000Z", scheduleDueAt: null });
  const n = slaDeadlines("non_emergency", "2026-11-10T08:00:00.000Z", SLA);
  assert.deepEqual(n, { attendDueAt: null, scheduleDueAt: "2026-11-12T08:00:00.000Z" });
  const base = { reportedAt: "2026-11-10T20:00:00.000Z", attendedAt: null, ...e, status: "logged" as const };
  assert.equal(slaState(base, new Date("2026-11-10T21:00:00Z"), 75), "on_track");
  assert.equal(slaState(base, new Date("2026-11-10T21:31:00Z"), 75), "at_risk");
  assert.equal(slaState(base, new Date("2026-11-10T22:01:00Z"), 75), "missed");
  assert.equal(slaState({ ...base, attendedAt: "2026-11-10T21:50:00Z" }, new Date("2026-11-11T00:00:00Z"), 75), "met");
  assert.equal(slaState({ ...base, attendedAt: "2026-11-10T22:10:00Z" }, new Date(), 75), "missed");
  assert.equal(slaState({ ...base, status: "cancelled" }, new Date(), 75), null);
  assert.equal(loggedInTime("emergency", "2026-11-10T20:00:00Z", "2026-11-10T20:45:00Z", 60), true);
  assert.equal(loggedInTime("emergency", "2026-11-10T20:00:00Z", "2026-11-10T21:30:00Z", 60), false);
  assert.equal(loggedInTime("non_emergency", "2026-11-10T20:00:00Z", "2026-11-10T21:30:00Z", 60), null);
});

test("statuses: Logged, Scheduled, Attended, Resolved, Pending Works, Quoted, Closed", () => {
  assert.equal(canMoveCallOut("logged", "attended"), true, "an emergency crew goes at once");
  assert.equal(canMoveCallOut("logged", "closed"), false);
  assert.equal(canMoveCallOut("attended", "pending_works"), true);
  assert.equal(canMoveCallOut("pending_works", "quoted"), true);
  assert.equal(canMoveCallOut("quoted", "closed"), true, "declined additional work lets it close");
  assert.equal(canMoveCallOut("attended", "cancelled"), false, "attended work is not cancelled");
  assert.equal(canMoveCallOut("closed", "logged"), false);
  assert.equal(needsAdditionalWork({ priority: "non_emergency", minutesOnSite: 150, partsNeeded: false }, 2), true, "more than 2 hours");
  assert.equal(needsAdditionalWork({ priority: "non_emergency", minutesOnSite: 90, partsNeeded: false }, 2), false);
  assert.equal(needsAdditionalWork({ priority: "emergency", minutesOnSite: 30, partsNeeded: true }, 2), true, "parts");
});

test("a call out with no trade can still be crewed by any free technician; a named trade still needs competence", () => {
  const tech = { fsmId: "T1", name: "Ravi", active: true, shift: "morning", skills: [], areas: [], hasVehicle: true, isDriver: false, accessPermissions: [] };
  const free = { onLeave: false, overlaps: 0, workloadMinutes: 0 };
  assert.deepEqual(fitFor(tech, { trades: [], date: "2026-11-10", area: null, accessTypes: [] }, free).blockers, []);
  assert.deepEqual(fitFor(tech, { trades: ["ac"], date: "2026-11-10", area: null, accessTypes: [] }, free).blockers, ["Not confirmed for this trade"]);
  assert.ok(fitFor(tech, { trades: [], date: "2026-11-10", area: null, accessTypes: [] }, { ...free, overlaps: 1 }).blockers.includes("Already booked at that time"));
});

test("additional work: nine statuses, approval with evidence, the 20% material fee", () => {
  assert.equal(canMoveWork("identified", "quotation_prepared"), true);
  assert.equal(canMoveWork("identified", "approved"), false, "never approved without a shared quotation");
  assert.equal(canMoveWork("shared", "approved"), true);
  assert.equal(canMoveWork("approved", "invoiced"), false, "invoiced after completion");
  assert.equal(canMoveWork("completed", "invoiced"), true);
  assert.equal(canMoveWork("invoiced", "paid"), true);
  assert.equal(canMoveWork("paid", "identified"), false);
  const t = quotationTotals(
    [
      { description: "Labour", kind: "labour", quantity: 2, unitPrice: 150 },
      { description: "Valve", kind: "material", quantity: 1, unitPrice: 85.5 },
    ],
    20,
  );
  assert.deepEqual(t, { labourTotal: 300, materialTotal: 85.5, materialFee: 17.1, subtotal: 402.6, vatAmount: 20.13, total: 422.73 });
  assert.equal(additionalWorkActionSchema.safeParse({ action: "approve", evidence: "" }).success, false, "approved with evidence");
  assert.equal(additionalWorkActionSchema.safeParse({ action: "approve", evidence: "Signed quotation by email" }).success, true);
  assert.equal(additionalWorkCreateSchema.safeParse({ contractId: "6f0f7d8e-3c2a-4b1e-9c11-0a1b2c3d4e5f", source: "call_out", finding: "Leaking valve" }).success, false, "a call out source names the call out");
});

test("what the call out routes accept", () => {
  const ok = callOutCreateSchema.safeParse({
    contractId: "6f0f7d8e-3c2a-4b1e-9c11-0a1b2c3d4e5f",
    priority: "emergency",
    channel: "whatsapp",
    reportedAt: "2026-11-10T23:10:00+04:00",
    issue: "No power in the villa",
    trade: "electrical",
  });
  assert.equal(ok.success, true);
  assert.equal(callOutCreateSchema.safeParse({ ...ok.data, priority: "urgent" }).success, false);
  assert.equal(callOutActionSchema.safeParse({ action: "cancel", reason: "" }).success, false, "a cancellation says why");
  assert.equal(callOutActionSchema.safeParse({ action: "flag_misuse", note: "Not an emergency" }).success, true);
  assert.equal(callOutActionSchema.safeParse({ action: "schedule", date: "2026-11-11", time: "09:00", durationMinutes: 120, technicianIds: [] }).success, false, "a crew");
});

test("the migration: reservations on the ledger, guarded; the old trigger rules kept; additive", () => {
  assert.match(sql, /CHECK \(kind IN \('consumption', 'adjustment', 'correction', 'reserve', 'release'\)\)/);
  assert.match(sql, /used_quantity \+ reserved_quantity <= included_quantity/);
  assert.match(sql, /idx_amc_usage_reservation_settled/, "a reservation is settled once");
  assert.match(sql, /A correction cannot take back more than the entry recorded/, "the correction guard of 20261006110000 survives");
  for (const table of ["amc_call_outs", "amc_additional_works", "amc_work_photos"]) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), table);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`), table);
  }
  assert.doesNotMatch(sql, /amc_submissions\b(?!_)/i, "the live submissions table is not touched (only joined in code)");
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDROP COLUMN\b|\bDELETE FROM\b|\bupdate public\.role_access\b/i);
  assert.match(sql, /on conflict \(role_id, resource, action\) do nothing/);
});

test("the two pages have their own permission, grouped under AMC; the sweep runs", () => {
  assert.equal(ResourceType.AMC_CALL_OUTS, "amc_call_outs");
  assert.equal(ResourceType.AMC_ADDITIONAL_WORKS, "amc_additional_works");
  assert.equal(RESOURCE_PARENT[ResourceType.AMC_CALL_OUTS], ResourceType.AMC);
  assert.equal(RESOURCE_PARENT[ResourceType.AMC_ADDITIONAL_WORKS], ResourceType.AMC);
  const access = read("lib/server/amc/field-work-access.ts");
  assert.match(access, /gate\.can\(r, ActionType\.CREATE\) \|\| operates/);
  assert.match(access, /override: Boolean\(gate\.actor\.allowanceOverride\)/, "booking chargeable as covered is AMC Allowances (Approve)");
  assert.match(read("lib/server/amc/jobs.ts"), /key: "call_outs"/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/call-outs/page.tsx"), /canSeeAmcPage\(ResourceType\.AMC_CALL_OUTS\)/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/additional-works/page.tsx"), /canSeeAmcPage\(ResourceType\.AMC_ADDITIONAL_WORKS\)/);
});
