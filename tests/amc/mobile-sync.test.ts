import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { shortPlace } from "@/lib/amc/field-visits";
import {
  MOBILE_LIST_STAGES,
  detailVersion,
  isSiteMutation,
  workOf,
  doneCursorFilter,
  listOfStage,
  siteApprovalState,
  shownOnPhone,
  SHOWN_ON_PHONE_FILTER,
  mobileListQuerySchema,
  mobileMutationSchema,
  onCrew,
  parseMobileMutation,
  toMobileCard,
  type FieldVisitViewRow,
} from "@/lib/amc/mobile-sync";

const row = (over: Partial<FieldVisitViewRow> = {}): FieldVisitViewRow => ({
  kind: "ppm",
  id: "11111111-1111-4111-8111-111111111111",
  ref: "AMC-2026-0001 · V2",
  customer_name: "Keely Clark",
  property_label: "Villa 12, Al Barsha — Street 4, Dubai",
  status: "scheduled",
  stage: "planned",
  day: "2026-11-12",
  scheduled_start: "2026-11-12T05:00:00+00:00",
  scheduled_end: "2026-11-12T07:00:00+00:00",
  trade: null,
  ...over,
});

test("the crew's live work is Active; with the supervisor or finished is Done; cancelled leaves the phone", () => {
  assert.equal(listOfStage("planned"), "active");
  assert.equal(listOfStage("in_progress"), "active", "a returned sheet puts the visit back in progress");
  assert.equal(listOfStage("review"), "done");
  assert.equal(listOfStage("done"), "done");
  assert.equal(listOfStage("cancelled"), null);
  const all = [...MOBILE_LIST_STAGES.active, ...MOBILE_LIST_STAGES.done];
  assert.equal(new Set(all).size, all.length, "no stage is on both lists");
});

test("a card carries only what it shows, with the short place and the services count", () => {
  const card = toMobileCard(row(), 3)!;
  assert.deepEqual(Object.keys(card).sort(), [
    "customer", "day", "id", "kind", "list", "place", "ref", "scheduled_end", "scheduled_start", "services", "stage", "status", "status_label", "trade",
  ]);
  assert.equal(card.place, "Villa 12, Al Barsha");
  assert.equal(card.services, 3);
  assert.equal(card.status_label, "Scheduled");
  assert.equal(card.list, "active");
});

test("a call out or additional work counts its one trade; a site visit none; no place falls back to the reference", () => {
  assert.equal(toMobileCard(row({ kind: "call_out", status: "scheduled", trade: "ac" }), 0)!.services, 1);
  assert.equal(toMobileCard(row({ kind: "additional_work", status: "scheduled", trade: null }), 0)!.services, 0);
  assert.equal(toMobileCard(row({ kind: "site_visit", status: "draft", trade: null }), 5)!.services, 0);
  assert.equal(toMobileCard(row({ property_label: "  " }), 1)!.place, "AMC-2026-0001 · V2");
  assert.equal(toMobileCard(row({ stage: "cancelled" }), 1), null);
});

test("shortPlace is the same rule for the portal's headers and the phone's cards", () => {
  assert.equal(shortPlace("Tower A — Business Bay"), "Tower A");
  assert.equal(shortPlace(null), null);
  assert.ok((shortPlace("x".repeat(80)) ?? "").length <= 46);
});

test("Done pages by (day, id), so cards on the same day are never skipped or repeated", () => {
  assert.equal(doneCursorFilter("2026-11-10", "abc"), "day.lt.2026-11-10,and(day.eq.2026-11-10,id.lt.abc)");
  assert.equal(doneCursorFilter("2026-11-10", undefined), "day.lt.2026-11-10");
  assert.equal(mobileListQuerySchema.parse({}).list, "active");
  assert.equal(mobileListQuerySchema.parse({ list: "done", limit: "10" }).limit, 10);
  assert.equal(mobileListQuerySchema.safeParse({ limit: "500" }).success, false, "a page is capped");
  assert.equal(mobileListQuerySchema.safeParse({ before: "2026-11-10'; drop" }).success, false, "the cursor is a day, nothing else");
});

