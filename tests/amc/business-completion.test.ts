import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AMC_EVENT_POLICY,
  AMC_NOTIFICATION_DEFAULTS,
  amcMessage,
  dedupeKey,
  dueExpiryThresholds,
  emailEnabledFor,
  entitlementAlert,
} from "@/lib/amc/notifications";
import { notifyAmc, notifyContractEvent, notifyEntitlementState, notifyProposalEvent } from "@/lib/server/amc/notifications";
import {
  ArchiveError,
  archiveSignedContract,
  buildSignedContractContent,
  canAccessSignedArchive,
  contentHash,
  renderSignedContractHtml,
} from "@/lib/server/amc/signed-archive";
import { AMC_PHOTOS_PER_ASSESSMENT, checkPhotoRemoval, checkPhotoUpload, detectImageType } from "@/lib/amc/photos";
import { looksLikePlaceholderContact, signedCommitments } from "@/lib/amc/commitments";
import { computeAmcPricing } from "@/lib/amc/pricing";
import { priceSubmission, submittableProblem } from "@/lib/server/amc/pricing";
import { getAmcSettingsDefaults } from "@/components/dashboard/extensions/amc/amc-settings";
import type { AmcSubmission } from "@/components/dashboard/extensions/amc/amc-types";

import { fakeSupabase } from "./fake-supabase";

/*
  AMC business completion (6 Oct 2026): notifications, the signed-contract
  archive, assessment photos, expiry reminders, signed commitments and
  build-your-own plans. The database rules behind them (dedupe key,
  immutability, draft-only photos, private bucket) are checked on a local
  PostgreSQL by scripts/amc-db-harness.
*/

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const role = (name: string, approve = false) => ({
  name,
  role_access: approve ? [{ resource: "amc", action: "approve", enabled: true }] : [],
});

function world(extra: Record<string, Record<string, unknown>[]> = {}) {
  return fakeSupabase(
    {
      user_profile: [
        { id: "u-owner", email: "owner@test.local", full_name: "Olivia Owner", is_active: true, roles: role("sales") },
        { id: "u-appr", email: "approver@test.local", full_name: "Adam Approver", is_active: true, roles: role("manager", true) },
        { id: "u-admin", email: "admin@test.local", full_name: "Ada Admin", is_active: true, roles: role("admin") },
        { id: "u-gone", email: "gone@test.local", full_name: "Gone", is_active: false, roles: role("manager", true) },
      ],
      amc_submissions: [
        {
          id: "s-1",
          owner_id: "u-owner",
          proposal_number: "AMC-2026-0042",
          customer: { customerName: "Villa Owner" },
          property: { propertyAddress: "Villa 12, Street 4" },
        },
      ],
      amc_contracts: [
        {
          id: "c-1",
          proposal_number: "AMC-2026-0042",
          customer_name: "Villa Owner",
          property_label: "Villa 12, Street 4",
          end_date: "2026-11-01",
          amc_submissions: { owner_id: "u-owner" },
        },
      ],
      amc_contract_entitlements: [
        { id: "e-visits", contract_id: "c-1", service_label: "AC maintenance", entitlement_type: "visits", included_quantity: 4, used_quantity: 3 },
        { id: "e-out", contract_id: "c-1", service_label: "Plumbing", entitlement_type: "visits", included_quantity: 2, used_quantity: 2 },
        { id: "e-unl", contract_id: "c-1", service_label: "Emergency", entitlement_type: "unlimited", included_quantity: null, used_quantity: 9 },
        { id: "e-info", contract_id: "c-1", service_label: "Helpdesk", entitlement_type: "informational", included_quantity: null, used_quantity: 0 },
      ],
      ...extra,
    },
    {
      unique: {
        amc_notifications: [["dedupe_key", "channel", "recipient_key"]],
        amc_signed_documents: [["submission_id", "document_type"]],
      },
      generated: {
        amc_notifications: (r) => ({
          recipient_key: (r.recipient_user_id as string | null) ?? String(r.recipient_email ?? "").toLowerCase(),
        }),
      },
    },
  );
}

const inbox = (w: ReturnType<typeof world>, channel: "in_app" | "email") =>
  w.table("amc_notifications").filter((n) => n.channel === channel);

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

