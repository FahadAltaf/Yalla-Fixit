import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  amendmentActionSchema,
  amendmentProblem,
  amendmentRequestSchema,
  canDecide,
  proRataRefund,
  terminationEffective,
} from "@/lib/amc/amendments";
import { buildRenewalDraft } from "@/lib/amc/renewal";
import {
  escalate,
  expiryNotice,
  renewalOutcomeSchema,
  renewalStage,
  renewedOutcome,
  type RenewalFacts,
} from "@/lib/amc/renewal-outcomes";
import { RESOURCE_PARENT } from "@/components/dashboard/permissions/constants";
import { ResourceType } from "@/types/types";

/* Phase 13 of the BRD v0.3 plan: renewals, outcomes, amendments and termination (DEV-415, 416, 417, to-do 7). */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const TODAY = "2026-11-15";
const RULES = { leadDays: 30, idleEscalationDays: 15 };
const facts = (more: Partial<RenewalFacts> = {}): RenewalFacts => ({
  status: "active",
  endDate: "2026-12-05",
  renewedByContractId: null,
  outcome: null,
  remindedAt: null,
  activityAt: null,
  ...more,
});

test("the renewal stage: due inside the lead time, idle after the idle days, overdue once ended, settled when final", () => {
  assert.equal(renewalStage(facts({ endDate: "2027-02-01" }), TODAY, RULES), "not_due");
  assert.equal(renewalStage(facts(), TODAY, RULES), "due");
  assert.equal(renewalStage(facts({ remindedAt: "2026-10-25T05:00:00Z" }), TODAY, RULES), "idle", "reminded 21 days ago, nothing since");
  assert.equal(renewalStage(facts({ remindedAt: "2026-10-25T05:00:00Z", activityAt: "2026-11-10T05:00:00Z" }), TODAY, RULES), "due", "activity resets the clock");
  assert.equal(renewalStage(facts({ endDate: "2026-11-10" }), TODAY, RULES), "overdue");
  assert.equal(renewalStage(facts({ renewedByContractId: "x" }), TODAY, RULES), "settled");
  assert.equal(renewalStage(facts({ outcome: "not_renewed" }), TODAY, RULES), "settled");
  assert.equal(renewalStage(facts({ outcome: "under_negotiation" }), TODAY, RULES), "due", "negotiation is not an end");
  assert.equal(renewalStage(facts({ status: "cancelled" }), TODAY, RULES), "settled");
});

test("expiry notices at 60 and 30 days; the escalation on the price", () => {
  assert.equal(expiryNotice(TODAY, "2027-01-10"), 60);
  assert.equal(expiryNotice(TODAY, "2026-12-05"), 30);
  assert.equal(expiryNotice(TODAY, "2027-03-01"), null);
  assert.equal(expiryNotice(TODAY, "2026-11-01"), null, "already ended");
  assert.equal(escalate(3150, 5), 3307.5);
  assert.equal(escalate(3150, 0), 3150);
});

test("the renewal draft carries the escalation on last year's base prices", () => {
  const source = {
    id: "c1",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    customer: { customerName: "Sara" },
    property: { unitType: "villa" },
    accountManagers: [],
    discountPercent: 0,
    entitlements: [
      { serviceId: "ac-ppm", serviceLabel: "AC PPM", entitlementType: "visits" as const, callOutClass: null, units: 2, frequency: 4, includedQuantity: 4, usedQuantity: 4, basePrice: 200, contractedPrice: 1600 },
      { serviceId: "helpdesk", serviceLabel: "Helpdesk", entitlementType: "informational" as const, callOutClass: null, units: 1, frequency: 1, includedQuantity: null, usedQuantity: 0, basePrice: null, contractedPrice: 0 },
    ],
  };
  const draft = buildRenewalDraft(source, ["ac-ppm", "helpdesk"], 5);
  assert.equal(draft.services.find((s) => s.serviceId === "ac-ppm")!.basePrice, 210);
  assert.equal(draft.services.find((s) => s.serviceId === "helpdesk")!.basePrice, null);
  assert.equal(buildRenewalDraft(source, ["ac-ppm"]).services[0].basePrice, 200, "no escalation by default");
  assert.equal(draft.customer.startDate, "2027-01-01");
});