test("only the technician on the crew is let in", () => {
  assert.equal(onCrew({ technician_ids: ["101", "102"], lead_technician_id: "101" }, "102"), true);
  assert.equal(onCrew({ technician_ids: [], lead_technician_id: "103" }, "103"), true);
  assert.equal(onCrew({ technician_ids: ["101"] }, "999"), false);
  assert.equal(onCrew({ technician_ids: ["101"] }, null), false, "an account with no linked technician is on no crew");
});

test("the version moves with the visit, its sheet and its photos", () => {
  const base = { visitUpdatedAt: "a", sheetUpdatedAt: "b", photoCount: 2, latestPhotoAt: "c" };
  assert.equal(detailVersion(base), detailVersion({ ...base }));
  assert.notEqual(detailVersion(base), detailVersion({ ...base, sheetUpdatedAt: "b2" }));
  assert.notEqual(detailVersion(base), detailVersion({ ...base, photoCount: 1 }), "a photo removed on the portal");
  assert.notEqual(detailVersion(base), detailVersion({ ...base, sheetUpdatedAt: null }));
});

test("a push accepts the four AMC changes and nothing else", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const sheet = { lines: [], checklist: [] };
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_sheet", entity_id: visit, op: "update", payload: { visit_id: visit, sheet } }).success, true);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_submit", entity_id: visit, op: "insert", payload: { visit_id: visit, sheet } }).success, true);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "insert", payload: { visit_id: visit, kind: "before" } }).success, true);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "delete", payload: { visit_id: visit } }).success, true);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "insert", payload: { visit_id: visit, kind: "selfie" } }).success, false);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "snag", entity_id: id, op: "insert", payload: {} }).success, false);
  assert.equal(mobileMutationSchema.safeParse({ mutation_id: id, entity: "amc_sheet", entity_id: visit, op: "delete", payload: { visit_id: visit, sheet } }).success, false, "a sheet is never deleted from the phone");
});

test("a refused change says what is wrong with it, not a union's 'Invalid input'", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const bad = parseMobileMutation({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "insert", payload: { visit_id: visit, kind: "selfie" } });
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /^payload\.kind: /);
  const unknown = parseMobileMutation({ mutation_id: id, entity: "amc_sheet", entity_id: visit, op: "delete", payload: {} });
  assert.equal(unknown.ok ? "" : unknown.error, "Unknown change: amc_sheet delete");
  const good = parseMobileMutation({ mutation_id: id, entity: "amc_sheet", entity_id: visit, op: "update", payload: { visit_id: visit, sheet: { lines: [], checklist: [] } } });
  assert.equal(good.ok, true);
});

test("a site visit's survey is saved by its assessor, own checks included, and nothing the office owns", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const site = {
    assessedOn: "2026-11-13",
    attendance: "attended",
    items: [{ itemKey: "ac_condition", result: "ok", notes: null }],
    customItems: [{ itemKey: "custom-1a2b3c4d-5e6f", categoryLabel: "Added on site", label: "Water heater" }],
  };
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site", entity_id: visit, op: "update", payload: { visit_id: visit, site } }).ok, true);
  const officeKey = parseMobileMutation({
    mutation_id: id,
    entity: "amc_site",
    entity_id: visit,
    op: "update",
    payload: { visit_id: visit, site: { ...site, customItems: [{ itemKey: "ac_condition", categoryLabel: "x", label: "y" }] } },
  });
  assert.equal(officeKey.ok, false, "a check added on site can never take an office checklist key");
  const assessor = parseMobileMutation({ mutation_id: id, entity: "amc_site", entity_id: visit, op: "update", payload: { visit_id: visit, site: { assessorId: id } } });
  assert.equal(assessor.ok, false, "the assessor, client, property and booking stay with the office");
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site_complete", entity_id: visit, op: "insert", payload: { visit_id: visit } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site_photo", entity_id: id, op: "insert", payload: { visit_id: visit } }).ok, true);
});