test("a submission notifies the approvers (in-app and email), not its submitter or inactive users", async () => {
  const w = world();
  const r = await notifyProposalEvent(w.client as never, {
    event: "proposal_submitted",
    submissionId: "s-1",
    actor: { id: "u-owner", label: "Olivia Owner" },
    at: "2026-10-06T08:00:00Z",
  });
  const inApp = inbox(w, "in_app").map((n) => n.recipient_user_id).sort();
  assert.deepEqual(inApp, ["u-admin", "u-appr"]);
  assert.equal(inbox(w, "email").length, 2, "workflow emails are on by default");
  assert.equal(r.created, 4);
  assert.match(String(inbox(w, "in_app")[0].title), /AMC-2026-0042 needs your approval/);
  assert.equal(inbox(w, "in_app")[0].link, "/extensions/amc/s-1");
  assert.ok(w.table("amc_audit_events").some((a) => a.event_type === "notification_created"), "audited");
});

test("a retried event writes and emails nothing new; a resubmission is a new event", async () => {
  const w = world();
  const input = { event: "proposal_submitted" as const, submissionId: "s-1", actor: { id: "u-owner", label: null }, at: "2026-10-06T08:00:00Z" };
  const first = await notifyProposalEvent(w.client as never, input);
  const again = await notifyProposalEvent(w.client as never, input);
  assert.equal(first.created, 4);
  assert.equal(again.created, 0, "same dedupe key, recipient and channel");
  assert.equal(again.emailed + again.failed, 0, "no second email attempt");
  const resubmitted = await notifyProposalEvent(w.client as never, { ...input, at: "2026-10-07T08:00:00Z" });
  assert.equal(resubmitted.created, 4, "a later round notifies again");
});

test("approval and send-back notify the owner; send-back carries the reason", async () => {
  const w = world();
  await notifyProposalEvent(w.client as never, { event: "proposal_approved", submissionId: "s-1", actor: { id: "u-appr", label: "Adam Approver" }, at: "t1" });
  await notifyProposalEvent(w.client as never, {
    event: "proposal_sent_back",
    submissionId: "s-1",
    actor: { id: "u-appr", label: "Adam Approver" },
    at: "t2",
    facts: { reason: "Add the water pump" },
  });
  const rows = inbox(w, "in_app");
  assert.deepEqual([...new Set(rows.map((r) => r.recipient_user_id))], ["u-owner"]);
  const sentBack = rows.find((r) => r.event === "proposal_sent_back")!;
  assert.match(String(sentBack.body), /Reason: Add the water pump/);
  assert.match(String(sentBack.body), /by Adam Approver/);
});

test("self-approval does not notify the person who acted", async () => {
  const w = world();
  const r = await notifyProposalEvent(w.client as never, { event: "proposal_approved", submissionId: "s-1", actor: { id: "u-owner", label: null }, at: "t" });
  assert.equal(r.created, 0);
});

test("client approval and rejection notify the owner, with the client's reason", async () => {
  const w = world();
  await notifyProposalEvent(w.client as never, { event: "client_approved", submissionId: "s-1", actor: null, at: "t1", facts: { signedByName: "Villa Owner" } });
  await notifyProposalEvent(w.client as never, {
    event: "client_rejected",
    submissionId: "s-1",
    actor: null,
    at: "t2",
    facts: { signedByName: "Villa Owner", reason: "Too expensive" },
  });
  const rows = inbox(w, "in_app");
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.recipient_user_id === "u-owner"));
  assert.match(String(rows.find((r) => r.event === "client_rejected")!.body), /Reason given: Too expensive/);
});

test("a signature notifies owner and approvers with number, customer, property, name and time, and no client link", async () => {
  const w = world();
  await notifyProposalEvent(w.client as never, {
    event: "contract_signed",
    submissionId: "s-1",
    actor: null,
    at: "2026-10-06T10:15:00.000Z",
    facts: { signedByName: "Villa Owner", signedAt: "2026-10-06T10:15:00.000Z" },
  });
  const rows = inbox(w, "in_app");
  assert.deepEqual(rows.map((r) => r.recipient_user_id).sort(), ["u-admin", "u-appr", "u-owner"]);
  const body = String(rows[0].body);
  for (const part of ["AMC-2026-0042", "Villa Owner", "Villa 12, Street 4", "typed name", "6 Oct 2026, 14:15"]) assert.ok(body.includes(part), part);
  for (const r of w.table("amc_notifications")) {
    assert.doesNotMatch(`${r.title} ${r.body} ${r.link}`, /\/amc\/[A-Za-z0-9_-]{20,}|token/i, "no client token or link");
  }
});

