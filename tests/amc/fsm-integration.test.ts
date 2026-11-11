import { test } from "node:test";
import assert from "node:assert/strict";

import { checkCoverage, coverageVerdict, type ContractEntitlement, type ContractForRules } from "@/lib/amc/contracts";
import {
  AMC_FSM_AUTOMATION,
  amcServiceForFsmService,
  automationSummary,
  checkFsmCustomer,
  checkFsmService,
  consumptionQuantity,
  isCompletedAppointment,
  mappingCoverage,
  parseActualDuration,
  planFsmUsage,
  slaForVisit,
  snapshotFromFsmRecord,
  type FsmAppointmentSnapshot,
  type FsmAutomationConfig,
  type FsmPlanInput,
  type FsmServiceMapping,
} from "@/lib/amc/fsm-sync";

const ent = (over: Partial<ContractEntitlement> & Pick<ContractEntitlement, "serviceId" | "entitlementType">): ContractEntitlement => ({
  serviceLabel: over.serviceId,
  callOutClass: null,
  units: 1,
  frequency: 1,
  includedQuantity: over.entitlementType === "visits" || over.entitlementType === "hours" ? 4 : null,
  usedQuantity: 0,
  basePrice: 100,
  contractedPrice: 100,
  ...over,
});

const contract = { status: "active" as const, startDate: "2026-10-01", endDate: "2027-10-01", fsmContactId: "C-1" };
const mappings: FsmServiceMapping[] = [
  { amcServiceId: "ac-ppm", fsmServiceId: "S-AC", active: true },
  { amcServiceId: "handyman", fsmServiceId: "S-HM", active: true },
  { amcServiceId: "emergency", fsmServiceId: "S-EM", active: true },
  { amcServiceId: "helpdesk", fsmServiceId: "S-HD", active: true },
  { amcServiceId: "old", fsmServiceId: "S-OLD", active: false },
];

const completed = (over: Partial<FsmAppointmentSnapshot> = {}): FsmAppointmentSnapshot => ({
  id: "AP-1",
  name: "AP1001",
  status: "Completed",
  workOrderId: "WO-1",
  workOrderName: "WO731",
  contactId: "C-1",
  scheduledStart: "2027-01-10T09:00:00+04:00",
  scheduledEnd: "2027-01-10T11:00:00+04:00",
  actualStart: "2027-01-10T09:10:00+04:00",
  actualEnd: "2027-01-10T11:40:00+04:00",
  actualDurationSeconds: 9000,
  cancelledOrTerminatedAt: null,
  lineItemIds: ["L-1"],
  ...over,
});

const visits = ent({ serviceId: "ac-ppm", entitlementType: "visits", includedQuantity: 4, usedQuantity: 1 });
const plan = (over: Partial<FsmPlanInput> = {}) =>
  planFsmUsage({
    snapshot: completed(),
    contract,
    entitlement: visits,
    linkFsmServiceId: "S-AC",
    mappings,
    existing: { usageId: null, netQuantity: 0 },
    ...over,
  });

const automationOn: FsmAutomationConfig = {
  ...AMC_FSM_AUTOMATION,
  autoConsume: { visits: true, hours: true, unlimited: true },
  autoReverse: true,
  hoursSource: "actual_duration",
};

/* ----------------------------- FSM records ------------------------------ */