test("the property's assets and scope, and photo descriptions, go through the portal's own schemas", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const asset = { assetType: "Split AC", trade: "ac", quantity: 2, location: "Bedroom", make: null, model: null, serialNo: null, capacity: null, installedOn: null, condition: "good", notes: null };
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_asset", entity_id: id, op: "insert", payload: { visit_id: visit, asset } }).ok, true);
  const serialTwo = parseMobileMutation({ mutation_id: id, entity: "amc_asset", entity_id: id, op: "update", payload: { visit_id: visit, asset: { ...asset, serialNo: "SN1" } } });
  assert.equal(serialTwo.ok, false, "a serial number is one unit, as on the portal");
  const noProperty = parseMobileMutation({ mutation_id: id, entity: "amc_asset", entity_id: id, op: "insert", payload: { visit_id: visit, property_id: visit, asset } });
  assert.equal(noProperty.ok, false, "the property comes from the site visit, never from the phone");
  const scope = { serviceId: "ac-ppm", trade: "ac", assetId: null, quantity: 2, frequencyPerYear: 4, durationMinutes: null, preferredMonths: [], preferredDays: [], exclusions: null, notes: null };
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_scope", entity_id: id, op: "insert", payload: { visit_id: visit, scope } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_scope", entity_id: id, op: "delete", payload: { visit_id: visit } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site_photo", entity_id: id, op: "update", payload: { visit_id: visit, caption: "Water heater" } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "update", payload: { visit_id: visit, caption: null } }).ok, true);
});

test("photos carry a category; assets and scope are a site visit's only", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const asset = { assetType: "Split AC", trade: "ac", quantity: 2, location: "Bedroom", make: null, model: null, serialNo: null, capacity: null, installedOn: null, condition: "good", notes: null };
  const onVisit = parseMobileMutation({ mutation_id: id, entity: "amc_asset", entity_id: id, op: "insert", payload: { visit_id: visit, visit_kind: "ppm", asset } });
  assert.equal(onVisit.ok, false, "a planned visit does not change its property from the phone");
  const onSite = parseMobileMutation({ mutation_id: id, entity: "amc_scope", entity_id: id, op: "delete", payload: { visit_id: visit } });
  assert.equal(onSite.ok && isSiteMutation(onSite.value), true, "checked against the site visit's assessor");
  const photo = parseMobileMutation({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "insert", payload: { visit_id: visit, kind: "other", category: "Water tank", caption: "Overflowing" } });
  assert.equal(photo.ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site_photo", entity_id: id, op: "update", payload: { visit_id: visit, caption: null, category: "Equipment" } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "update", payload: { visit_id: visit, caption: "x", category: "Fault", kind: "fault" } }).ok, true);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_site_photo", entity_id: id, op: "update", payload: { visit_id: visit, caption: null, kind: "fault" } }).ok, false, "a site visit photo has no kind");
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_photo", entity_id: id, op: "insert", payload: { visit_id: visit, kind: "other", category: "x".repeat(61) } }).ok, false, "a category name is at most 60 characters");
});

test("a call out's attendance and report, an additional work's completion and their photos come from the crew", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  const visit = "11111111-1111-4111-8111-111111111111";
  const attend = parseMobileMutation({ mutation_id: id, entity: "amc_callout_attend", entity_id: visit, op: "insert", payload: { visit_id: visit, attended_at: "2026-11-16T09:00:00.000Z" } });
  assert.equal(attend.ok, true);
  assert.equal(attend.ok && workOf(attend.value), "call_out");
  const report = { diagnosis: "Compressor tripped", resolution: "Reset and cleaned", partsNeeded: null, minutesOnSite: 45, pendingWorks: [], outcome: "resolved" };
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_callout_record", entity_id: visit, op: "insert", payload: { visit_id: visit, report } }).ok, true);
  assert.equal(
    parseMobileMutation({ mutation_id: id, entity: "amc_callout_record", entity_id: visit, op: "insert", payload: { visit_id: visit, report: { ...report, outcome: "closed" } } }).ok,
    false,
    "the crew records resolved or pending works; closing stays with the office",
  );
  const done = parseMobileMutation({ mutation_id: id, entity: "amc_work_complete", entity_id: visit, op: "insert", payload: { visit_id: visit, completed_at: "2026-11-16T12:00:00.000Z" } });
  assert.equal(done.ok && workOf(done.value), "additional_work");
  const photo = parseMobileMutation({ mutation_id: id, entity: "amc_work_photo", entity_id: id, op: "insert", payload: { visit_id: visit, visit_kind: "additional_work", kind: "finding", category: "Leak" } });
  assert.equal(photo.ok && workOf(photo.value), "additional_work");
  assert.equal(photo.ok && isSiteMutation(photo.value), false);
  assert.equal(parseMobileMutation({ mutation_id: id, entity: "amc_work_photo", entity_id: id, op: "insert", payload: { visit_id: visit, visit_kind: "ppm", kind: "other" } }).ok, false);
});

