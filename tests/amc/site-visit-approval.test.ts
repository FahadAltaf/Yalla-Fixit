import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { approveSiteVisit, heldSiteChanges, holdSiteChange, sendBackSiteVisit, withHeldChanges } from "@/lib/server/amc/site-visit-approval";
import type { AssetRecord, ScopeItemRecord } from "@/lib/server/amc/client-profile";
import { fakeSupabase } from "./fake-supabase";

const SITE = "11111111-1111-4111-8111-111111111111";
const PROPERTY = "22222222-2222-4222-8222-222222222222";
const APPROVER = "33333333-3333-4333-8333-333333333333";
const INSPECTOR = "44444444-4444-4444-8444-444444444444";
const NEW_ASSET = "55555555-5555-4555-8555-555555555555";
const OLD_SCOPE = "66666666-6666-4666-8666-666666666666";

const asset = { assetType: "Split AC", trade: "ac", quantity: 2, location: "Living room", make: null, model: null, serialNo: null, capacity: null, installedOn: null, condition: "good", notes: null };
const scope = { serviceId: "ac-ppm", trade: "ac", assetId: null, quantity: 1, frequencyPerYear: 4, durationMinutes: null, preferredMonths: [], preferredDays: [], exclusions: null, notes: null };

function setup(siteOver: Record<string, unknown> = {}) {
  const fake = fakeSupabase({
    amc_assessments: [
      {
        id: SITE,
        assessment_number: "ASM-2026-0099",
        status: "completed",
        property_id: PROPERTY,
        /* The embedded property, as the real join returns it. */
        property: { id: PROPERTY, unit_label: "Villa 7" },
        assessor_id: INSPECTOR,
        assessor_name: "Ahmed",
        approver_id: APPROVER,
        approver_name: "Sara",
        approved_at: null,
        completed_at: "2026-11-16T08:00:00Z",
        assessed_on: "2026-11-16",
        recommended_service_ids: [],
        created_by: APPROVER,
        created_at: "2026-11-15T08:00:00Z",
        ...siteOver,
      },
    ],
    amc_assessment_items: [],
    amc_site_visit_changes: [],
    amc_property_assets: [],
    amc_scope_items: [{ id: OLD_SCOPE, property_id: PROPERTY, service_id: "plumbing-ppm", trade: "plumbing", quantity: 1, active: true, preferred_months: [], preferred_days: [] }],
  });
  return { fake, admin: fake.client as unknown as SupabaseClient };
}

test("a held change is kept as its net change", async () => {
  const { admin, fake } = setup({ status: "draft" });
  await holdSiteChange(admin, SITE, { entity: "asset", op: "insert", targetId: NEW_ASSET, payload: asset }, INSPECTOR);
  await holdSiteChange(admin, SITE, { entity: "asset", op: "update", targetId: NEW_ASSET, payload: { ...asset, quantity: 3 } }, INSPECTOR);
  let rows = fake.table("amc_site_visit_changes");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].op, "insert", "added then edited is still an addition");
  assert.equal((rows[0].payload as { quantity: number }).quantity, 3);

  await holdSiteChange(admin, SITE, { entity: "asset", op: "delete", targetId: NEW_ASSET }, INSPECTOR);
  rows = fake.table("amc_site_visit_changes");
  assert.equal(rows.length, 0, "added then removed leaves nothing for the property");

  await holdSiteChange(admin, SITE, { entity: "scope", op: "delete", targetId: OLD_SCOPE }, INSPECTOR);
  const held = await heldSiteChanges(admin, SITE);
  assert.deepEqual(held.map((c) => [c.entity, c.op, c.targetId]), [["scope", "delete", OLD_SCOPE]]);
});

test("the phone sees the property with the visit's held changes over it", () => {
  const live = [{ id: OLD_SCOPE, serviceId: "plumbing-ppm", active: true } as unknown as ScopeItemRecord];
  const { assets, scope: s } = withHeldChanges([] as AssetRecord[], live, [
    { entity: "asset", op: "insert", targetId: NEW_ASSET, payload: asset, updatedAt: "2026-11-16T08:00:00Z" },
    { entity: "scope", op: "delete", targetId: OLD_SCOPE, payload: {}, updatedAt: "2026-11-16T08:00:00Z" },
  ]);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, NEW_ASSET);
  assert.equal(assets[0].status, "active");
  assert.equal(s.length, 0);
});

