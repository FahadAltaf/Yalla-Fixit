import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";
import {
  canDecideStep,
  defaultShareChannel,
  evaluateTriggers,
  fillTemplate,
  ladderLevels,
  priorApprovalCovers,
  recordDecisionSchema,
  shareSchema,
  whatsappNumber,
  whatsappUrl,
} from "@/lib/amc/approval-ladder";
import { AMC_CONFIG_DEFAULTS } from "@/lib/amc/config";
import { canRevise } from "@/lib/amc/proposal-rules";
import { clientTransition } from "@/lib/amc/workflow";
import { proposalShareTexts } from "@/lib/server/amc/proposal-share";
import { decisionSchema } from "@/lib/server/amc/public-dto";
import { escalationRecipients } from "@/lib/server/amc/todos";

/* Phase 5 of the BRD v0.3 plan: approval ladder, sharing and decisions (DEV-369, 370, 371, 420, 423 #1). */

const config = structuredClone(AMC_CONFIG_DEFAULTS);
const base = { discountPercent: 0, finalPrice: 10_000, plan: "fifty_fifty" as const, belowFloor: false };
const UUID = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";

test("triggers: none means share directly; each crossed rule names its level; the highest decides", () => {
  assert.deepEqual(evaluateTriggers(config, base), { triggers: [], requiredLevel: 0 });
  assert.equal(evaluateTriggers(config, { ...base, discountPercent: 12 }).requiredLevel, 1);
  assert.equal(evaluateTriggers(config, { ...base, discountPercent: 25 }).requiredLevel, 2);
  assert.equal(evaluateTriggers(config, { ...base, finalPrice: 60_000 }).requiredLevel, 2, "above AED 50,000 goes to management");
  const plan = evaluateTriggers(config, { ...base, finalPrice: 3_000, plan: "monthly" });
  assert.deepEqual(plan.triggers.map((t) => [t.key, t.level]), [["plan", 1]], "instalments below the band are non-standard");
  const floor = evaluateTriggers(config, { ...base, belowFloor: true, discountPercent: 22 });
  assert.deepEqual(floor.triggers.map((t) => t.key).sort(), ["below_floor", "discount"]);
  assert.equal(floor.requiredLevel, 2);
  assert.deepEqual(ladderLevels(2), [1, 2], "levels decide in sequence from level 1");
  assert.deepEqual(ladderLevels(0), []);
});

test("a new version re-triggers only when it asks for more (BRD 5.5)", () => {
  const prior = { level: 2, discountPercent: 20, plan: "quarterly", belowFloor: false };
  const now = { ...base, plan: "quarterly" as const, discountPercent: 18, requiredLevel: 1 };
  assert.equal(priorApprovalCovers(prior, now), true, "smaller discount, same plan");
  assert.equal(priorApprovalCovers(prior, { ...now, discountPercent: 22, requiredLevel: 2 }), false, "the discount rose");
  assert.equal(priorApprovalCovers(prior, { ...now, plan: "monthly" }), false, "the plan changed");
  assert.equal(priorApprovalCovers(prior, { ...now, belowFloor: true }), false, "a new below-floor line");
  assert.equal(priorApprovalCovers(prior, { ...now, requiredLevel: 3 }), false, "a higher level");
  assert.equal(priorApprovalCovers(null, now), false);
});

test("who decides a level: the named approvers, else the AMC approvers, never the owner", () => {
  assert.equal(canDecideStep({ userId: "a", ownerId: "o", approverIds: ["a", "b"], isAmcApprover: false }), true);
  assert.equal(canDecideStep({ userId: "c", ownerId: "o", approverIds: ["a", "b"], isAmcApprover: true }), false, "named people only");
  assert.equal(canDecideStep({ userId: "c", ownerId: "o", approverIds: [], isAmcApprover: true }), true, "nobody named: the AMC approvers");
  assert.equal(canDecideStep({ userId: "o", ownerId: "o", approverIds: ["o"], isAmcApprover: true }), false, "no self-approval");
});

test("an open level escalates one level up; the last level to itself", () => {
  const withNames = { ...config, approvals: { ...config.approvals, level1ApproverIds: ["l1"], level2ApproverIds: ["l2"], level3ApproverIds: ["l3"] } };
  assert.deepEqual(escalationRecipients("proposal_approval", withNames, 1, "proposal_approval:s:v1:r1:l1"), ["l2"]);
  assert.deepEqual(escalationRecipients("proposal_approval", withNames, 1, "proposal_approval:s:v1:r1:l2"), ["l3"]);
  assert.deepEqual(escalationRecipients("proposal_approval", withNames, 1, "proposal_approval:s:v1:r1:l3"), ["l3"]);
});

