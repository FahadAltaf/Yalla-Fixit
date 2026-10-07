import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  AMC_CONFIG_DEFAULTS,
  AMC_CONFIG_SCHEMAS,
  AMC_CONFIG_SECTION_LEVEL,
  AMC_CONFIG_SECTIONS,
  approversForLevel,
  diffAmcConfigSection,
  isNonWorkingDay,
  resolveAmcConfig,
  validateAmcConfigSection,
} from "@/lib/amc/config";
import { AMC_TEMPLATE_DEFINITIONS, templatesConfigSchema, templateText } from "@/lib/amc/message-templates";
import { normalizeUaePhone, renderTemplate, templatePlaceholders, whatsAppLink } from "@/lib/amc/templates";
import { AMC_ROLE_TEMPLATES, missingTemplateRows, templateRows } from "@/lib/amc/role-templates";
import { canCorrectUsage, type AmcActor } from "@/lib/amc/access";
import { canUseAmc, canViewAmcConfig } from "@/components/dashboard/extensions/amc/amc-constants";
import { RESOURCE_ACTIONS } from "@/components/dashboard/permissions/constants";
import { isScheduledJobRequest } from "@/lib/server/amc/jobs";
import { escalationRecipients } from "@/lib/server/amc/todos";
import { ActionType, ResourceType, type User } from "@/types/types";

/* Phase 1 of the BRD v0.3 plan: configuration, roles, templates, to-dos, jobs. */

const userWith = (grants: Array<[ResourceType, ActionType]>, roleName = "staff"): User =>
  ({
    id: "u1",
    roles: {
      name: roleName,
      role_accessCollection: { edges: grants.map(([resource, action]) => ({ node: { resource, action, enabled: true } })) },
    },
  }) as unknown as User;

/* ------------------------------ configuration ------------------------------ */

test("config: every default section passes its own schema", () => {
  for (const section of AMC_CONFIG_SECTIONS) {
    const r = validateAmcConfigSection(section, AMC_CONFIG_DEFAULTS[section]);
    assert.equal(r.ok, true, `${section}: ${r.ok ? "" : r.error}`);
  }
  assert.deepEqual(Object.keys(AMC_CONFIG_SCHEMAS).sort(), [...AMC_CONFIG_SECTIONS].sort());
});

test("config: the plan's defaults (BRD values and assumptions)", () => {
  const d = AMC_CONFIG_DEFAULTS;
  assert.equal(d.payments.singlePaymentBelowAed, 4000); // BRD 5.8
  assert.equal(d.enquiries.stages.length, 12); // BRD 5.1
  assert.deepEqual(d.enquiries.lostReasons, ["Price", "Competitor", "Scope", "No response", "Deferred"]); // DEV-359
  assert.equal(d.scheduling.attemptCount, 3); // BRD 5.11
  assert.equal(d.scheduling.attemptIntervalDays, 2);
  assert.equal(d.sla.nonEmergencyScheduleHours, 48); // BRD 5.13
  assert.equal(d.sla.emergencyAttendMinutes, 120);
  assert.equal(d.additionalWork.materialHandlingFeePercent, 20); // BRD 5.14
  assert.equal(d.renewals.leadDays, 30); // BRD 5.16
  assert.equal(d.todos.emailReminders, false, "live main would email real assignees");
});

test("config: thresholds and value bands are management's; the rest needs Edit (BRD 6.7)", () => {
  assert.equal(AMC_CONFIG_SECTION_LEVEL.approvals, "management");
  assert.equal(AMC_CONFIG_SECTION_LEVEL.payments, "management");
  for (const s of AMC_CONFIG_SECTIONS.filter((s) => s !== "approvals" && s !== "payments")) {
    assert.equal(AMC_CONFIG_SECTION_LEVEL[s], "admin", s);
  }
});

