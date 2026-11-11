import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DOCUMENT_CATEGORIES,
  UNIT_TYPES,
  UNIT_TYPE_CATEGORY,
  accessRuleSchema,
  assetSchema,
  consentSchema,
  contactSchema,
  detectDocumentType,
  documentExpiryState,
  documentMetaSchema,
  documentStoragePath,
  nextDocumentVersion,
  scopeItemSchema,
  wouldCreateParentLoop,
} from "@/lib/amc/client-profile";
import { customerSchema, propertySchema } from "@/lib/server/amc/business-schemas";

/* Phase 2 of the BRD v0.3 plan: client profile, properties, assets, access, scope, documents. */

const ID = "7b1f3c2a-4d5e-4f60-8a71-92b3c4d5e6f7";

test("property types: the BRD 5.2 list, each with its usual category", () => {
  for (const t of ["villa", "apartment", "townhouse", "restaurant", "clinic", "shop", "office"]) {
    assert.ok((UNIT_TYPES as readonly string[]).includes(t), t);
  }
  assert.equal(UNIT_TYPE_CATEGORY.restaurant, "commercial");
  assert.equal(UNIT_TYPE_CATEGORY.townhouse, "residential");
  assert.equal(propertySchema.safeParse({ label: "Shop 4", unitType: "clinic" }).success, true);
});

test("client and property forms: old payloads still pass; new fields are checked", () => {
  assert.equal(customerSchema.safeParse({ name: "Al Noor LLC" }).success, true, "the original fields alone");
  assert.equal(
    customerSchema.safeParse({ name: "Al Noor LLC", customerType: "company", lifecycle: "prospect", trn: "100123456700003", preferredChannel: "whatsapp" }).success,
    true,
  );
  assert.equal(customerSchema.safeParse({ name: "X", trn: "12345" }).success, false, "a TRN has 15 digits");
  assert.equal(customerSchema.safeParse({ name: "X", lifecycle: "lead" }).success, false);
  assert.equal(propertySchema.safeParse({ label: "Villa 1", zones: ["Kitchen"], floorsCount: 2, occupancy: "tenant", parentPropertyId: ID }).success, true);
  assert.equal(propertySchema.safeParse({ label: "Villa 1", occupancy: "landlord" }).success, false);
});

test("contacts: at least one way to reach them; roles from the BRD list", () => {
  assert.equal(contactSchema.safeParse({ role: "primary", name: "Sara" }).success, false);
  assert.equal(contactSchema.safeParse({ role: "accounts", name: "Sara", email: "sara@example.com" }).success, true);
  assert.equal(contactSchema.safeParse({ role: "tenant", name: "Omar", whatsapp: "0501234567" }).success, true);
  assert.equal(contactSchema.safeParse({ role: "boss", name: "Omar", phone: "1" }).success, false);
});

test("marketing consent needs how it was given", () => {
  assert.equal(consentSchema.safeParse({ consent: true, source: "" }).success, false);
  assert.equal(consentSchema.safeParse({ consent: false, source: "Phone call" }).success, true);
});

test("assets: a serial number means one unit; trades and conditions from the lists", () => {
  const base = { assetType: "Split AC", trade: "ac", quantity: 1, condition: "good" };
  assert.equal(assetSchema.safeParse(base).success, true);
  assert.equal(assetSchema.safeParse({ ...base, quantity: 4 }).success, true, "four identical units in one row");
  assert.equal(assetSchema.safeParse({ ...base, quantity: 2, serialNo: "SN-1" }).success, false);
  assert.equal(assetSchema.safeParse({ ...base, trade: "pool" }).success, false);
});

test("access rules: end after start; days 0-6", () => {
  const base = { accessType: "community_gate_pass", leadTimeDays: 2, permittedDays: [1, 2, 3] };
  assert.equal(accessRuleSchema.safeParse({ ...base, permittedFrom: "08:00", permittedTo: "17:00" }).success, true);
  assert.equal(accessRuleSchema.safeParse({ ...base, permittedFrom: "17:00", permittedTo: "08:00" }).success, false);
  assert.equal(accessRuleSchema.safeParse({ ...base, permittedDays: [7] }).success, false);
});

