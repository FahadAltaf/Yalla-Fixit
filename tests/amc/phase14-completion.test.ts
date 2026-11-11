import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AMC_TEMPLATE_DEFINITIONS } from "@/lib/amc/message-templates";
import { visitsByMonth, visitsByTechnician } from "@/lib/amc/reports";

/* Phase 14 of the BRD v0.3 plan: the completion sweep (DEV-420 to 424). */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const serverCode = (file: string) => read(file);

test("BRD 6.1: the three BRD emails word for word, and Email 4 kept as the workbook draft", () => {
  const byId = Object.fromEntries(AMC_TEMPLATE_DEFINITIONS.map((t) => [t.id, t]));
  assert.equal(byId.emailProposalShared.subject, "Yalla Fix It AMC proposal {Proposal no} {Version} for {Property}");
  assert.equal(byId.emailContractForSignature.subject, "Your Yalla Fix It AMC contract {Contract no} is ready to sign");
  assert.equal(byId.emailServiceReport.subject, "Service report: {Service} visit {Seq} of {Total} at {Property}, {Visit date}");
  assert.match(byId.emailServiceReport.body, /Free non emergency visits used: \{Used\} of \{Allowed\}\./);
  assert.equal(byId.emailInstallmentReminder.draft, true);
});

test("Email 3 counts the free non-emergency allowance; the renewal opening line names the old contract's number", () => {
  const sheets = serverCode("lib/server/amc/job-sheets.ts");
  assert.match(sheets, /call_out_class === "non_emergency" \|\| e\.service_id === "non-emergency"/);
  assert.doesNotMatch(sheets, /frequency_type === "handyman"/, "not the handyman hours");
  const share = serverCode("lib/server/amc/proposal-share.ts");
  assert.match(share, /contract_number, proposal_number, end_date/);
  assert.match(share, /Your contract \$\{oldContract\.number\} expires on \$\{oldContract\.expiry\}\./);
});

test("BRD 6.3: all eight messages are prepared somewhere, the renewal one included", () => {
  const sources = ["lib/server/amc/proposal-share.ts", "lib/server/amc/visits.ts", "lib/server/amc/call-outs.ts", "lib/server/amc/payments.ts", "lib/server/amc/job-sheets.ts"].map(serverCode).join("\n");
  const messages = AMC_TEMPLATE_DEFINITIONS.filter((t) => t.kind === "message");
  assert.equal(messages.length, 8);
  for (const m of messages) assert.ok(sources.includes(`"${m.id}"`), `${m.id} is used`);
});

test("BRD 6.2: every notification on the list has an event that is sent", () => {
  /* The registry of the proposal and contract events, and the senders. */
  const code = read("lib/amc/notifications.ts");
  const all = [
    "enquiries.ts", "approval-ladder.ts", "proposal-share.ts", "contract-lifecycle.ts", "payments.ts", "visits.ts", "ppm.ts", "job-sheets.ts", "call-outs.ts",
    "additional-works.ts", "renewals.ts", "notifications.ts", "assessments.ts", "todos.ts",
  ]
    .map((f) => {
      try {
        return serverCode(`lib/server/amc/${f}`);
      } catch {
        return "";
      }
    })
    .join("\n") + code;
  const required = [
    "enquiry_assigned", "enquiry_follow_up_due", "enquiry_idle", "site_visit_assigned",
    "proposal_pending_approval", "todo_escalated", "proposal_approved", "proposal_sent_back", "proposal_validity_expiring", "client_approved", "client_rejected",
    "contract_unsigned", "initial_payment_pending", "instalment_due", "instalment_overdue", "cheque_date_near", "cheque_bounced", "payment_received",
    "ppm_confirmation_due", "visit_no_answer", "visit_access_pending", "call_out_logged", "call_out_sla_at_risk", "job_sheet_not_submitted", "job_sheet_awaiting_review", "ppm_overdue",
    "entitlement_low", "entitlement_exhausted", "additional_work_awaiting_approval",
    "contract_expiring", "renewal_idle",
  ];
  for (const event of required) assert.ok(all.includes(`"${event}"`), event);
});

test("BRD 6.8: the eight to-dos are each opened", () => {
  const code = ["approval-ladder.ts", "contract-lifecycle.ts", "payments.ts", "visits.ts", "job-sheets.ts", "renewals.ts", "call-outs.ts"].map((f) => serverCode(`lib/server/amc/${f}`)).join("\n");
  for (const kind of ["proposal_approval", "contract_follow_up", "ppm_confirmation", "access_gate_pass", "job_closure_review", "installment_overdue", "renewal_due", "call_out"]) {
    assert.match(code, new RegExp(`kind: "${kind}"`), kind);
  }
});

test("BRD 6.9: visits by status per month and per technician, with the attempts", () => {
  const facts = [
    { month: "2026-10", status: "completed", technicianIds: ["T1"], attempts: 2 },
    { month: "2026-10", status: "not_completed", technicianIds: ["T1", "T2"], attempts: 3 },
    { month: "2026-11", status: "scheduled", technicianIds: [], attempts: 1 },
    { month: "2026-11", status: "partially_completed", technicianIds: ["T2"], attempts: 0 },
  ];
  assert.deepEqual(visitsByMonth(facts), [
    { month: "2026-10", total: 2, done: 1, partial: 0, notCompleted: 1, open: 0, attempts: 5 },
    { month: "2026-11", total: 2, done: 0, partial: 1, notCompleted: 0, open: 1, attempts: 1 },
  ]);
  const t = visitsByTechnician(facts, new Map([["T1", "Ravi"]]));
  assert.deepEqual(t.map((x) => [x.name, x.total, x.done, x.notCompleted, x.partial]), [["Ravi", 2, 1, 1, 0], ["T2", 2, 0, 1, 1]]);
});