test("config: stored rows override defaults; unknown keys ignored; invalid rows fall back", () => {
  const r = resolveAmcConfig([
    { key: "proposals", value: { ...AMC_CONFIG_DEFAULTS.proposals, validityDays: 45 } },
    { key: "renewals", value: { ...AMC_CONFIG_DEFAULTS.renewals, leadDays: 10 } }, // outside 30-60
    { key: "notASection", value: {} },
  ]);
  assert.equal(r.config.proposals.validityDays, 45);
  assert.equal(r.config.renewals.leadDays, 30);
  assert.deepEqual(r.saved, ["proposals"]);
  assert.deepEqual(r.invalid, ["renewals"]);
});

test("config: validation names the field and refuses inconsistent values", () => {
  const plan = validateAmcConfigSection("payments", { ...AMC_CONFIG_DEFAULTS.payments, plansAboveBand: ["monthly"], defaultPlanAboveBand: "fifty_fifty" });
  assert.equal(plan.ok, false);
  assert.match(plan.ok ? "" : plan.error, /^defaultPlanAboveBand: /);
  const idle = validateAmcConfigSection("enquiries", { ...AMC_CONFIG_DEFAULTS.enquiries, idleDays: 10, managementEscalationDays: 5 });
  assert.match(idle.ok ? "" : idle.error, /^managementEscalationDays: /);
  const extra = validateAmcConfigSection("sla", { ...AMC_CONFIG_DEFAULTS.sla, sneaky: 1 });
  assert.equal(extra.ok, false, "unknown fields are refused");
});

test("config: the change history keeps old and new values (BRD 5.3, 6.9)", () => {
  const changes = diffAmcConfigSection({ a: 1, b: [1, 2], c: "x" }, { a: 2, b: [1, 2], c: "x", d: true });
  assert.deepEqual(changes, [
    { field: "a", before: 1, after: 2 },
    { field: "d", before: null, after: true },
  ]);
});

test("config: approvers per level and the working calendar", () => {
  const config = structuredClone(AMC_CONFIG_DEFAULTS);
  config.approvals.level2ApproverIds = ["00000000-0000-0000-0000-000000000002"];
  assert.deepEqual(approversForLevel(config, 2), ["00000000-0000-0000-0000-000000000002"]);
  assert.deepEqual(approversForLevel(config, 4), []);
  assert.equal(isNonWorkingDay(config, "2026-10-11"), true, "a Sunday");
  assert.equal(isNonWorkingDay(config, "2026-10-12"), false, "a Monday");
  assert.equal(isNonWorkingDay(config, "2026-12-02"), true, "National Day");
});

/* ------------------------------- permissions ------------------------------- */

test("permissions: the new AMC areas exist with their actions and open the module", () => {
  for (const r of [ResourceType.AMC_ENQUIRIES, ResourceType.AMC_RATE_CARD, ResourceType.AMC_CONFIG, ResourceType.AMC_PAYMENTS, ResourceType.AMC_VISITS, ResourceType.AMC_ALLOWANCES]) {
    assert.ok(RESOURCE_ACTIONS[r]?.includes(ActionType.VIEW), r);
    assert.equal(canUseAmc(userWith([[r, ActionType.VIEW]])), true, `${r} View opens AMC`);
  }
  assert.ok(RESOURCE_ACTIONS[ResourceType.AMC_CONFIG].includes(ActionType.APPROVE), "Approve = thresholds and bands");
  assert.equal(canUseAmc(userWith([])), false);
  assert.equal(canViewAmcConfig(userWith([[ResourceType.AMC_CONFIG, ActionType.VIEW]])), true);
  assert.equal(canViewAmcConfig(userWith([[ResourceType.AMC, ActionType.VIEW]])), false);
  assert.equal(canViewAmcConfig(userWith([], "admin")), true, "admins inherit");
});

test("permissions: only an authorised role corrects or reverses usage (BRD 6.7)", () => {
  const base: AmcActor = { userId: "u-owner", canApprove: false, ops: { view: false, create: false, edit: false, approve: false } };
  assert.equal(canCorrectUsage(base, "u-owner"), false, "the owner no longer");
  assert.equal(canCorrectUsage({ ...base, allowanceOverride: true }, "u-owner"), true);
});