test("FSM record: actual duration and snapshot fields as FSM returns them", () => {
  assert.equal(parseActualDuration({ unit: 13680, hours: "03:48:00" }), 13680);
  assert.equal(parseActualDuration({ hours: "02:32:42" }), 9162);
  assert.equal(parseActualDuration(null), null);
  assert.equal(parseActualDuration("3 hours"), null, "an unexpected shape is unknown, not guessed");
  const snap = snapshotFromFsmRecord({
    id: "AP-9",
    Name: "AP1043",
    Status: "Completed",
    Work_Order: { id: "WO-9", name: "WO731" },
    Contact: { id: "C-9", name: "Client" },
    Actual_Start_Date_Time: "2027-01-10T09:00:00+04:00",
    Actual_End_Date_Time: "2027-01-10T10:00:00+04:00",
    Actual_Duration: { unit: 3600, hours: "01:00:00" },
    Appointments_X_Services: [
      { Service_Line_Item: { id: "L-1" }, is_line_item_active: true },
      { Service_Line_Item: { id: "L-2" }, is_line_item_active: false },
    ],
  });
  assert.equal(snap.workOrderId, "WO-9");
  assert.equal(snap.contactId, "C-9");
  assert.equal(snap.actualDurationSeconds, 3600);
  assert.deepEqual(snap.lineItemIds, ["L-1"], "released lines are not counted");
});

test("completion: the configured status AND an actual end time", () => {
  assert.equal(isCompletedAppointment({ status: "Completed", actualEnd: "2027-01-10T10:00:00Z" }), true);
  assert.equal(isCompletedAppointment({ status: " completed ", actualEnd: "2027-01-10T10:00:00Z" }), true);
  assert.equal(isCompletedAppointment({ status: "Completed", actualEnd: null }), false, "status alone is not enough");
  assert.equal(isCompletedAppointment({ status: "Cannot Complete", actualEnd: "2027-01-10T10:00:00Z" }), false);
  assert.equal(isCompletedAppointment({ status: "Closed", actualEnd: "2027-01-10T10:00:00Z" }), false, "not seen in data, not assumed");
  assert.equal(automationSummary().any, false, "automatic usage is off by default");
});

/* --------------------------- customer mapping --------------------------- */

test("customer mapping: by FSM contact id only", () => {
  assert.equal(checkFsmCustomer("C-1", "C-1"), "match");
  assert.equal(checkFsmCustomer("C-1", "C-2"), "mismatch");
  assert.equal(checkFsmCustomer(null, "C-1"), "contract_unlinked");
  assert.equal(checkFsmCustomer("C-1", null), "appointment_without_contact");
  assert.equal(plan({ snapshot: completed({ contactId: "C-2" }) }).code, "customer_mismatch", "another customer's work is never consumed");
  const unlinked = plan({ contract: { ...contract, fsmContactId: null }, confirm: {}, config: automationOn });
  assert.equal(unlinked.action, "consume");
  assert.equal(unlinked.action === "consume" && unlinked.autoAllowed, false, "a missing customer link needs a person");
  assert.ok(unlinked.warnings.includes("customer_unverified"));
});

/* ---------------------------- service mapping --------------------------- */

test("service mapping: mapped, unmapped, inactive, mismatch", () => {
  assert.equal(amcServiceForFsmService("S-AC", mappings), "ac-ppm");
  assert.equal(amcServiceForFsmService("S-XX", mappings), null);
  assert.equal(amcServiceForFsmService("S-OLD", mappings), null, "inactive mappings do not match");
  assert.equal(checkFsmService("S-AC", "ac-ppm", mappings), "mapped");
  assert.equal(checkFsmService("S-HM", "ac-ppm", mappings), "mismatch");
  assert.equal(checkFsmService("S-XX", "ac-ppm", mappings), "unmapped");
  assert.equal(checkFsmService(null, "ac-ppm", mappings), "no_service");
  assert.deepEqual(
    mappingCoverage([visits, ent({ serviceId: "duct", entitlementType: "visits" }), ent({ serviceId: "helpdesk", entitlementType: "informational" })], mappings),
    { mapped: 1, total: 2, unmapped: ["duct"] },
    "informational services need no mapping",
  );
  assert.equal(plan({ linkFsmServiceId: "S-HM" }).code, "service_mismatch");
  const unmapped = plan({ linkFsmServiceId: "S-XX", config: automationOn });
  assert.equal(unmapped.action, "review", "an unmapped service is never automatic");
});

/* ------------------------------- coverage ------------------------------- */