test("only a site visit approver (AMC configuration, or the one named on an older visit) can approve, and approving puts the held changes on the property", async () => {
  const { admin, fake } = setup();
  fake.table("amc_site_visit_changes").push(
    { assessment_id: SITE, entity: "asset", target_id: NEW_ASSET, op: "insert", payload: asset, updated_at: "2026-11-16T08:00:00Z", applied_at: null },
    { assessment_id: SITE, entity: "scope", target_id: OLD_SCOPE, op: "delete", payload: {}, updated_at: "2026-11-16T08:01:00Z", applied_at: null },
  );
  await assert.rejects(approveSiteVisit(admin, SITE, { id: INSPECTOR, label: "Ahmed" }), /Only the site visit approvers/);
  assert.equal(fake.table("amc_property_assets").length, 0, "nothing applied for someone else");

  await approveSiteVisit(admin, SITE, { id: APPROVER, label: "Sara" });
  const assets = fake.table("amc_property_assets");
  assert.equal(assets.length, 1);
  assert.equal(assets[0].id, NEW_ASSET, "the new asset keeps the id the phone gave it");
  assert.equal(fake.table("amc_scope_items").find((r) => r.id === OLD_SCOPE)?.active, false, "the removed scope item is taken out of scope");
  assert.ok(fake.table("amc_site_visit_changes").every((r) => r.applied_at), "every change marked applied");
  assert.ok(fake.table("amc_assessments")[0].approved_at, "the visit is approved");
  await assert.rejects(approveSiteVisit(admin, SITE, { id: APPROVER, label: "Sara" }), /already approved/);
});

test("the approver can send it back with a reason; it is a draft again", async () => {
  const { admin, fake } = setup();
  await assert.rejects(sendBackSiteVisit(admin, SITE, "Recount", { id: INSPECTOR, label: "Ahmed" }), /Only the site visit approvers/);
  await assert.rejects(sendBackSiteVisit(admin, SITE, "  ", { id: APPROVER, label: "Sara" }), /what the inspector should change/);
  await sendBackSiteVisit(admin, SITE, "Count the AC units again", { id: APPROVER, label: "Sara" });
  const row = fake.table("amc_assessments")[0];
  assert.equal(row.status, "draft");
  assert.equal(row.completed_at, null);
  assert.equal(row.sent_back_reason, "Count the AC units again");
});

test("a site visit submitted from the mobile app cannot be changed, its approver included (23 Nov 2026)", async () => {
  const { admin, fake } = setup();
  const { updateAssessment } = await import("@/lib/server/amc/business");
  await assert.rejects(
    updateAssessment(admin as never, { userId: APPROVER, canApprove: true }, SITE, { approverId: INSPECTOR }),
    (e: Error & { status?: number }) => e.status === 409 && /submitted this site visit/.test(e.message),
  );
  assert.equal(fake.table("amc_assessments")[0].approver_id, APPROVER, "the approver named at submission stays");
});

test("approving many changes costs a handful of database calls, not four a change, and a retry adds nothing twice (26 Nov 2026)", async () => {
  const { admin, fake } = setup();
  const id = (n: number) => `77777777-7777-4777-8777-${String(n).padStart(12, "0")}`;
  /* Four new assets and six new scope items, two of them on a new asset: ten changes, as ASM-2026-0001 on live. */
  for (let n = 0; n < 4; n++) fake.table("amc_site_visit_changes").push({ assessment_id: SITE, entity: "asset", target_id: id(n), op: "insert", payload: { ...asset, location: `Room ${n}` }, updated_at: `2026-11-16T08:0${n}:00Z`, applied_at: null });
  for (let n = 4; n < 10; n++) fake.table("amc_site_visit_changes").push({ assessment_id: SITE, entity: "scope", target_id: id(n), op: "insert", payload: { ...scope, assetId: n < 6 ? id(0) : null }, updated_at: `2026-11-16T08:1${n - 4}:00Z`, applied_at: null });
  const client = fake.client as unknown as { from: (t: string) => unknown };
  const from = client.from.bind(client);
  let calls = 0;
  client.from = (t: string) => (calls++, from(t));

  await approveSiteVisit(admin, SITE, { id: APPROVER, label: "Sara" });
  assert.equal(fake.table("amc_property_assets").length, 4);
  assert.equal(fake.table("amc_scope_items").filter((r) => String(r.id).startsWith("77777777")).length, 6);
  assert.ok(fake.table("amc_site_visit_changes").every((r) => r.applied_at), "every change marked applied");
  /* The same approval with nothing held: what the changes themselves cost on top. */
  const bare = setup();
  const bareClient = bare.fake.client as unknown as { from: (t: string) => unknown };
  const bareFrom = bareClient.from.bind(bareClient);
  let bareCalls = 0;
  bareClient.from = (t: string) => (bareCalls++, bareFrom(t));
  await approveSiteVisit(bare.admin, SITE, { id: APPROVER, label: "Sara" });
  assert.ok(calls - bareCalls <= 9, `${calls - bareCalls} calls for ten changes (was 40, four a change)`);

  /* A retry after a failure before the "applied" mark: the same ids are skipped, not added again. */
  for (const r of fake.table("amc_site_visit_changes")) r.applied_at = null;
  fake.table("amc_assessments")[0].approved_at = null;
  await approveSiteVisit(admin, SITE, { id: APPROVER, label: "Sara" });
  assert.equal(fake.table("amc_property_assets").length, 4);
  assert.equal(fake.table("amc_scope_items").filter((r) => String(r.id).startsWith("77777777")).length, 6);
});