test("role templates: every grant is a real resource/action pair; names cannot collide", () => {
  for (const t of AMC_ROLE_TEMPLATES) {
    assert.match(t.name, /^AMC /);
    for (const g of t.grants) {
      for (const a of g.actions) assert.ok(RESOURCE_ACTIONS[g.resource]?.includes(a), `${t.name}: ${g.resource}:${a}`);
    }
  }
  const keys = AMC_ROLE_TEMPLATES.map((t) => t.key);
  assert.deepEqual(keys, ["management", "department_head", "finance", "sales", "coordinator", "supervisor"]);
});

test("role templates: only management and the department head approve proposals; Finance overrides payments; supervisors close visits", () => {
  const has = (key: string, r: ResourceType, a: ActionType) =>
    templateRows(AMC_ROLE_TEMPLATES.find((t) => t.key === key)!).some((row) => row.resource === r && row.action === a);
  assert.equal(has("management", ResourceType.AMC_CONFIG, ActionType.APPROVE), true);
  assert.equal(has("department_head", ResourceType.AMC_CONFIG, ActionType.APPROVE), false);
  assert.equal(has("department_head", ResourceType.AMC_RATE_CARD, ActionType.EDIT), true);
  assert.equal(has("finance", ResourceType.AMC_RATE_CARD, ActionType.EDIT), true);
  assert.equal(has("coordinator", ResourceType.AMC_RATE_CARD, ActionType.EDIT), false);
  assert.equal(has("finance", ResourceType.AMC_PAYMENTS, ActionType.APPROVE), true);
  assert.equal(has("supervisor", ResourceType.AMC_VISITS, ActionType.APPROVE), true);
  assert.equal(has("sales", ResourceType.AMC, ActionType.APPROVE), false);
  assert.equal(has("coordinator", ResourceType.AMC, ActionType.APPROVE), false);
});

test("role templates: applying adds only what is missing; disabled rows count as missing", () => {
  const sales = AMC_ROLE_TEMPLATES.find((t) => t.key === "sales")!;
  const all = templateRows(sales);
  assert.equal(missingTemplateRows(sales, []).length, all.length);
  assert.equal(missingTemplateRows(sales, all.map((r) => ({ ...r, enabled: true }))).length, 0);
  assert.equal(missingTemplateRows(sales, [{ ...all[0], enabled: false }]).length, all.length);
});

/* -------------------------------- templates -------------------------------- */

test("templates: BRD placeholders render; missing ones are reported, never invented", () => {
  const r = renderTemplate("Proposal {Proposal no} {Version} for {Property}", { "Proposal no": "AMC-2026-0007", Version: "V2" });
  assert.equal(r.text, "Proposal AMC-2026-0007 V2 for ");
  assert.deepEqual(r.missing, ["Property"]);
  assert.deepEqual(templatePlaceholders("{A} and {A} and {B c}"), ["A", "B c"]);
  assert.equal(renderTemplate("{X}", { X: "<b>" }, { escapeHtml: true }).text, "&lt;b&gt;");
});