test("coverage for FSM work: through the mapping into the coverage engine", () => {
  const c: ContractForRules = {
    id: "c1",
    status: "active",
    startDate: "2026-10-01",
    endDate: "2027-10-01",
    entitlements: [
      visits,
      ent({ serviceId: "emergency", entitlementType: "unlimited", callOutClass: "emergency", usedQuantity: 9 }),
      ent({ serviceId: "handyman", entitlementType: "hours", includedQuantity: 6, usedQuantity: 6 }),
    ],
  };
  const answer = (fsmService: string, date = "2027-01-10") => {
    const amc = amcServiceForFsmService(fsmService, mappings);
    return amc ? coverageVerdict(checkCoverage([c], { serviceId: amc, date }), amc).verdict : "unmapped";
  };
  assert.equal(answer("S-AC"), "covered_by_amc");
  assert.equal(answer("S-EM"), "covered_by_amc", "unlimited");
  assert.equal(answer("S-HM"), "chargeable", "exhausted");
  assert.equal(answer("S-AC", "2028-01-01"), "no_active_amc", "expired contract");
  assert.equal(coverageVerdict(checkCoverage([], { serviceId: "ac-ppm", date: "2027-01-10" }), "AC").verdict, "no_active_amc", "no AMC");
  assert.equal(answer("S-XX"), "unmapped");
});

/* --------------------------------- sync --------------------------------- */

test("sync: a completed appointment waits for review while automation is off", () => {
  const p = plan();
  assert.equal(p.action, "review");
  assert.equal(p.code, "automation_disabled");
  assert.equal(p.action === "review" && p.suggestedQuantity, 1);
  const confirmed = plan({ confirm: {} });
  assert.equal(confirmed.action, "consume");
  assert.equal(confirmed.action === "consume" && confirmed.quantity, 1);
  assert.equal(confirmed.action === "consume" && confirmed.occurredAt, "2027-01-10", "dated by FSM's actual end, in Dubai");
});

test("sync: automatic only when switched on and customer and service are verified", () => {
  const p = plan({ config: automationOn });
  assert.equal(p.action, "consume");
  assert.equal(p.action === "consume" && p.autoAllowed, true);
});

test("sync: duplicates and retries never consume twice", () => {
  const recorded = { usageId: "U-1", netQuantity: 1 };
  assert.equal(plan({ existing: recorded, config: automationOn }).code, "already_recorded", "duplicate event");
  assert.equal(plan({ existing: recorded, confirm: {} }).code, "already_recorded", "retry after success");
  /* The same input twice gives the same plan: nothing in it depends on time or attempts. */
  assert.deepEqual(plan({ config: automationOn }), plan({ config: automationOn }), "retry before success");
  assert.equal(
    plan({ existing: { usageId: "U-manual", netQuantity: 1 } }).code,
    "already_recorded",
    "usage already entered by hand with this appointment",
  );
});

test("sync: not completed, cannot complete, unlimited, informational", () => {
  assert.equal(plan({ snapshot: completed({ status: "Dispatched", actualEnd: null }) }).code, "not_completed");
  assert.equal(plan({ snapshot: completed({ status: "Cannot Complete" }) }).code, "not_completed");
  const unlimited = plan({
    entitlement: ent({ serviceId: "emergency", entitlementType: "unlimited", usedQuantity: 40 }),
    linkFsmServiceId: "S-EM",
    config: automationOn,
  });
  assert.equal(unlimited.action, "consume", "recorded for reporting");
  assert.equal(unlimited.action === "consume" && unlimited.quantity, 1);
  const info = plan({ entitlement: ent({ serviceId: "helpdesk", entitlementType: "informational" }), linkFsmServiceId: "S-HD", confirm: {} });
  assert.equal(info.code, "informational");
  assert.equal(info.action, "skip");
});

test("sync: the ledger's limits apply (exhausted, outside the period)", () => {
  const full = plan({ entitlement: { ...visits, usedQuantity: 4 }, confirm: {} });
  assert.equal(full.code, "usage_refused");
  const late = plan({ snapshot: completed({ actualEnd: "2027-10-02T10:00:00+04:00" }), confirm: {} });
  assert.equal(late.action === "skip" && late.reason, "That date is outside the contract period.");
});