test("email is skipped when workflow emails are switched off; in-app still recorded", async () => {
  const w = world({ amc_notification_settings: [{ id: 1, workflow_email_enabled: false, reminder_thresholds: [60, 30, 15], reminder_recipients: ["owner"], reminder_channels: ["in_app"], reminder_extra_emails: [] }] });
  await notifyProposalEvent(w.client as never, { event: "proposal_submitted", submissionId: "s-1", actor: { id: "u-owner", label: null }, at: "t" });
  assert.equal(inbox(w, "email").length, 0);
  assert.equal(inbox(w, "in_app").length, 2);
});

test("event policy: who hears about what, and which emails are gated", () => {
  assert.equal(AMC_EVENT_POLICY.proposal_submitted.audience, "approvers");
  assert.equal(AMC_EVENT_POLICY.proposal_sent_back.audience, "owner");
  assert.equal(AMC_EVENT_POLICY.contract_signed.audience, "owner_and_approvers");
  assert.equal(emailEnabledFor("proposal_submitted", AMC_NOTIFICATION_DEFAULTS), true);
  assert.equal(emailEnabledFor("entitlement_low", AMC_NOTIFICATION_DEFAULTS), false, "allowance emails off until confirmed");
  assert.equal(emailEnabledFor("contract_expiring", AMC_NOTIFICATION_DEFAULTS), false, "reminder emails off until confirmed");
  assert.equal(emailEnabledFor("proposal_sent", AMC_NOTIFICATION_DEFAULTS), false);
  assert.equal(AMC_NOTIFICATION_DEFAULTS.reminderAutoEnabled, false, "automatic reminders off by default");
  assert.deepEqual(AMC_NOTIFICATION_DEFAULTS.reminderThresholds, [60, 30, 15]);
});

test("messages never claim more than the facts, and dedupe keys separate rounds", () => {
  assert.equal(dedupeKey("entitlement_low", { contractId: "c", entitlementId: "e" }), "entitlement_low:e");
  assert.equal(dedupeKey("contract_expiring", { contractId: "c", threshold: 30 }), "contract_expiring:c:30");
  assert.notEqual(dedupeKey("proposal_submitted", { submissionId: "s", at: "a" }), dedupeKey("proposal_submitted", { submissionId: "s", at: "b" }));
  assert.match(amcMessage("client_rejected", { proposalNumber: "P" }).body, /^The client rejected P\.$/);
});

/* ------------------------------------------------------------------ */
/* Allowances                                                          */
/* ------------------------------------------------------------------ */

test("allowance alerts: low at 25% left, exhausted at none; unlimited and informational never alert", () => {
  assert.equal(entitlementAlert({ entitlementType: "visits", includedQuantity: 4, usedQuantity: 3 }), "entitlement_low");
  assert.equal(entitlementAlert({ entitlementType: "hours", includedQuantity: 12, usedQuantity: 12 }), "entitlement_exhausted");
  assert.equal(entitlementAlert({ entitlementType: "visits", includedQuantity: 4, usedQuantity: 1 }), null);
  assert.equal(entitlementAlert({ entitlementType: "unlimited", includedQuantity: null, usedQuantity: 40 }), null);
  assert.equal(entitlementAlert({ entitlementType: "informational", includedQuantity: null, usedQuantity: 0 }), null);
  assert.equal(entitlementAlert({ entitlementType: "visits", includedQuantity: 0, usedQuantity: 0 }), null, "no allowance, no alert");
});

test("allowance alerts are state-based: recorded once per state, not on every check", async () => {
  const w = world();
  await notifyEntitlementState(w.client as never, "c-1", "e-visits", null);
  await notifyEntitlementState(w.client as never, "c-1", "e-visits", null);
  await notifyEntitlementState(w.client as never, "c-1", "e-out", null);
  await notifyEntitlementState(w.client as never, "c-1", "e-unl", null);
  await notifyEntitlementState(w.client as never, "c-1", "e-info", null);
  const rows = inbox(w, "in_app");
  assert.deepEqual(rows.map((r) => r.event).sort(), ["entitlement_exhausted", "entitlement_low"]);
  assert.match(String(rows.find((r) => r.event === "entitlement_low")!.body), /1 visit left/);
  assert.equal(inbox(w, "email").length, 0, "allowance email off by default");
});

/* ------------------------------------------------------------------ */
/* Expiry reminders                                                    */
/* ------------------------------------------------------------------ */

