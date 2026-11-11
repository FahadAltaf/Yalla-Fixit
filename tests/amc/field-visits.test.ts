import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  FIELD_VISIT_STAGES,
  OPEN_FIELD_VISIT_STAGES,
  fieldVisitHref,
  fieldVisitStatusLabel,
  isFieldVisitLate,
} from "@/lib/amc/field-visits";

test("a visit is late only when its last day has passed and the crew has not finished on site", () => {
  const today = "2026-11-11";
  assert.equal(isFieldVisitLate({ stage: "planned", dueOn: "2026-11-10" }, today), true);
  assert.equal(isFieldVisitLate({ stage: "planned", dueOn: "2026-11-11" }, today), false, "the last day itself is not late");
  assert.equal(isFieldVisitLate({ stage: "review", dueOn: "2026-11-01" }, today), false, "waiting for the supervisor is not the crew's lateness");
  assert.equal(isFieldVisitLate({ stage: "done", dueOn: "2026-11-01" }, today), false);
  assert.equal(isFieldVisitLate({ stage: "to_plan", dueOn: null }, today), false, "no last day, never late");
});

test("open is every stage still to be done", () => {
  assert.deepEqual([...OPEN_FIELD_VISIT_STAGES], FIELD_VISIT_STAGES.filter((s) => s !== "done" && s !== "cancelled"));
});

test("planned visits and call outs open on their own page; the rest where they are handled", () => {
  assert.equal(fieldVisitHref({ kind: "ppm", id: "v1", contractId: "c1" }), "/extensions/amc-contracts/visits/v1");
  assert.equal(fieldVisitHref({ kind: "call_out", id: "o1", contractId: "c1" }), "/extensions/amc-contracts/visits/o1");
  assert.equal(fieldVisitHref({ kind: "additional_work", id: "w1", contractId: "c1" }), "/extensions/amc-contracts/additional-works/w1");
  assert.equal(fieldVisitHref({ kind: "site_visit", id: "a1", contractId: null }), "/extensions/amc-contracts/assessments/a1");
});

test("the kind's own status reads in words", () => {
  assert.equal(fieldVisitStatusLabel("site_visit", "draft"), "Draft");
  assert.equal(fieldVisitStatusLabel("ppm", "not_scheduled"), "Not scheduled");
  assert.equal(fieldVisitStatusLabel("call_out", "something_new"), "something new");
});

test("the view's stages are the ones the list knows, and it is server only", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261111100000_amc_field_visits_view.sql"), "utf8");
  const used = new Set([...sql.matchAll(/THEN '([a-z_]+)'/g)].map((m) => m[1]).concat([...sql.matchAll(/ELSE '([a-z_]+)'/g)].map((m) => m[1])));
  for (const stage of used) assert.ok((FIELD_VISIT_STAGES as readonly string[]).includes(stage), `unknown stage ${stage}`);
  assert.match(sql, /security_invoker = true/);
  assert.match(sql, /REVOKE ALL ON public\.amc_field_visits FROM anon, authenticated/);
});