test("templates: the three BRD emails carry their dynamic values (BRD 6.1)", () => {
  const byId = Object.fromEntries(AMC_TEMPLATE_DEFINITIONS.map((t) => [t.id, t]));
  const e1 = `${byId.emailProposalShared.subject} ${byId.emailProposalShared.body}`;
  for (const p of ["Proposal no", "Version", "Property", "Prospect name", "Property address", "Service list", "Visit count", "Final price", "Payment plan", "Validity date", "Approval link", "Coordinator phone", "Coordinator name"]) {
    assert.ok(templatePlaceholders(e1).includes(p), `Email 1: {${p}}`);
  }
  const e2 = `${byId.emailContractForSignature.subject} ${byId.emailContractForSignature.body}`;
  for (const p of ["Contract no", "Client name", "Proposal no", "Property address", "Signing link", "Start date", "End date", "Value", "Payment plan", "First amount"]) {
    assert.ok(templatePlaceholders(e2).includes(p), `Email 2: {${p}}`);
  }
  const e3 = `${byId.emailServiceReport.subject} ${byId.emailServiceReport.body}`;
  for (const p of ["Service", "Seq", "Total", "Property", "Visit date", "Completed", "Remaining", "Used", "Allowed", "Additional work line"]) {
    assert.ok(templatePlaceholders(e3).includes(p), `Email 3: {${p}}`);
  }
  assert.equal(AMC_TEMPLATE_DEFINITIONS.filter((t) => t.kind === "message").length, 8, "BRD 6.3 lists eight messages");
  assert.equal(AMC_TEMPLATE_DEFINITIONS.filter((t) => t.kind === "email").length, 4, "four emails (DEV-420)");
});

test("templates: saved changes override defaults; unknown templates are refused", () => {
  assert.equal(templatesConfigSchema.safeParse({ emailServiceReport: { subject: "S", body: "B" } }).success, true);
  assert.equal(templatesConfigSchema.safeParse({ nope: { body: "B" } }).success, false);
  assert.equal(templateText("messageServiceReport", { messageServiceReport: { body: "Custom" } })?.body, "Custom");
  assert.match(templateText("messageServiceReport", {})?.body ?? "", /\{Report link\}/);
  assert.equal(templateText("missing", {}), null);
});

test("WhatsApp: UAE numbers normalise for wa.me; the text is encoded", () => {
  assert.equal(normalizeUaePhone("050 123 4567"), "971501234567");
  assert.equal(normalizeUaePhone("+971 50-123-4567"), "971501234567");
  assert.equal(normalizeUaePhone("00971501234567"), "971501234567");
  assert.equal(normalizeUaePhone("501234567"), "971501234567");
  assert.equal(normalizeUaePhone("abc"), null);
  assert.equal(whatsAppLink("0501234567", "Hi & bye"), "https://wa.me/971501234567?text=Hi%20%26%20bye");
  assert.equal(whatsAppLink(null, "x"), null);
});

/* ------------------------------- jobs, to-dos ------------------------------ */

test("scheduled jobs: the CRON_SECRET header or Bearer; no secret configured means closed", () => {
  const h = (entries: Record<string, string>) => new Headers(entries);
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "s3" }), "s3"), true);
  assert.equal(isScheduledJobRequest(h({ authorization: "Bearer s3" }), "s3"), true);
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "wrong" }), "s3"), false);
  assert.equal(isScheduledJobRequest(h({ "x-cron-secret": "" }), undefined), false);
});

test("to-do escalation goes to the next approval level, else to management (BRD 6.8)", () => {
  const config = structuredClone(AMC_CONFIG_DEFAULTS);
  config.approvals.level2ApproverIds = ["m"];
  config.approvals.level3ApproverIds = ["x"];
  assert.deepEqual(escalationRecipients("proposal_approval", config, 1), ["m"]);
  assert.deepEqual(escalationRecipients("proposal_approval", config, 2), ["x"]);
  assert.deepEqual(escalationRecipients("renewal_due", config, 1), ["m"]);
});

/* -------------------------------- migration -------------------------------- */

test("platform migration: new tables are server-only; checks become name patterns", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007110000_amc_platform_foundation.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const t of ["amc_config", "amc_todos", "amc_job_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /REVOKE ALL ON public\.amc_config, public\.amc_todos, public\.amc_job_runs FROM anon, authenticated/);
  assert.match(sql, /amc_audit_events_entity_type_check\s+CHECK \(entity_type ~ /);
  assert.match(sql, /amc_notifications_event_name CHECK \(event ~ /);
  assert.match(sql, /related_type IN \('work_order', 'quotation', 'appointment', 'amc_contract'\)/, "live values still allowed");
  assert.match(sql, /dedupe_key text NOT NULL UNIQUE/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/);
});
