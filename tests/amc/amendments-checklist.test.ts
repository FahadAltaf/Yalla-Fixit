import { test } from "node:test";
import assert from "node:assert/strict";

import { amendmentChecklist } from "@/lib/amc/amendments";
import { siteVisitChecklist } from "@/lib/amc/site-visit-checklist";

/* 23 Nov 2026: what the approver checks on an amendment and on a site visit. */
const base = { reason: "Client is moving abroad for work", requestedBy: "u1", requestedByName: "Sami", effectiveOn: "2026-12-30", details: {} };
const ctx = { contractStatus: "active", viewerId: "u2", today: "2026-11-23" };

test("someone else's request, allowed now, with its dates", () => {
  const checks = amendmentChecklist({ ...base, kind: "hold", details: { until: "2027-01-31" } }, ctx);
  const by = Object.fromEntries(checks.map((c) => [c.key, c.state]));
  assert.deepEqual([by.who, by.reason, by.allowed, by.date, by.until], ["ok", "ok", "ok", "ok", "ok"]);
});

test("not allowed in this status, a short reason and a past date are flagged; your own request is fine", () => {
  const checks = amendmentChecklist({ ...base, kind: "resume", reason: "pls", effectiveOn: "2026-11-01" }, { ...ctx, viewerId: "u1" });
  const by = Object.fromEntries(checks.map((c) => [c.key, c.state]));
  /* Asking yourself is fine for an approver (24 Nov 2026, Sami). */
  assert.deepEqual([by.who, by.reason, by.allowed, by.date], ["ok", "warn", "missing", "warn"]);
});

test("a termination checks the 30 days of notice and asks about the refund", () => {
  const ok = amendmentChecklist({ ...base, kind: "early_termination", effectiveOn: "2026-12-30", details: { noticeOn: "2026-11-23", refundIfValid: 1200, received: 5000 } }, ctx);
  assert.equal(ok.find((c) => c.key === "notice")!.state, "ok");
  assert.match(ok.find((c) => c.key === "refund")!.detail, /AED 1,200/);
  const short = amendmentChecklist({ ...base, kind: "early_termination", effectiveOn: "2026-12-01", details: { noticeOn: "2026-11-23" } }, ctx);
  assert.equal(short.find((c) => c.key === "notice")!.state, "warn");
});

test("a transfer without contact details is missing; a cancellation warns it cannot be undone", () => {
  const t = amendmentChecklist({ ...base, kind: "transfer", details: { to: { customerName: "New Tenant", role: "tenant" } } }, ctx);
  assert.equal(t.find((c) => c.key === "party")!.state, "missing");
  const c = amendmentChecklist({ ...base, kind: "cancellation", effectiveOn: null }, { ...ctx, contractStatus: "signed" });
  assert.equal(c.find((x) => x.key === "final")!.state, "warn");
  assert.equal(c.find((x) => x.key === "allowed")!.state, "ok");
});

test("a site visit lists what approving changes and what it recorded", () => {
  const r = siteVisitChecklist({
    attendance: "Tenant",
    assetCounts: { ac: 3 },
    findings: "Two units noisy",
    summary: null,
    accessNotes: null,
    exclusions: null,
    recommendedServiceIds: ["ac-ppm"],
    items: [{ label: "Roof access", result: null }],
    photoCount: 0,
    assets: [{ assetType: "Split AC", location: "Bedroom", condition: "poor" }],
    scope: [{ serviceId: "ac-ppm", frequencyPerYear: null }],
    changes: [
      { entity: "asset", op: "insert", before: null, after: { assetType: "Split AC", location: "Bedroom" } },
      { entity: "scope", op: "delete", before: { serviceId: "pest-control" }, after: null },
    ],
    serviceLabel: (id) => (id === "ac-ppm" ? "AC Service" : id === "pest-control" ? "Pest Control" : id),
  });
  assert.deepEqual(r.changes.map((c) => `${c.op} ${c.label}`), ["insert Split AC · Bedroom", "delete Pest Control"]);
  const by = Object.fromEntries(r.checks.map((c) => [c.key, c.state]));
  assert.deepEqual([by.attendance, by.assets, by.condition, by.photos, by.access, by.scope], ["ok", "ok", "ok", "missing", "missing", "ok"]);
  assert.deepEqual([by.unanswered, by.poor, by.no_visits], ["warn", "warn", "warn"]);
});