test("outcomes: renewed or renewed with revised scope from the new contract; not renewed needs a reason", () => {
  const old = [{ serviceId: "ac-ppm", units: 2, frequency: 4 }];
  assert.equal(renewedOutcome(old, [{ serviceId: "ac-ppm", units: 2, frequency: 4 }]), "renewed");
  assert.equal(renewedOutcome(old, [{ serviceId: "ac-ppm", units: 2, frequency: 6 }]), "renewed_revised_scope");
  assert.equal(renewedOutcome(old, [...old, { serviceId: "water-tank", units: 1, frequency: 2 }]), "renewed_revised_scope");
  assert.equal(renewalOutcomeSchema.safeParse({ outcome: "not_renewed" }).success, false);
  assert.equal(renewalOutcomeSchema.safeParse({ outcome: "not_renewed", reason: "Moved out" }).success, true);
  assert.equal(renewalOutcomeSchema.safeParse({ outcome: "renewed" }).success, false, "renewed is set by the system");
});

test("amendments: allowed only from the right contract status; nobody approves their own", () => {
  assert.equal(amendmentProblem("hold", "active"), null);
  assert.match(amendmentProblem("hold", "on_hold")!, /cannot be asked for/);
  assert.equal(amendmentProblem("resume", "on_hold"), null);
  assert.match(amendmentProblem("cancellation", "active")!, /cannot/, "a running contract is terminated, not cancelled");
  assert.equal(amendmentProblem("cancellation", "signed"), null);
  assert.equal(amendmentProblem("early_termination", "active"), null);
  assert.equal(canDecide("u1", "u1"), false);
  assert.equal(canDecide("u1", "u2"), true);
});

test("early termination: 30 days' notice, a pro-rata refund only with a valid reason", () => {
  assert.equal(terminationEffective("2026-11-15", null), "2026-12-15");
  assert.equal(terminationEffective("2026-11-15", "2026-12-01"), "2026-12-15", "never earlier than the notice allows");
  assert.equal(terminationEffective("2026-11-15", "2027-01-31"), "2027-01-31");
  const year = { grandTotal: 3650, startDate: "2026-01-01", endDate: "2026-12-31", effectiveOn: "2026-07-01" };
  const valid = proRataRefund({ ...year, received: 3650, validReason: true });
  assert.equal(valid.totalDays, 365);
  assert.equal(valid.servedDays, 181);
  assert.equal(valid.earned, 1810);
  assert.equal(valid.refund, 1840);
  assert.equal(proRataRefund({ ...year, received: 3650, validReason: false }).refund, 0, "no valid reason, no refund");
  assert.equal(proRataRefund({ ...year, received: 1000, validReason: true }).refund, 0, "never negative: paid less than served");
});

test("what the amendment routes accept", () => {
  assert.equal(amendmentRequestSchema.safeParse({ kind: "hold", reason: "Owner abroad", effectiveOn: "2026-12-01" }).success, true);
  assert.equal(amendmentRequestSchema.safeParse({ kind: "hold", reason: "", effectiveOn: "2026-12-01" }).success, false, "a reason");
  assert.equal(
    amendmentRequestSchema.safeParse({ kind: "transfer", reason: "Sold", effectiveOn: "2026-12-01", to: { customerName: "New owner", role: "owner" } }).success,
    true,
  );
  assert.equal(amendmentRequestSchema.safeParse({ kind: "scope_change", reason: "More units", mode: "extend", effectiveOn: "2026-12-01" }).success, false);
  assert.equal(amendmentActionSchema.safeParse({ action: "reject", comment: "" }).success, false, "a rejection says why");
  assert.equal(amendmentActionSchema.safeParse({ action: "approve", validReason: true }).success, true);
});

test("the migration is additive; the renewals page has its own permission; the sweep runs daily", () => {
  const sql = read("supabase/migrations/20261012140000_amc_renewal_outcomes_and_amendments.sql")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.match(sql, /amc_contracts_not_renewed_reason/);
  assert.match(sql, /amc_amendments_not_self_decided CHECK \(decided_by IS NULL OR requested_by IS NULL OR decided_by <> requested_by\)/);
  assert.match(sql, /ALTER TABLE public\.amc_contract_amendments ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /on conflict \(role_id, resource, action\) do nothing/);
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDROP COLUMN\b|\bDELETE FROM\b|update public\.role_access/i);
  assert.equal(RESOURCE_PARENT[ResourceType.AMC_RENEWALS], ResourceType.AMC);
  assert.match(read("app/api/amc-renewals/route.ts"), /gate\.can\(ResourceType\.AMC_RENEWALS, ActionType\.VIEW\)/);
  assert.match(read("lib/server/amc/jobs.ts"), /key: "renewals"/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/renewals/page.tsx"), /canSeeAmcPage\(ResourceType\.AMC_RENEWALS\)/);
});