test("BRD 6.9 / DEV-424: visits, job sheets, instalments and cheques keep their status history in the database", () => {
  const sql = read("supabase/migrations/20261013100000_amc_status_history_triggers.sql")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const [table, entity] of [["amc_visits", "visit"], ["amc_visit_job_sheets", "job_sheet"], ["amc_instalments", "instalment"], ["amc_cheques", "cheque"]]) {
    assert.match(sql, new RegExp(`AFTER UPDATE OF status ON public\\.${table}[\\s\\S]*?amc_record_status_change\\('${entity}'`), table);
  }
  assert.match(sql, /'status_changed'/, "the same event the server writes");
  assert.doesNotMatch(sql, /amc_submissions|role_access|\bDROP TABLE\b|\bDELETE FROM\b/i);
});

test("the demo script and the re-run gap analysis are in docs", () => {
  const script = read("docs/amc-demo-script.md");
  for (let step = 1; step <= 16; step += 1) assert.match(script, new RegExp(`### ${step}\\. `), `step ${step}`);
  assert.match(read("docs/amc-brd-v0.3-gap-analysis.md"), /Re-audited/);
});

/* ------------------------------------------------------------------ */
/* The re-audit's partial rows, closed (DEV-425 to 430)                */
/* ------------------------------------------------------------------ */

test("escalation: approvals climb a level per period and the escalated approvers can decide; call outs go to the supervisors", async () => {
  const { escalationRecipients } = await import("@/lib/server/amc/todos");
  const { AMC_CONFIG_DEFAULTS } = await import("@/lib/amc/config");
  const config = {
    ...AMC_CONFIG_DEFAULTS,
    approvals: { ...AMC_CONFIG_DEFAULTS.approvals, level1ApproverIds: ["l1"], level2ApproverIds: ["l2"], level3ApproverIds: ["l3"] },
    scheduling: { ...AMC_CONFIG_DEFAULTS.scheduling, supervisorUserIds: ["sup"] },
  };
  assert.deepEqual(escalationRecipients("proposal_approval", config, 1, "proposal_approval:s:v1:r1:l1"), ["l2"]);
  assert.deepEqual(escalationRecipients("proposal_approval", config, 2, "proposal_approval:s:v1:r1:l1"), ["l3"], "the second escalation climbs again");
  assert.deepEqual(escalationRecipients("call_out", config, 1), ["sup"]);
  assert.deepEqual(escalationRecipients("job_closure_review", config, 1), ["sup"]);
  const todos = read("lib/server/amc/todos.ts");
  assert.match(todos, /amc_approval_steps[\s\S]*?approver_ids: approvers/, "the escalated approvers join the pending step");
  assert.match(todos, /escalated_at: null, escalate_at:/, "armed again below level 3");
});

test("payments: escalate by hand and the expected mode; the snooze; the FSM contact on the profile", async () => {
  const { paymentActionSchema, rightFor } = await import("@/lib/amc/payments");
  const id = "6f0f7d8e-3c2a-4b1e-9c11-0a1b2c3d4e5f";
  assert.equal(paymentActionSchema.safeParse({ action: "escalate", instalmentId: id }).success, true);
  assert.equal(paymentActionSchema.safeParse({ action: "set_expected_mode", instalmentId: id, mode: "cheque" }).success, true);
  assert.equal(paymentActionSchema.safeParse({ action: "set_expected_mode", instalmentId: id, mode: "barter" }).success, false);
  assert.equal(rightFor("escalate"), "create", "the owner or Finance escalate");
  const { lifecycleActionSchema } = await import("@/lib/amc/contract-lifecycle");
  assert.equal(lifecycleActionSchema.safeParse({ action: "snooze_follow_up", days: 3, reason: "Client travelling" }).success, true);
  assert.equal(lifecycleActionSchema.safeParse({ action: "snooze_follow_up", days: 30, reason: "Too long" }).success, false);
  const { customerProfileFields } = await import("@/lib/amc/client-profile");
  assert.ok("fsmContactId" in customerProfileFields);
});

test("rules now enforced on the server: site visit, minimum term, attempt interval, pending access, call-out crew, validity", () => {
  const approval = read("app/api/amc-submissions/approval/route.ts");
  assert.match(approval, /siteVisitProblem\(admin, existing\.id, submitConfig\)/);
  assert.match(approval, /checkTerm\(term, submitConfig\.contracts\)/);
  const visits = read("lib/server/amc/visits.ts");
  assert.match(visits, /between attempts: the next one from/);
  assert.match(visits, /\{ status: "pending_access" \}/);
  assert.match(visits, /accessRules: ctx\.accessRules/);
  const callOuts = read("lib/server/amc/call-outs.ts");
  assert.match(callOuts, /This is not the suggested crew: say why/);
  assert.match(callOuts, /accessTypes: \(\(rules \?\? \[\]\) as Row\[\]\)\.filter\(\(r\) => r\.access_type === "security_clearance"\)/);
  const link = read("app/api/amc/[token]/route.ts");
  assert.match(link, /validUntil < todayInDubai\(\)/);
  const share = read("lib/server/amc/proposal-share.ts");
  assert.match(share, /logClientCommunication/, "portal sends are in the client's communication log");
  const lifecycle = read("lib/server/amc/contract-lifecycle.ts");
  assert.match(lifecycle, /assigneeIds: \[ownerId, \.\.\.config\.payments\.financeUserIds\]/);
  assert.match(lifecycle, /remindInternalSignatories/);
  assert.match(lifecycle, /mirrorTermsToDocument/);
});