/* -------------------------------- hours --------------------------------- */

test("hours: never from FSM unless a trustworthy source is configured", () => {
  const hours = ent({ serviceId: "handyman", entitlementType: "hours", includedQuantity: 6, usedQuantity: 1 });
  const missing = plan({ entitlement: hours, linkFsmServiceId: "S-HM" });
  assert.equal(missing.action, "review");
  assert.equal(missing.code, "hours_unavailable");
  assert.equal(missing.action === "review" && missing.suggestedQuantity, 2.5, "FSM's elapsed time, for reference");
  const entered = plan({ entitlement: hours, linkFsmServiceId: "S-HM", confirm: { quantity: 2 } });
  assert.equal(entered.action === "consume" && entered.quantity, 2, "a person enters the hours");
  const reliable = plan({ entitlement: hours, linkFsmServiceId: "S-HM", config: automationOn });
  assert.equal(reliable.action === "consume" && reliable.quantity, 2.5, "only with hoursSource configured");
  assert.deepEqual(consumptionQuantity("hours", { actualDurationSeconds: null }, automationOn).ok, false, "no duration, no hours");
});

/* ------------------------------- reversal ------------------------------- */

test("reversal: a compensating entry for the original, never twice", () => {
  const cancelled = completed({ status: "Cancelled", actualEnd: null });
  const p = plan({ snapshot: cancelled, existing: { usageId: "U-1", netQuantity: 1 } });
  assert.equal(p.action, "reverse");
  assert.equal(p.action === "reverse" && p.correctsUsageId, "U-1", "references the original");
  assert.equal(p.action === "reverse" && p.quantity, 1);
  assert.equal(p.action === "reverse" && p.autoAllowed, false, "manual until reopening is confirmed");
  assert.equal(plan({ snapshot: cancelled, existing: { usageId: "U-1", netQuantity: 0 } }).code, "already_reversed", "duplicate reversal prevented");
  assert.equal(plan({ snapshot: cancelled }).code, "not_completed", "nothing recorded, nothing to reverse");
});

/* --------------------------------- SLA ---------------------------------- */

test("SLA: unknown unless the request and the measured time both exist", () => {
  const req = "2027-01-10T08:00:00+04:00";
  const mapped = { mapping: { arrivedAt: "actual_start" as const, scheduledAt: null } };
  const met = slaForVisit("emergency", { requestedAt: req, snapshot: { actualStart: "2027-01-10T09:34:00+04:00" }, completed: true }, mapped);
  assert.equal(met.state, "met");
  assert.equal(met.actualMinutes, 94);
  const breached = slaForVisit("emergency", { requestedAt: req, snapshot: { actualStart: "2027-01-10T10:30:00+04:00" }, completed: true }, mapped);
  assert.equal(breached.state, "breached");
  const pending = slaForVisit(
    "emergency",
    { requestedAt: req, snapshot: { actualStart: null }, completed: false },
    { ...mapped, now: new Date("2027-01-10T04:30:00Z") },
  );
  assert.equal(pending.state, "pending");
  assert.equal(
    slaForVisit("emergency", { requestedAt: req, snapshot: { actualStart: null }, completed: true }, mapped).state,
    "unknown",
    "a finished visit with no attendance time is unknown, not breached",
  );
  const unmapped = slaForVisit("emergency", { requestedAt: req, snapshot: { actualStart: "2027-01-10T09:34:00+04:00" }, completed: true });
  assert.equal(unmapped.state, "unknown", "attendance is not mapped to an FSM field by default");
  assert.ok(unmapped.missing);
  assert.equal(slaForVisit("non_emergency", { requestedAt: req, snapshot: null, completed: true }).state, "unknown", "FSM has no booking time");
  assert.equal(slaForVisit("emergency", { requestedAt: null, snapshot: null, completed: true }).state, "unknown", "no request time");
});
