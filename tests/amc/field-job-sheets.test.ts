import { test } from "node:test";
import assert from "node:assert/strict";

import { closeFieldJobSheet, fieldJobSheetView, returnFieldJobSheet, saveFieldJobSheet } from "@/lib/server/amc/field-job-sheets";
import type { AmcConfig } from "@/lib/amc/config";
import type { JobSheetInput } from "@/lib/amc/job-sheets";
import { fakeSupabase } from "./fake-supabase";

/* 18 Nov 2026: a call out and an additional work are recorded on the planned visit's job sheet. */
const CONTRACT = "c0000000-0000-4000-8000-000000000001";
const WORK = "a0000000-0000-4000-8000-000000000001";
const actor = { id: "u1", label: "Office" };
const config = { scheduling: { supervisorUserIds: ["sup"] }, approvals: { levels: [] }, todos: {} } as unknown as AmcConfig;

const seed = (started: string | null) =>
  fakeSupabase({
    amc_contracts: [{ id: CONTRACT, status: "active", contract_number: "AMC-C-1", customer_name: "Bert", property_label: "14 East St", property_id: null, customer: {} }],
    amc_additional_works: [
      { id: WORK, work_no: "AW-7", contract_id: CONTRACT, status: "scheduled", trade: "ac", finding: "Leaking drain pan", scheduled_start: "2026-11-20T05:00:00Z", scheduled_for: "2026-11-20", technician_ids: ["t1"], created_at: "2026-11-17T08:00:00Z", started_at: started, report_document_id: null, report_sent_at: null, report_due_at: null },
    ],
    amc_visit_job_sheets: [],
    amc_visit_checklist_items: [],
    amc_work_photos: [],
  });

const sheet = (over: Partial<JobSheetInput> = {}): JobSheetInput => ({
  arrivedAt: "2026-11-20T05:10:00Z",
  completedAt: "2026-11-20T06:30:00Z",
  technicianIds: ["t1"],
  faults: "Drain pan cracked",
  consumables: [],
  additionalWork: [],
  pendingWorks: [],
  qualityConcern: false,
  qualityNote: null,
  clientSignatureName: "Bert",
  notes: "Pan replaced",
  lines: [{ lineId: WORK, outcome: "completed", outcomeGroup: null, outcomeReason: null }],
  checklist: [{ lineId: null, assetId: null, label: "Drain flows", category: null, result: "ok", note: null }],
  ...over,
});

test("the work is the sheet's one line, named as the work", async () => {
  const view = await fieldJobSheetView(seed(null).client as never, "additional_work", WORK);
  assert.equal(view.migrated, true);
  assert.equal(view.visit.kind, "additional_work");
  assert.equal(view.visit.label, "additional work AW-7");
  assert.equal(view.lines.length, 1);
  assert.equal(view.lines[0].id, WORK);
  assert.match(view.lines[0].serviceLabel, /Leaking drain pan/);
  assert.equal(view.sheet.status, null);
});

test("nothing can be filled in before the office starts the work", async () => {
  await assert.rejects(saveFieldJobSheet(seed(null).client as never, "additional_work", WORK, sheet(), actor, config, false), /not started/);
});

test("a started work's sheet is kept with its one outcome and checklist", async () => {
  const db = seed("2026-11-20T05:00:00Z");
  await saveFieldJobSheet(db.client as never, "additional_work", WORK, sheet(), actor, config, false);
  const view = await fieldJobSheetView(db.client as never, "additional_work", WORK);
  assert.equal(view.sheet.status, "draft");
  assert.equal(view.lines[0].outcome, "completed");
  assert.equal(view.checklist.length, 1);
  assert.equal(view.checklist[0].lineId, null);
});

test("submitting needs the client's sign-off for work done", async () => {
  const db = seed("2026-11-20T05:00:00Z");
  await assert.rejects(saveFieldJobSheet(db.client as never, "additional_work", WORK, sheet({ clientSignatureName: null }), actor, config, true), /signature/);
});

test("only a submitted sheet is returned or closed", async () => {
  const db = seed("2026-11-20T05:00:00Z");
  await saveFieldJobSheet(db.client as never, "additional_work", WORK, sheet(), actor, config, false);
  await assert.rejects(returnFieldJobSheet(db.client as never, "additional_work", WORK, "Fix the photos", actor), /Only a submitted/);
  await assert.rejects(closeFieldJobSheet(db.client as never, "additional_work", WORK, null, actor, config), /Only a submitted/);
});