test("expiry thresholds come due as the end date nears, and never after it", () => {
  assert.deepEqual(dueExpiryThresholds("2026-12-01", "2026-10-06", [60, 30, 15]), [60]);
  assert.deepEqual(dueExpiryThresholds("2026-10-16", "2026-10-06", [60, 30, 15]), [60, 30, 15]);
  assert.deepEqual(dueExpiryThresholds("2027-06-01", "2026-10-06", [60, 30, 15]), []);
  assert.deepEqual(dueExpiryThresholds("2026-10-01", "2026-10-06", [60, 30, 15]), [], "already ended");
  assert.deepEqual(dueExpiryThresholds("2026-11-05", "2026-10-06", [30, 30, 0, -5]), [30], "junk thresholds ignored");
});

test("a reminder for the same contract, threshold, recipient and channel is recorded once", async () => {
  const w = world();
  const remind = () =>
    notifyContractEvent(w.client as never, {
      event: "contract_expiring",
      contractId: "c-1",
      threshold: 30,
      actor: null,
      recipients: [{ userId: "u-owner", email: "owner@test.local", name: "Olivia" }],
      emailEnabled: false,
      facts: { daysLeft: 26 },
    });
  assert.equal((await remind()).created, 1);
  assert.equal((await remind()).created, 0);
  assert.equal(inbox(w, "email").length, 0);
  assert.match(String(inbox(w, "in_app")[0].title), /ends in 26 days/);
});

/* ------------------------------------------------------------------ */
/* Signed archive                                                      */
/* ------------------------------------------------------------------ */

function signedRow(overrides: Partial<AmcSubmission> & Record<string, unknown> = {}) {
  const settings = getAmcSettingsDefaults();
  return {
    id: "s-1",
    owner_id: "u-owner",
    status: "signed",
    proposal_number: "AMC-2026-0042",
    property: { propertyCategory: "residential", unitType: "villa", propertyAddress: "Villa 12, Street 4", propertyDetail: "" },
    customer: {
      customerName: "Villa Owner",
      customerId: "YFI1806",
      customerPhone: "0500000000",
      customerEmail: "owner@example.com",
      coordinationContacts: [
        { name: "Cora Coordinator", phone: "0501111111", designation: "owner" },
        { name: "", phone: "", designation: "tenant" },
      ],
      startDate: "2026-10-01",
      endDate: "2027-09-30",
      paymentTerms: "annual",
      proposalNumber: "AMC-2026-0042",
    },
    document_options: {
      optionalSections: { supplyInstallPriceList: false, additionalFixedPriceServices: false },
      priceListRows: [],
      accountManagers: [
        { name: "Sara Khan", phone: "0502222222" },
        { name: "", phone: "" },
      ],
    },
    services: [
      { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: null, free: true, price: 0 },
      { serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 250, price: 2000 },
    ],
    discount_percent: 0,
    discount_amount: 0,
    final_price: 2000,
    generated_documents: [],
    settings_snapshot: settings,
    contract_settings_snapshot: { ...settings, provider: { ...settings.provider, address: "SNAPSHOT ADDRESS 77" } },
    contract_sent_at: "2026-10-02T08:00:00.000Z",
    signed_by_name: "Villa Owner",
    signed_at: "2026-10-03T10:15:00.000Z",
    created_at: "2026-09-30T08:00:00.000Z",
    updated_at: "2026-10-03T10:15:00.000Z",
    ...overrides,
  } as unknown as AmcSubmission & { proposal_number: string };
}

test("the archive is built from the contract's frozen wording, never today's settings", () => {
  const content = buildSignedContractContent(signedRow());
  const text = JSON.stringify(content.model);
  assert.ok(text.includes("SNAPSHOT ADDRESS 77"), "the wording as sent with the contract");
  assert.ok(!text.includes(getAmcSettingsDefaults().provider.address), "not the live/default address");
  assert.equal(content.settingsSource, "contract_settings_snapshot");
  assert.equal(content.signature.typedName, "Villa Owner");
  assert.equal(content.signature.signedAt, "2026-10-03T10:15:00.000Z");
  assert.equal(contentHash(content), contentHash(buildSignedContractContent(signedRow())), "deterministic content hash");
});

test("only a signed contract with saved wording can be archived", () => {
  assert.throws(() => buildSignedContractContent(signedRow({ status: "contract_sent" })), ArchiveError);
  assert.throws(
    () => buildSignedContractContent(signedRow({ contract_settings_snapshot: null, settings_snapshot: null })),
    /no saved wording/,
  );
  /* A contract sent before it had its own copy uses the proposal's. */
  assert.equal(buildSignedContractContent(signedRow({ contract_settings_snapshot: null })).settingsSource, "settings_snapshot");
});

