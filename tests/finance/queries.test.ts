import { test } from "node:test";
import assert from "node:assert/strict";

import { openQuerySchema, queryFiltersSchema, replyQuerySchema, sideOf } from "@/lib/server/finance/queries";

test("2 Nov: someone acts for the side asked if they are in it, else their only side, Finance when both", () => {
  assert.equal(sideOf(["finance", "operations"], "operations"), "operations");
  assert.equal(sideOf(["finance", "operations"], null), "finance");
  assert.equal(sideOf(["operations"], "finance"), "operations", "not a side they are in");
  assert.equal(sideOf([], "finance"), null);
});

test("2 Nov: a query is a question with its text; a reply is a reply or closing it, nothing else", () => {
  assert.equal(openQuerySchema.safeParse({ workOrderId: "33246000002230413", body: "  " }).success, false);
  const ok = openQuerySchema.parse({ workOrderId: "33246000002230413", body: "Line 2 not done" });
  assert.equal(ok.kind, "question");
  assert.deepEqual(ok.lineIds, [], "no lines: the whole work order");
  assert.equal(
    openQuerySchema.safeParse({ workOrderId: "33246000002230413", kind: "not_invoiceable", body: "a" }).success,
    false,
    "not invoiceable is a mark on the work order now",
  );
  for (const action of ["comment", "closed"]) assert.equal(replyQuerySchema.safeParse({ action }).success, true, action);
  for (const action of ["not_resolved", "resolved", "corrected", "withdrawn", "verified"]) {
    assert.equal(replyQuerySchema.safeParse({ action }).success, false, action);
  }
});

test("2 Nov: the Queries page opens on what waits on you", () => {
  const f = queryFiltersSchema.parse({});
  assert.equal(f.view, "waiting");
  assert.equal(f.raisedBy, "all");
  assert.equal(queryFiltersSchema.safeParse({ workOrder: "../x" }).success, false);
});
