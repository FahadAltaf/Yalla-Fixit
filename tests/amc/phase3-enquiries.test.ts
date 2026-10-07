import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { canReadAssessment, type AmcActor } from "@/lib/amc/access";
import { checkAssessmentCompletion, proposalPrefillFromAssessment } from "@/lib/amc/business";
import { AMC_CONFIG_DEFAULTS, validateAmcConfigSection } from "@/lib/amc/config";
import {
  ENQUIRY_STAGE,
  checkStageChange,
  cleanAssetCounts,
  createEnquirySchema,
  dubaiDayBounds,
  enquiryRequiredErrors,
  followUpSchema,
  followUpState,
  idleState,
  siteVisitRequired,
  stageAfterSiteVisitBooked,
} from "@/lib/amc/enquiries";

/* Phase 3 of the BRD v0.3 plan: enquiry pipeline and site visit (DEV-347, 358, 359, 362). */

const config = structuredClone(AMC_CONFIG_DEFAULTS);
const CUSTOMER = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";
const base = { source: "Website", contactName: "Sara", contactPhone: "0501234567", need: "AC maintenance for a villa", customerId: CUSTOMER };

test("logging an enquiry: a client, a way to reach them, the need, and who referred them", () => {
  assert.equal(createEnquirySchema.safeParse(base).success, true);
  assert.equal(createEnquirySchema.safeParse({ ...base, customerId: null }).success, false, "no client and no new prospect");
  assert.equal(createEnquirySchema.safeParse({ ...base, customerId: null, newCustomer: { name: "Al Noor LLC", customerType: "company" } }).success, true);
  assert.equal(createEnquirySchema.safeParse({ ...base, contactPhone: null }).success, false, "no phone, WhatsApp or email");
  assert.equal(createEnquirySchema.safeParse({ ...base, contactPhone: null, contactEmail: "sara@example.com" }).success, true);
  assert.equal(createEnquirySchema.safeParse({ ...base, source: "Referral" }).success, false, "a referral names the referrer");
  assert.equal(createEnquirySchema.safeParse({ ...base, source: "Referral", referrer: "Omar (client)" }).success, true);
  assert.equal(createEnquirySchema.safeParse({ ...base, need: "AC" }).success, false);
  assert.deepEqual(enquiryRequiredErrors({ source: "Website", contactName: "Sara", need: "x" }), ["Give a phone, WhatsApp or email for the contact."]);
});

test("stages: only configured ones; Lost needs a listed reason; reopening needs a reason", () => {
  const check = (from: string, to: string, extra: Partial<Parameters<typeof checkStageChange>[0]> = {}) =>
    checkStageChange({ config, from, to, propertyCategory: "residential", hasCompletedSiteVisit: false, ...extra });
  assert.equal(check("New Enquiry", "Contacted").ok, true);
  assert.equal(check("New Enquiry", "Signed").ok, false, "not a configured stage");
  assert.equal(check("Contacted", "Contacted").ok, false);
  assert.equal(check("Contacted", "Lost").ok, false, "Lost without a reason");
  assert.equal(check("Contacted", "Lost", { lostReason: "Weather" }).ok, false, "a reason not in the list");
  assert.equal(check("Contacted", "Lost", { lostReason: "Price" }).ok, true);
  assert.equal(check("Lost", "Contacted").ok, false, "reopening without a reason");
  assert.equal(check("Lost", "Contacted", { reason: "Client called back" }).ok, true);
});