test("the AMC sync routes take the app's bearer token, scope to the crew, and are open to the app like Snagging's", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  for (const route of ["app/api/amc-sync/visits/route.ts", "app/api/amc-sync/visits/[id]/route.ts", "app/api/amc-sync/push/route.ts"]) {
    const src = read(route);
    assert.match(src, /requireMobileTechnician\(req\)/, `${route} resolves the technician from the request`);
    assert.doesNotMatch(src, /requireContractAccess/, `${route} does not need AMC contract permissions`);
  }
  const server = read("lib/server/amc/mobile-sync.ts");
  assert.match(server, /getRequestUserAccess\(req\)/);
  assert.match(server, /ResourceType\.MOBILE_APP, ActionType\.VIEW/);
  assert.match(server, /user_profile_id/, "the technician comes from the account link, never from the request");
  assert.match(read("middleware.ts"), /"\/api\/amc-sync\/"/);
});

test("a site visit's approval reads as sent back, awaiting approval or approved", () => {
  const base = { approverId: "u1", approvedAt: null, sentBackAt: null };
  assert.equal(siteApprovalState({ ...base, status: "draft" }), null);
  assert.equal(siteApprovalState({ ...base, status: "draft", sentBackAt: "2026-11-16T10:00:00Z" }), "sent_back");
  assert.equal(siteApprovalState({ ...base, status: "completed", sentBackAt: "2026-11-16T10:00:00Z" }), "awaiting_approval");
  assert.equal(siteApprovalState({ ...base, status: "completed", approvedAt: "2026-11-16T11:00:00Z" }), "approved");
  // Booked before approvals: completed is just completed.
  assert.equal(siteApprovalState({ ...base, approverId: null, status: "completed" }), null);

  const row = {
    kind: "site_visit" as const, id: "a1", ref: "ASM-1", customer_name: null, property_label: "14 East New Street",
    status: "draft", stage: "in_progress" as const, day: "2026-11-18", scheduled_start: null, scheduled_end: null, trade: null,
  };
  const card = toMobileCard(row, 0, "sent_back");
  assert.equal(card?.status, "sent_back");
  assert.equal(card?.status_label, "Sent back");
  assert.equal(toMobileCard(row, 0)?.status_label, "Draft");
});

test("a visit the office has not started is not on the phone (site visits excepted)", () => {
  // A planned visit: by its stage.
  for (const stage of ["to_plan", "planned", "confirmed"] as const) assert.equal(shownOnPhone({ kind: "ppm", stage }), false, stage);
  assert.equal(shownOnPhone({ kind: "ppm", stage: "in_progress" }), true);
  // Started by the office, the crew not there yet: the stage stays planned, the stamp says started.
  assert.equal(shownOnPhone({ kind: "ppm", stage: "planned", started_at: "2026-11-18T08:00:00Z" }), true);
  assert.equal(shownOnPhone({ kind: "ppm", stage: "planned", started_at: null }), false);
  // A call out or additional work: by the office's Start visit, whatever the stage (the crew moves the stage on site).
  for (const kind of ["call_out", "additional_work"] as const) {
    assert.equal(shownOnPhone({ kind, stage: "planned", started_at: null }), false);
    assert.equal(shownOnPhone({ kind, stage: "planned", started_at: "2026-11-18T08:00:00Z" }), true);
    // Before the started_at column exists: shown, as before.
    assert.equal(shownOnPhone({ kind, stage: "planned" }), true);
  }
  // The assessor starts a site visit on the phone: it shows while planned.
  assert.equal(shownOnPhone({ kind: "site_visit", stage: "planned", started_at: null }), true);
  assert.equal(SHOWN_ON_PHONE_FILTER, "kind.eq.site_visit,and(kind.eq.ppm,stage.not.in.(to_plan,planned,confirmed)),started_at.not.is.null");
});