test("scope: preferred months 1-12 and days 0-6", () => {
  const base = { serviceId: "ac-ppm", trade: "ac", quantity: 3, preferredMonths: [1, 7], preferredDays: [0] };
  assert.equal(scopeItemSchema.safeParse(base).success, true);
  assert.equal(scopeItemSchema.safeParse({ ...base, preferredMonths: [13] }).success, false);
});

test("documents: categories per level; the real file type from its bytes", () => {
  assert.equal(documentMetaSchema.safeParse({ level: "customer", entityId: ID, category: "Trade licence", title: "Licence" }).success, true);
  assert.equal(documentMetaSchema.safeParse({ level: "customer", entityId: ID, category: "Title deed", title: "Deed" }).success, false, "a deed belongs to a property");
  assert.ok(DOCUMENT_CATEGORIES.property.includes("Access pass"));

  const pdf = new TextEncoder().encode("%PDF-1.7 ...");
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]);
  assert.equal(detectDocumentType(pdf, "anything.bin"), "application/pdf");
  assert.equal(detectDocumentType(png, "photo.pdf"), "image/png", "the bytes decide, not the name");
  assert.equal(detectDocumentType(zip, "contract.docx"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(detectDocumentType(zip, "data.zip"), null, "other zip files are refused");
  assert.equal(detectDocumentType(new TextEncoder().encode("<html><script>"), "fake.pdf"), null);
  assert.equal(detectDocumentType(new TextEncoder().encode("<svg onload=1>"), "logo.png"), null);
});

test("documents: versions count up; storage paths never use the file name; expiry states", () => {
  assert.equal(nextDocumentVersion([]), 1);
  assert.equal(nextDocumentVersion([1, 3, 2]), 4);
  const p = documentStoragePath("property", ID, "doc-1", "application/pdf");
  assert.equal(p, `documents/property/${ID}/doc-1.pdf`);
  assert.equal(documentExpiryState(null, "2026-10-07"), null);
  assert.equal(documentExpiryState("2026-10-01", "2026-10-07"), "expired");
  assert.equal(documentExpiryState("2026-10-20", "2026-10-07"), "expiring");
  assert.equal(documentExpiryState("2027-06-01", "2026-10-07"), null);
});

test("combined units: no loops, however long the chain", () => {
  const parentOf = new Map<string, string | null>([
    ["a", null],
    ["b", "a"],
    ["c", "b"],
  ]);
  assert.equal(wouldCreateParentLoop("a", "c", parentOf), true, "a under c, while c is under a");
  assert.equal(wouldCreateParentLoop("d", "c", parentOf), false);
  assert.equal(wouldCreateParentLoop("b", "b", parentOf), true);
  assert.equal(wouldCreateParentLoop("b", null, parentOf), false);
});

test("migration: new tables server-only, no cascade into AMC history, existing customers are clients", () => {
  const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261007120000_amc_client_property_assets.sql"), "utf8")
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  for (const t of ["amc_customer_contacts", "amc_communication_log", "amc_property_assets", "amc_property_access_rules", "amc_scope_items", "amc_documents"]) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t}`), t);
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), t);
  }
  assert.match(sql, /REVOKE ALL ON public\.amc_customer_contacts,[\s\S]*FROM anon, authenticated/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
  assert.match(sql, /lifecycle text NOT NULL DEFAULT 'client'/);
  assert.match(sql, /'villa', 'apartment', 'townhouse', 'restaurant', 'clinic', 'shop', 'office', 'warehouse', 'other'/);
  assert.match(sql, /amc_assessments_unit_type_check/, "assessments take the same list");
  assert.match(sql, /public = false\s+WHERE id = 'amc-documents'/, "the bucket stays private");
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|SECURITY DEFINER/);
});
