import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AMC_CONFIG_DEFAULTS, AMC_CONFIG_SCHEMAS } from "@/lib/amc/config";
import {
  OUTCOME_GROUP_KEYS,
  closedStatus,
  isNoShow,
  jobSheetActionSchema,
  noShowConsumesVisit,
  remainingTrades,
  reportDueAt,
  reportState,
  reviewReasons,
  submitProblems,
  type SheetFacts,
} from "@/lib/amc/job-sheets";

/* Phase 10 of the BRD v0.3 plan: job sheet, supervisor closure, service report (DEV-402, 403, 404, to-do 5). */

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
const sql = read("supabase/migrations/20261012110000_amc_visit_job_sheets.sql")
  .split(/\r?\n/)
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const facts = (more: Partial<SheetFacts> = {}): SheetFacts => ({
  pendingWorks: [],
  qualityConcern: false,
  additionalWork: [],
  lines: [{ outcome: "completed" }],
  photos: [{ kind: "before" }, { kind: "after" }],
  clientSignatureName: "Sara",
  ...more,
});

test("the five reason groups of BRD 5.11, and what a no-show is", () => {
  assert.deepEqual(OUTCOME_GROUP_KEYS, ["client", "internal", "material", "access", "partial"]);
  assert.equal(isNoShow("client", "No access given"), true);
  assert.equal(isNoShow("client", "Client rescheduled"), false, "a reschedule is not a no-show");
  assert.equal(isNoShow("internal", "Manpower"), false, "our failure never counts against the client");
});

test("two client no-shows in a row consume the visit; one does not", () => {
  const noShow = { group: "client" as const, reason: "Not reachable" };
  assert.equal(noShowConsumesVisit(noShow, null), false, "the first no-show is planned again");
  assert.equal(noShowConsumesVisit(noShow, { group: "client", reason: "Property vacant" }), true);
  assert.equal(noShowConsumesVisit(noShow, { group: "internal", reason: "Vehicle" }), false, "the attempt before failed on our side");
  assert.equal(noShowConsumesVisit(noShow, null, 1), true, "configured to one");
});

test("review is mandatory for pending works, quality concerns, missing evidence and incomplete scope", () => {
  assert.deepEqual(reviewReasons(facts()), []);
  assert.deepEqual(reviewReasons(facts({ pendingWorks: [{ description: "Replace valve", reason: "Part on order" }] })), ["pending_works"]);
  assert.deepEqual(reviewReasons(facts({ qualityConcern: true })), ["quality_concern"]);
  assert.deepEqual(reviewReasons(facts({ photos: [{ kind: "before" }] })), ["missing_evidence"], "no after photo");
  assert.deepEqual(reviewReasons(facts({ clientSignatureName: null })), ["missing_evidence"], "no client signature");
  assert.deepEqual(reviewReasons(facts({ lines: [{ outcome: "completed" }, { outcome: "not_completed" }] })), ["incomplete_scope"]);
  assert.deepEqual(reviewReasons(facts({ lines: [{ outcome: "not_completed" }], photos: [], clientSignatureName: null })), ["incomplete_scope"], "nothing done needs no evidence");
});

test("a job sheet is submitted only when it can be reviewed", () => {
  const ok = { ...facts(), arrivedAt: "2026-11-10T05:00:00Z", completedAt: "2026-11-10T07:00:00Z", linesExplained: true };
  assert.deepEqual(submitProblems(ok), []);
  assert.ok(submitProblems({ ...ok, arrivedAt: null }).includes("Record the arrival time"));
  assert.ok(submitProblems({ ...ok, completedAt: "2026-11-10T04:00:00Z" }).includes("Completion is before arrival"));
  assert.ok(submitProblems({ ...ok, lines: [{ outcome: null }] }).includes("Give every trade an outcome"));
  assert.ok(submitProblems({ ...ok, linesExplained: false }).some((p) => /needs its reason/.test(p)));
  assert.ok(submitProblems({ ...ok, clientSignatureName: " " }).some((p) => /signature/.test(p)));
  assert.ok(submitProblems({ ...ok, pendingWorks: [{ description: "Grout", reason: " " }] }).includes("Every pending work needs a reason"));
});

test("the closed visit's status, and which trades go again", () => {
  assert.equal(closedStatus([{ outcome: "completed" }, { outcome: "completed" }], 0), "completed");
  assert.equal(closedStatus([{ outcome: "completed" }], 2), "completed_with_additional_work");
  assert.equal(closedStatus([{ outcome: "completed" }, { outcome: "not_completed" }], 0), "partially_completed");
  assert.equal(closedStatus([{ outcome: "partially_completed" }], 0), "partially_completed");
  assert.equal(closedStatus([{ outcome: "not_completed" }, { outcome: "not_completed" }], 1), "not_completed");
  const left = remainingTrades([
    { id: "ac", outcome: "completed" as const, consumed: true },
    { id: "plumbing", outcome: "not_completed" as const, consumed: false },
    { id: "tank", outcome: "partially_completed" as const, consumed: true },
    { id: "pest", outcome: "not_completed" as const, consumed: true },
  ]);
  assert.deepEqual(left.map((l) => l.id), ["plumbing", "tank"], "done work is not reopened; a consumed no-show is not planned again");
});