test("the archived document presents the typed-name signature honestly", () => {
  const content = buildSignedContractContent(signedRow({ signed_by_name: "<b>Mallory</b>" }));
  const html = renderSignedContractHtml(content, "a".repeat(64));
  for (const label of ["Signed by", "Typed name", "Signed date", "Signed time", "3 October 2026", "14:15:00"]) {
    assert.ok(html.includes(label), label);
  }
  assert.ok(html.includes("&lt;b&gt;Mallory&lt;/b&gt;"), "the typed name is escaped");
  assert.ok(!html.includes("<b>Mallory</b>"));
  assert.match(html, /not a cryptographic digital signature/);
  assert.doesNotMatch(html, /digitally signed by|certified signature/i);
});

test("archiving stores the file privately once, with hashes and metadata, and audits without contents", async () => {
  const w = world({ amc_submissions: [signedRow() as unknown as Record<string, unknown>] });
  const pdf = new TextEncoder().encode("%PDF-1.4 fake");
  const first = await archiveSignedContract(w.client as never, "s-1", { when: "at_signing", actor: null, renderPdf: async () => pdf });
  assert.equal(first.contentType, "application/pdf");
  assert.equal(first.archivedWhen, "at_signing");
  assert.equal(first.signedByName, "Villa Owner");
  assert.match(first.fileSha256, /^[0-9a-f]{64}$/);
  assert.match(first.storagePath, /^signed-contracts\/s-1\/\d+-AMC-2026-0042-signed\.pdf$/);
  assert.equal(w.files.get(first.storagePath)?.bucket, "amc-documents");
  const again = await archiveSignedContract(w.client as never, "s-1", { when: "after_signing", actor: null, renderPdf: async () => pdf });
  assert.equal(again.id, first.id, "the first archive stands; nothing is replaced");
  assert.equal(w.files.size, 1);
  const audit = w.table("amc_audit_events").find((a) => a.event_type === "signed_document_archived")!;
  assert.ok(audit);
  assert.ok(!JSON.stringify(audit.payload).includes("PDF-1.4"), "no file contents in the audit");
});

test("without a browser the archive keeps the same content as HTML, and says so", async () => {
  const w = world({ amc_submissions: [signedRow() as unknown as Record<string, unknown>] });
  const record = await archiveSignedContract(w.client as never, "s-1", { when: "after_signing", actor: { id: "u-appr", label: "Adam" }, renderPdf: async () => null });
  assert.equal(record.contentType, "text/html");
  assert.equal(record.archivedWhen, "after_signing");
  assert.ok(new TextDecoder().decode(w.files.get(record.storagePath)!.body).includes("Electronic acceptance record"));
});

test("only the owner and approvers may open or create the archive", () => {
  assert.equal(canAccessSignedArchive({ userId: "u-owner", canApprove: false }, "u-owner"), true);
  assert.equal(canAccessSignedArchive({ userId: "u-appr", canApprove: true }, "u-owner"), true);
  assert.equal(canAccessSignedArchive({ userId: "u-other", canApprove: false }, "u-owner"), false);
  assert.equal(canAccessSignedArchive({ userId: "u-other", canApprove: false }, null), false);
});

/* ------------------------------------------------------------------ */
/* Assessment photos                                                   */
/* ------------------------------------------------------------------ */

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const SVG = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>");

test("photos are recognised by their bytes; SVG and anything else is refused", () => {
  assert.equal(detectImageType(JPEG), "image/jpeg");
  assert.equal(detectImageType(PNG), "image/png");
  assert.equal(detectImageType(WEBP), "image/webp");
  assert.equal(detectImageType(SVG), null);
  assert.equal(detectImageType(new Uint8Array()), null);
});

test("photos are added only to a draft, by its assessor or an approver, within limits", () => {
  const ok = { assessmentStatus: "draft", canEdit: true, existingCount: 0, bytes: JPEG };
  assert.deepEqual(checkPhotoUpload(ok), { ok: true, type: "image/jpeg" });
  assert.equal(checkPhotoUpload({ ...ok, assessmentStatus: "completed" }).ok, false, "completed assessments are history");
  const notEditor = checkPhotoUpload({ ...ok, canEdit: false });
  assert.equal(!notEditor.ok && notEditor.status, 403);
  assert.equal(checkPhotoUpload({ ...ok, existingCount: AMC_PHOTOS_PER_ASSESSMENT }).ok, false);
  assert.equal(checkPhotoUpload({ ...ok, bytes: new Uint8Array(10 * 1024 * 1024 + 1).fill(0xff) }).ok, false, "over 10 MB");
  assert.equal(checkPhotoUpload({ ...ok, bytes: SVG }).ok, false);
});