test("sharing: WhatsApp for residential, email for commercial; several contacts; WhatsApp numbers", () => {
  assert.equal(defaultShareChannel("residential"), "whatsapp");
  assert.equal(defaultShareChannel("commercial"), "email");
  assert.equal(whatsappNumber("050 123 4567"), "971501234567");
  assert.equal(whatsappNumber("+971 50 123 4567"), "971501234567");
  assert.equal(whatsappNumber("501234567"), "971501234567");
  assert.equal(whatsappNumber("0044 20 7946 0958"), "442079460958", "a foreign number keeps its code");
  assert.equal(whatsappNumber("123"), null);
  assert.equal(whatsappUrl("0501234567", "Hi & bye"), "https://wa.me/971501234567?text=Hi%20%26%20bye");
  assert.equal(shareSchema.safeParse({ id: UUID, channel: "email", recipients: [] }).success, false, "pick a contact");
  assert.equal(shareSchema.safeParse({ id: UUID, channel: "email", recipients: [{ name: "Sara", address: "sara@x.com" }, { address: "ops@x.com" }] }).success, true);
  assert.equal(shareSchema.safeParse({ id: UUID, channel: "email", recipients: [{ address: "0501234567" }] }).success, false);
  assert.equal(shareSchema.safeParse({ id: UUID, channel: "link" }).success, true);
});

test("templates: fields filled, an empty renewal line leaves no gap", () => {
  const text = "Dear {Prospect name},\n\n{Renewal line}\n\nTotal AED {Final price}.";
  assert.equal(fillTemplate(text, { "Prospect name": "Sara", "Renewal line": null, "Final price": "1,050.00" }), "Dear Sara,\n\nTotal AED 1,050.00.");
  assert.equal(fillTemplate(text, { "Prospect name": "Sara", "Renewal line": "Your contract X expires.", "Final price": 1 }), "Dear Sara,\n\nYour contract X expires.\n\nTotal AED 1.");
});

test("Email 1 per BRD 6.1: version, services, visits, price with VAT, plan, validity, link", async () => {
  const settings = getAmcSettingsDefaults();
  const row = {
    proposal_number: "AMC-2026-0042",
    customer: { customerName: "Sara Ahmed", paymentTerms: "annual" },
    property: { propertyDetail: "Villa 12", propertyAddress: "Villa 12, Arabian Ranches" },
    services: [
      { serviceId: "ac-ppm", included: true, frequency: 4 },
      { serviceId: "plumbing-ppm", included: true, frequency: 2 },
      { serviceId: "handyman", included: false, frequency: 1 },
    ],
    final_price: 10_000,
    payment_plan: "fifty_fifty",
  };
  const texts = await proposalShareTexts({} as never, row, {
    settings,
    config,
    link: "https://portal.example/amc/abc",
    validUntil: "2026-11-06",
    versionNo: 2,
    owner: { name: "Omar", phone: "+971 50 000 0000" },
  });
  assert.equal(texts.subject, "Yalla Fix It AMC proposal AMC-2026-0042 V2 for Villa 12");
  assert.match(texts.body, /^Dear Sara Ahmed,/);
  assert.match(texts.body, /6 visits a year/, "PPM visits: 4 + 2");
  assert.match(texts.body, /AED 10,500\.00 including VAT/);
  assert.match(texts.body, /Payment: 50\/50\./);
  assert.match(texts.body, /Valid until 6 November 2026/);
  assert.match(texts.body, /https:\/\/portal\.example\/amc\/abc/);
  assert.match(texts.body, /message \+971 50 000 0000/);
  assert.doesNotMatch(texts.body, /\{|\}/, "no placeholder left");
  assert.match(texts.message, /AMC-2026-0042 V2/);
});

test("the client's third answer, and a decision recorded by hand needs evidence", () => {
  assert.deepEqual(clientTransition("request_revision", "proposal", "proposal_sent"), { ok: true, to: "proposal_rejected" });
  assert.equal(clientTransition("request_revision", "contract", "contract_sent").ok, false);
  assert.equal(decisionSchema.safeParse({ action: "request_revision", name: "Sara" }).success, false, "say what should change");
  assert.equal(decisionSchema.safeParse({ action: "request_revision", name: "Sara", reason: "Two more AC units" }).success, true);
  assert.equal(recordDecisionSchema.safeParse({ id: UUID, answer: "approved", clientName: "Sara" }).success, false, "evidence is mandatory");
  assert.equal(recordDecisionSchema.safeParse({ id: UUID, answer: "approved", clientName: "Sara", evidenceDocumentId: UUID }).success, true);
  assert.equal(recordDecisionSchema.safeParse({ id: UUID, answer: "rejected", clientName: "Sara", evidenceDocumentId: UUID }).success, false, "a rejection says why");
  assert.equal(canRevise("proposal_approved", true), false, "an approved proposal is locked (BRD 5.6)");
});

test("migration: server-only tables, one open level, reasons required, live table only gains columns", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007150000_amc_approval_ladder_and_send_log.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const t of ["amc_approval_steps", "amc_send_log"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`), t);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
  }
  assert.match(sql, /REVOKE ALL ON public\.amc_approval_steps, public\.amc_send_log FROM anon, authenticated/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_amc_approval_steps_one_pending[\s\S]*WHERE status = 'pending'/);
  assert.match(sql, /status NOT IN \('rejected', 'returned'\) OR length\(trim\(coalesce\(comment, ''\)\)\) > 0/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON public\.amc_send_log/, "the send log is append-only");
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/);
  const live = sql.match(/ALTER TABLE public\.amc_submissions[\s\S]*?;/g) ?? [];
  assert.ok(live.length === 1);
  assert.doesNotMatch(live[0], /NOT NULL|DROP|ALTER COLUMN|RENAME/, "only nullable columns on the live table");
});
