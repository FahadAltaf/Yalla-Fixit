import { test } from "node:test";
import assert from "node:assert/strict";

import { callOutActionSchema, callOutCreateSchema } from "@/lib/amc/call-outs";
import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { formatMinutes, handymanEntitlement, minutesOnSite, splitHandymanHours, suggestedTeamHours, teamsFromCrew } from "@/lib/amc/handyman-hours";
import { previewCoverage, type CallOutContract } from "@/lib/server/amc/call-outs";

/* DEV-495 (confirmed 24 Nov 2026): free handyman hours, counted in team-hours. */

test("team-hours: time on site times the teams, to the nearest whole hour", () => {
  assert.equal(suggestedTeamHours(60, 2), 2, "two teams for one hour count as two hours");
  assert.equal(suggestedTeamHours(80, 2), 3, "1 h 20 min x 2 = 2 h 40 min, so 3");
  assert.equal(suggestedTeamHours(80, 1), 1, "1 h 20 min, so 1");
  assert.equal(suggestedTeamHours(90, 1), 2, "half an hour rounds up");
  assert.equal(suggestedTeamHours(20, 1), 1, "a short job counts 1 hour");
  assert.equal(suggestedTeamHours(null, 2), null, "no time on the job sheet, no suggestion");
});

test("minutes on site come from the job sheet's arrived and completed times", () => {
  assert.equal(minutesOnSite("2026-11-24T08:00:00Z", "2026-11-24T09:20:00Z"), 80);
  assert.equal(minutesOnSite("2026-11-24T09:00:00Z", "2026-11-24T08:00:00Z"), null, "out of order");
  assert.equal(minutesOnSite(null, "2026-11-24T08:00:00Z"), null);
  assert.equal(formatMinutes(80), "1 h 20 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(45), "45 min");
});

test("hours beyond what is left are chargeable", () => {
  assert.deepEqual(splitHandymanHours(3, 10), { covered: 3, chargeable: 0 });
  assert.deepEqual(splitHandymanHours(3, 2), { covered: 2, chargeable: 1 });
  assert.deepEqual(splitHandymanHours(3, 0), { covered: 0, chargeable: 3 });
  assert.deepEqual(splitHandymanHours(3, null), { covered: 3, chargeable: 0 }, "an uncounted allowance covers it all");
});

test("the contract's handyman allowance is its hours entitlement", () => {
  const ents = [
    { entitlementType: "visits", serviceId: "ac-ppm", serviceLabel: "AC PPM" },
    { entitlementType: "hours", serviceId: "carpentry", serviceLabel: "Carpentry hours" },
    { entitlementType: "hours", serviceId: "handyman", serviceLabel: "Handyman" },
  ];
  assert.equal(handymanEntitlement(ents)?.serviceId, "handyman");
  assert.equal(handymanEntitlement(ents.slice(0, 2))?.serviceId, "carpentry");
  assert.equal(handymanEntitlement(ents.slice(0, 1)), null);
});

test("teams are whole, 1 to 10; hours used are whole hours", () => {
  const base = { contractId: "6f1c2a52-3b0e-4d7a-9c1e-2f4b5a6c7d8e", priority: "non_emergency", channel: "call", reportedAt: "2026-11-24T08:00:00Z", issue: "Door hinge loose" };
  assert.equal(callOutCreateSchema.safeParse({ ...base, handymanTeams: 2 }).success, true);
  assert.equal(callOutCreateSchema.safeParse({ ...base, handymanTeams: 0 }).success, false);
  assert.equal(callOutCreateSchema.safeParse({ ...base, handymanTeams: 1.5 }).success, false);
  assert.equal(callOutActionSchema.safeParse({ action: "close", note: null, hoursUsed: 3 }).success, true);
  assert.equal(callOutActionSchema.safeParse({ action: "close", note: null, hoursUsed: 2.5 }).success, false, "rounded to a whole hour");
  assert.equal(callOutActionSchema.safeParse({ action: "close", note: null, hoursUsed: 0 }).success, false, "a job counts at least 1 hour");
});

const contract: CallOutContract = {
  id: "c1",
  status: "active",
  startDate: "2026-01-01",
  endDate: "2027-12-31",
  number: "AMC-C-2026-0009",
  customerName: "Client",
  propertyLabel: "Villa 7",
  customer: {},
  property: {},
  ownerId: null,
  submissionId: null,
  entitlements: [
    { id: "e-call", serviceId: "non-emergency", serviceLabel: "Non emergency call out", entitlementType: "visits", callOutClass: "non_emergency", includedQuantity: 4, usedQuantity: 0, reservedQuantity: 0, labourCovered: true, materialCoverage: "consumables", valueLimitAed: null, exclusions: null },
    { id: "e-hours", serviceId: "handyman", serviceLabel: "Handyman", entitlementType: "hours", callOutClass: null, includedQuantity: 12, usedQuantity: 10, reservedQuantity: 0, labourCovered: true, materialCoverage: "consumables", valueLimitAed: null, exclusions: null },
  ],
} as CallOutContract;

test("booking a handyman job draws on the free hours and shows what is left", () => {
  const input = { priority: "non_emergency" as const, partsExpected: false, partsValueAed: null, excluded: false, reportedAt: "2026-11-24T08:00:00Z" };
  const plain = previewCoverage(contract, input, AMC_CONFIG_DEFAULTS);
  assert.equal(plain.entitlementId, "e-call");
  assert.deepEqual(plain.handymanBalance && { left: plain.handymanBalance.remaining, of: plain.handymanBalance.included }, { left: 2, of: 12 }, "shown even on an ordinary call out");

  const job = previewCoverage(contract, { ...input, handymanTeams: 2 }, AMC_CONFIG_DEFAULTS);
  assert.equal(job.entitlementId, "e-hours");
  assert.equal(job.coverage, "covered");
  assert.equal(job.reserves, false, "nothing held: the hours used come off at closing");
  assert.match(job.reasons[0], /2 of 12 hours left/);

  const used = { ...contract, entitlements: contract.entitlements.map((e) => (e.id === "e-hours" ? { ...e, usedQuantity: 12 } : e)) };
  assert.equal(previewCoverage(used, { ...input, handymanTeams: 1 }, AMC_CONFIG_DEFAULTS).coverage, "chargeable", "no hours left");
});

test("teams are the crew's technicians, each with a helper (24 Nov 2026)", () => {
  assert.deepEqual(teamsFromCrew(["t1", "t2"]), { teams: 2, fromCrew: true });
  assert.deepEqual(teamsFromCrew([], 1), { teams: 1, fromCrew: false }, "no crew yet: one team assumed");
  assert.deepEqual(teamsFromCrew(null), { teams: 1, fromCrew: false });
  assert.equal(suggestedTeamHours(80, teamsFromCrew(["t1", "t2"]).teams), 3, "two technicians for 1 h 20 min: 3 team-hours");
});