test("a completed assessment keeps its photos", () => {
  assert.deepEqual(checkPhotoRemoval({ assessmentStatus: "draft", canEdit: true }), { ok: true });
  const done = checkPhotoRemoval({ assessmentStatus: "completed", canEdit: true });
  assert.equal(!done.ok && done.status, 409);
});

/* ------------------------------------------------------------------ */
/* Signed commitments                                                  */
/* ------------------------------------------------------------------ */

test("support and response commitments come from the contract's snapshot", () => {
  const snapshot = getAmcSettingsDefaults();
  const c = signedCommitments({ provider: { ...snapshot.provider, standardResponseTime: "Within 6 hours (as signed)" } }, ["helpdesk", "ac-ppm"]);
  assert.equal(c.standardResponse, "Within 6 hours (as signed)");
  assert.equal(c.emergencyResponse, snapshot.provider.emergencyResponseTime);
  assert.equal(c.helpdeskIncluded, true);
  assert.equal(c.compliance, "unknown", "no performance is claimed");
  assert.equal(signedCommitments(null, []).fromSnapshot, false);
  assert.equal(signedCommitments(snapshot, ["ac-ppm"]).helpdeskIncluded, false);
  assert.equal(looksLikePlaceholderContact("800-PERFECT / 05X XXX XX"), true);
  assert.equal(looksLikePlaceholderContact("800 7373328"), false);
});

/* ------------------------------------------------------------------ */
/* Build-your-own plans                                                */
/* ------------------------------------------------------------------ */

test("custom plans: only ticked rows count, units and frequency multiply, the helpdesk is free", () => {
  const pricing = computeAmcPricing([
    { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: null, free: true },
    { serviceId: "ac-ppm", included: true, units: 3, frequency: 4, basePrice: 150 },
    { serviceId: "handyman", included: true, units: 1, frequency: 12, basePrice: 100 },
    { serviceId: "pest", included: false, units: 5, frequency: 4, basePrice: 999 },
  ]);
  assert.equal(pricing.rows.find((r) => r.serviceId === "ac-ppm")?.price, 1800);
  assert.equal(pricing.rows.find((r) => r.serviceId === "pest")?.price, 0, "an optional row left unticked costs nothing");
  assert.equal(pricing.subtotal, 3000);
  assert.equal(pricing.rows.find((r) => r.serviceId === "helpdesk")?.price, 0);
});

test("custom plans: the server re-prices, refuses services not offered, and needs prices on ticked rows", () => {
  const settings = getAmcSettingsDefaults();
  const result = priceSubmission({
    services: [
      { serviceId: "helpdesk", included: true, units: 1, frequency: 1, basePrice: null, free: true },
      { serviceId: "ac-ppm", included: true, units: 2, frequency: 4, basePrice: 250 },
    ],
    discountPercent: 10,
    unitType: "villa",
    settings,
  });
  assert.ok(result.ok);
  if (result.ok) assert.equal(result.final_price, 1800, "2 × 4 × 250 less 10%, whatever the browser claimed");
  const villaOnly = settings.services.find((s) => s.villaOnly);
  if (villaOnly) {
    const refused = priceSubmission({
      services: [{ serviceId: villaOnly.id, included: true, units: 1, frequency: 1, basePrice: 100 }],
      discountPercent: 0,
      unitType: "apartment",
      settings,
    });
    assert.equal(refused.ok, false, `${villaOnly.id} is villa-only`);
  }
  assert.match(String(submittableProblem([{ serviceId: "ac-ppm", included: true, basePrice: null }])), /base price/);
  assert.equal(
    submittableProblem([
      { serviceId: "ac-ppm", included: true, basePrice: 250 },
      { serviceId: "pest", included: false, basePrice: null },
    ]),
    null,
    "unticked optional rows need no price",
  );
  assert.match(String(submittableProblem([{ serviceId: "pest", included: false, basePrice: null }])), /at least one service/);
});

test("notifyAmc records nothing for an event with no recipients", async () => {
  const w = world();
  const r = await notifyAmc(w.client as never, { event: "renewal_created", contractId: "c-1", actor: null, facts: {}, recipients: [] });
  assert.equal(r.created, 0);
  assert.equal(w.table("amc_notifications").length, 0);
});