test("the service report is due within 48 hours of the visit, at risk in its last 12", () => {
  const due = reportDueAt("2026-11-10T07:00:00.000Z");
  assert.equal(due, "2026-11-12T07:00:00.000Z");
  assert.equal(reportState(due, null, new Date("2026-11-11T07:00:00Z")), "on_time");
  assert.equal(reportState(due, null, new Date("2026-11-12T00:00:00Z")), "at_risk");
  assert.equal(reportState(due, null, new Date("2026-11-12T08:00:00Z")), "late");
  assert.equal(reportState(due, "2026-11-11T09:00:00Z", new Date("2026-11-13T00:00:00Z")), "sent");
  assert.equal(reportState(null, null, new Date()), null);
});

test("what the job sheet route accepts", () => {
  const line = "6f0f7d8e-3c2a-4b1e-9c11-0a1b2c3d4e5f";
  const save = jobSheetActionSchema.safeParse({
    action: "submit",
    sheet: { arrivedAt: "2026-11-10T09:00:00+04:00", completedAt: "2026-11-10T11:00:00+04:00", lines: [{ lineId: line, outcome: "not_completed", outcomeGroup: "access", outcomeReason: "Building" }] },
  });
  assert.equal(save.success, true);
  assert.equal(jobSheetActionSchema.safeParse({ action: "save", sheet: { lines: [{ lineId: line, outcome: "not_completed", outcomeGroup: "weather" }] } }).success, false, "only the five groups");
  assert.equal(jobSheetActionSchema.safeParse({ action: "return", comment: "" }).success, false, "a return says what to fix");
  assert.equal(jobSheetActionSchema.safeParse({ action: "close" }).success, true);
  assert.equal(jobSheetActionSchema.safeParse({ action: "delete" }).success, false);
});

test("configuration: supervisors and the grace hours, defaulted so an older saved section still validates", () => {
  assert.deepEqual(AMC_CONFIG_DEFAULTS.scheduling.supervisorUserIds, []);
  assert.equal(AMC_CONFIG_DEFAULTS.scheduling.jobSheetGraceHours, 4);
  const older: Record<string, unknown> = { ...AMC_CONFIG_DEFAULTS.scheduling };
  delete older.supervisorUserIds;
  delete older.jobSheetGraceHours;
  const parsed = AMC_CONFIG_SCHEMAS.scheduling.parse(older);
  assert.equal(parsed.jobSheetGraceHours, 4);
});

test("the migration is additive and keeps the job sheet server-only", () => {
  for (const table of ["amc_visit_job_sheets", "amc_visit_checklist_items", "amc_visit_photos"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`), table);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`), `${table} RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${table} FROM anon, authenticated`), `${table} revoked`);
  }
  assert.doesNotMatch(sql, /amc_submissions/, "the live submissions table is not touched");
  assert.doesNotMatch(sql, /schedule_entries|snagging_/, "live scheduling and Snagging are not touched");
  assert.doesNotMatch(sql, /\bDROP TABLE\b|\bDROP COLUMN\b|\bDELETE FROM\b/i);
  assert.match(sql, /'remainder'/);
  assert.match(sql, /'service_report'/);
});

test("the routes gate filling in, reviewing and reading separately; the sweep runs daily", () => {
  const route = read("app/api/amc-visits/[visitId]/job-sheet/route.ts");
  assert.match(route, /gate\.visits\.approve \|\| jobSheetSupervisors\(config\)\.includes\(gate\.userId\)/, "close and return: a supervisor");
  assert.match(route, /gate\.visits\.create \|\| gate\.visits\.edit \|\| canOperateContract/, "fill in: Visits create/edit or the operator");
  assert.match(route, /canReadContract\(gate\.actor, scope\.ownerId\)/, "read: the contract's readers");
  const queue = read("app/api/amc-job-reviews/route.ts");
  assert.match(queue, /!gate\.visits\.view && !supervisor/);
  assert.match(read("lib/server/amc/jobs.ts"), /key: "job_sheets"/);
  assert.match(read("app/(dashboard)/extensions/amc-contracts/job-reviews/page.tsx"), /canSeeAmcPage\(ResourceType\.AMC_VISITS\)/);
});