test("site visit rule: commercial needs a completed visit before a proposal, flagged by default, blocked when configured", () => {
  const commercial = { config, from: "Details Captured", propertyCategory: "commercial", hasCompletedSiteVisit: false };
  const flagged = checkStageChange({ ...commercial, to: "Proposal Preparation" });
  assert.equal(flagged.ok, true);
  assert.match(flagged.ok ? (flagged.warning ?? "") : "", /site visit is required/);
  assert.deepEqual(checkStageChange({ ...commercial, to: "Site Visit Scheduled" }), { ok: true, warning: null }, "before the proposal stages");
  assert.deepEqual(checkStageChange({ ...commercial, to: "On Hold" }), { ok: true, warning: null });
  assert.deepEqual(checkStageChange({ ...commercial, to: "Proposal Preparation", hasCompletedSiteVisit: true }), { ok: true, warning: null });
  assert.deepEqual(checkStageChange({ ...commercial, to: "Proposal Preparation", propertyCategory: "residential" }), { ok: true, warning: null });

  const blocking = { ...config, proposals: { ...config.proposals, siteVisitRule: "block" as const } };
  const blocked = checkStageChange({ ...commercial, config: blocking, to: "Proposal Submitted" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ok ? 0 : blocked.status, 409);
  assert.equal(siteVisitRequired(config, "commercial"), true);
  assert.equal(siteVisitRequired(config, null), false);
});

test("booking a site visit moves the enquiry forward only", () => {
  assert.equal(stageAfterSiteVisitBooked(config, "New Enquiry"), ENQUIRY_STAGE.siteVisitScheduled);
  assert.equal(stageAfterSiteVisitBooked(config, "Details Captured"), ENQUIRY_STAGE.siteVisitScheduled);
  assert.equal(stageAfterSiteVisitBooked(config, "Site Visit Scheduled"), null);
  assert.equal(stageAfterSiteVisitBooked(config, "Proposal Submitted"), null, "never backwards");
  assert.equal(stageAfterSiteVisitBooked(config, "On Hold"), null);
});

test("idle: flag after the idle days, escalate after the management days, never for closed or held enquiries", () => {
  const now = new Date("2026-10-07T08:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  assert.deepEqual(idleState({ stage: "Contacted", lastActivityAt: daysAgo(2) }, config, now), { days: 2, state: null });
  assert.deepEqual(idleState({ stage: "Contacted", lastActivityAt: daysAgo(5) }, config, now), { days: 5, state: "idle" });
  assert.deepEqual(idleState({ stage: "Contacted", lastActivityAt: daysAgo(10) }, config, now), { days: 10, state: "escalate" });
  assert.equal(idleState({ stage: "On Hold", lastActivityAt: daysAgo(30) }, config, now).state, null);
  assert.equal(idleState({ stage: "Won", lastActivityAt: daysAgo(30) }, config, now).state, null);
});

test("follow-ups: overdue, today (Dubai time) or upcoming", () => {
  const now = new Date("2026-10-07T08:00:00Z"); // 12:00 in Dubai
  assert.equal(followUpState(null, now), null);
  assert.equal(followUpState("2026-10-07T07:00:00Z", now), "overdue");
  assert.equal(followUpState("2026-10-07T18:00:00Z", now), "today", "22:00 Dubai, still today");
  assert.equal(followUpState("2026-10-07T21:00:00Z", now), "upcoming", "01:00 Dubai, tomorrow");
  assert.deepEqual(dubaiDayBounds(now), { start: "2026-10-06T20:00:00.000Z", end: "2026-10-07T20:00:00.000Z" });
  assert.equal(followUpSchema.safeParse({ channel: "call", outcome: "Spoke to Sara", moveToStage: "Contacted" }).success, true);
  assert.equal(followUpSchema.safeParse({ channel: "fax", outcome: "Sent" }).success, false);
});

test("site visit: a missed or cancelled visit is not completed; counted units reach the proposal", () => {
  const ready = { status: "draft" as const, assessedOn: "2026-10-07", propertyId: "p1", items: [{ result: "ok" as const }] };
  assert.deepEqual(checkAssessmentCompletion(ready), { ok: true }, "attendance is optional");
  assert.deepEqual(checkAssessmentCompletion({ ...ready, attendance: "attended" }), { ok: true });
  assert.equal(checkAssessmentCompletion({ ...ready, attendance: "client_no_show" }).ok, false);

  assert.deepEqual(cleanAssetCounts({ "ac-ppm": 6, "plumbing-ppm": 0, "electrical-ppm": 2.7, stray: 4 }, ["ac-ppm", "plumbing-ppm", "electrical-ppm"]), {
    "ac-ppm": 6,
    "electrical-ppm": 2,
  });

  const prefill = proposalPrefillFromAssessment(
    { status: "completed", submissionId: null, recommendedServiceIds: ["ac-ppm", "plumbing-ppm"], unitType: "office", propertyCategory: "commercial", assetCounts: { "ac-ppm": 6 } },
    null,
    { label: "Office 12", address: null, unitType: "office", propertyCategory: "commercial" },
    [{ id: "ac-ppm", frequencyPerYear: 4 }, { id: "plumbing-ppm", frequencyPerYear: 2 }, { id: "handyman" }],
  );
  assert.equal(prefill.ok, true);
  const units = prefill.ok ? Object.fromEntries(prefill.services.map((s) => [s.serviceId, s.units])) : {};
  assert.deepEqual(units, { "ac-ppm": 6, "plumbing-ppm": 1, handyman: 1 });
});

test("the assessor sent on a site visit can open it; others still cannot", () => {
  const none = { view: false, create: false, edit: false, approve: false };
  const assessor: AmcActor = { userId: "u-assessor", canApprove: false, ops: none };
  assert.equal(canReadAssessment(assessor, "u-sales", "u-assessor"), true);
  assert.equal(canReadAssessment(assessor, "u-sales", null), false);
  assert.equal(canReadAssessment(assessor, "u-sales"), false);
});

test("configuration keeps Won and Lost, which close enquiries", () => {
  const without = { ...config.enquiries, stages: config.enquiries.stages.filter((s) => s !== "Lost") };
  assert.equal(validateAmcConfigSection("enquiries", without).ok, false);
  assert.equal(validateAmcConfigSection("enquiries", config.enquiries).ok, true);
});

test("migration: server-only tables, no cascade, Lost needs a reason, a missed visit is not completed", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007130000_amc_enquiries_and_site_visits.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const t of ["amc_enquiries", "amc_enquiry_follow_ups"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`), t);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
  }
  assert.match(sql, /REVOKE ALL ON public\.amc_enquiries, public\.amc_enquiry_follow_ups FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON SEQUENCE public\.amc_enquiry_number_seq FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.amc_next_enquiry_number\(\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.match(sql, /CHECK \(stage <> 'Lost' OR lost_reason IS NOT NULL\)/);
  assert.match(sql, /COALESCE\(contact_phone, contact_email, contact_whatsapp\) IS NOT NULL/);
  assert.match(sql, /CHECK \(status = 'draft' OR attendance IS NULL OR attendance = 'attended'\)/);
  assert.match(sql, /'ENQ-'/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/);
});
