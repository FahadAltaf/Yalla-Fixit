import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";

import {
  AMC_DOCUMENT_MAX_BYTES,
  detectDocumentType,
  documentStoragePath,
  nextDocumentVersion,
  wouldCreateParentLoop,
  type accessRuleSchema,
  type assetSchema,
  type communicationSchema,
  type contactSchema,
  type documentMetaSchema,
  type DocumentLevel,
  type scopeItemSchema,
} from "@/lib/amc/client-profile";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { AMC_DOCUMENTS_BUCKET } from "@/lib/server/amc/signed-archive";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * Client profile, property extras and documents on the server (Phase 2:
 * DEV-348, 353, 360, 361, 379, 380, 381). Routes check the caller first
 * (lib/server/amc/customer-access.ts); these functions only do the work.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };

const NOT_MIGRATED = "The client profile is not set up on this database yet (migration 20261007170000).";
const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const blank = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

/* ------------------------------------------------------------------ */
/* Lifecycle and consent                                               */
/* ------------------------------------------------------------------ */

/** Records a lifecycle change (prospect → client → former) with who, when and why. */
export async function recordLifecycleChange(
  admin: Admin,
  customerId: string,
  from: string | null,
  to: string,
  actor: Actor,
  reason: string | null = null,
): Promise<void> {
  if (from === to) return;
  if (to === "client") {
    /* The client is Snagging's; the date AMC first counted them a client is
       on their AMC profile (20261007170000), made here if they have none. */
    const now = new Date().toISOString();
    await admin.from("amc_client_profiles").upsert({ client_id: customerId }, { onConflict: "client_id", ignoreDuplicates: true });
    await admin.from("amc_client_profiles").update({ became_client_at: now }).eq("client_id", customerId).is("became_client_at", null);
  }
  await recordStatusChange(admin, { entityType: "customer", entityId: customerId, from, to, reason, actor });
}

/** BRD 5.9: marketing consent kept apart from the contact details, with when, how and who. */
export async function setMarketingConsent(
  admin: Admin,
  customerId: string,
  input: { consent: boolean; source: string },
  actor: Actor,
): Promise<void> {
  const { data: before, error: readError } = await admin
    .from("amc_client_directory")
    .select("marketing_consent")
    .eq("id", customerId)
    .maybeSingle<{ marketing_consent: boolean | null }>();
  if (readError) throw fail(readError);
  if (!before) throw new ContractError("Client not found.", 404);
  /* Consent is AMC's, on the client's AMC profile (made if they have none). */
  const { error } = await admin.from("amc_client_profiles").upsert(
    {
      client_id: customerId,
      marketing_consent: input.consent,
      marketing_consent_at: new Date().toISOString(),
      marketing_consent_source: input.source.trim(),
      marketing_consent_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "client_id" },
  );
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: customerId,
    eventType: "marketing_consent_changed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { before: before.marketing_consent, after: input.consent, source: input.source.trim() },
  });
}

/* ------------------------------------------------------------------ */
/* Contacts                                                            */
/* ------------------------------------------------------------------ */

export interface ContactRecord {
  id: string;
  customerId: string;
  role: string;
  name: string;
  position: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
}

const CONTACT_COLUMNS = "id, customer_id, role, name, position, phone, whatsapp, email, notes, active, created_at";
const mapContact = (r: Row): ContactRecord => ({
  id: String(r.id),
  customerId: String(r.customer_id),
  role: String(r.role),
  name: String(r.name),
  position: str(r.position),
  phone: str(r.phone),
  whatsapp: str(r.whatsapp),
  email: str(r.email),
  notes: str(r.notes),
  active: r.active !== false,
  createdAt: String(r.created_at),
});

export async function listContacts(admin: Admin, customerId: string): Promise<{ contacts: ContactRecord[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_customer_contacts")
    .select(CONTACT_COLUMNS)
    .eq("customer_id", customerId)
    .order("active", { ascending: false })
    .order("role")
    .order("name");
  if (error) {
    if (notMigrated(error)) return { contacts: [], migrated: false };
    throw fail(error);
  }
  return { contacts: ((data ?? []) as Row[]).map(mapContact), migrated: true };
}

type ContactInput = z.infer<typeof contactSchema>;
const contactRow = (input: ContactInput) => ({
  role: input.role,
  name: input.name.trim(),
  position: blank(input.position),
  phone: blank(input.phone),
  whatsapp: blank(input.whatsapp),
  email: blank(input.email || null),
  notes: blank(input.notes),
  ...(input.active !== undefined ? { active: input.active } : {}),
});
const contactError = (error: { code?: string; message: string }) =>
  error.code === "23505" ? new ContractError("This client already has an active primary contact. Change that one first.", 409) : fail(error);

export async function createContact(admin: Admin, customerId: string, input: ContactInput, actor: Actor): Promise<ContactRecord> {
  const { data, error } = await admin
    .from("amc_customer_contacts")
    .insert({ ...contactRow(input), customer_id: customerId, created_by: actor.id })
    .select(CONTACT_COLUMNS)
    .single<Row>();
  if (error) throw contactError(error);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: customerId,
    eventType: "contact_added",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { contactId: data.id, role: input.role },
  });
  return mapContact(data);
}

export async function updateContact(admin: Admin, customerId: string, contactId: string, input: ContactInput, actor: Actor): Promise<ContactRecord> {
  const { data, error } = await admin
    .from("amc_customer_contacts")
    .update({ ...contactRow(input), updated_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("customer_id", customerId)
    .select(CONTACT_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw contactError(error);
  if (!data) throw new ContractError("Contact not found.", 404);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: customerId,
    eventType: input.active === false ? "contact_deactivated" : "contact_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { contactId, role: input.role },
  });
  return mapContact(data);
}

/* ------------------------------------------------------------------ */
/* Communication log                                                   */
/* ------------------------------------------------------------------ */

export interface CommunicationRecord {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  summary: string;
  occurredAt: string;
  source: string;
  propertyId: string | null;
  contractId: string | null;
  loggedBy: string | null;
}

export async function listCommunications(
  admin: Admin,
  customerId: string,
  limit = 50,
  offset = 0,
): Promise<{ entries: CommunicationRecord[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_communication_log")
    .select("id, channel, direction, subject, summary, occurred_at, source, property_id, contract_id, logger:user_profile!amc_communication_log_logged_by_fkey(full_name, email)")
    .eq("customer_id", customerId)
    .order("occurred_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    if (notMigrated(error)) return { entries: [], migrated: false };
    throw fail(error);
  }
  return {
    migrated: true,
    entries: ((data ?? []) as Row[]).map((r) => {
      const logger = (Array.isArray(r.logger) ? r.logger[0] : r.logger) as { full_name?: string | null; email?: string | null } | null;
      return {
        id: String(r.id),
        channel: String(r.channel),
        direction: String(r.direction),
        subject: str(r.subject),
        summary: String(r.summary),
        occurredAt: String(r.occurred_at),
        source: String(r.source),
        propertyId: str(r.property_id),
        contractId: str(r.contract_id),
        loggedBy: logger?.full_name?.trim() || logger?.email || null,
      };
    }),
  };
}

export async function addCommunication(
  admin: Admin,
  customerId: string,
  input: z.infer<typeof communicationSchema>,
  actor: Actor,
  source: "manual" | "system" = "manual",
): Promise<void> {
  const { error } = await admin.from("amc_communication_log").insert({
    customer_id: customerId,
    property_id: input.propertyId ?? null,
    contract_id: input.contractId ?? null,
    channel: input.channel,
    direction: input.direction,
    subject: blank(input.subject),
    summary: input.summary.trim(),
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    source,
    logged_by: actor.id,
  });
  if (error) throw fail(error);
}

/* ------------------------------------------------------------------ */
/* Combined units                                                      */
/* ------------------------------------------------------------------ */

/** A parent must exist and must not make a loop (BRD 5.2: linked, not merged). */
export async function assertValidParent(admin: Admin, propertyId: string | null, parentId: string | null | undefined): Promise<void> {
  if (!parentId) return;
  if (propertyId && parentId === propertyId) throw new ContractError("A property cannot be its own parent.", 400);
  const parentOf = new Map<string, string | null>();
  let current: string | null = parentId;
  /* Walk up from the chosen parent (combined units are a few levels at most). */
  for (let i = 0; current && i < 20; i += 1) {
    const { data, error }: { data: { id: string; parent_property_id: string | null } | null; error: { code?: string; message: string } | null } =
      await admin.from("amc_property_directory").select("id, parent_property_id").eq("id", current).maybeSingle();
    if (error) throw fail(error);
    if (!data) {
      if (current === parentId) throw new ContractError("The parent property was not found.", 400);
      break;
    }
    parentOf.set(data.id, data.parent_property_id);
    current = data.parent_property_id;
  }
  if (propertyId && wouldCreateParentLoop(propertyId, parentId, parentOf)) {
    throw new ContractError("That would make the property its own parent through another unit.", 400);
  }
}

export interface UnitSummary {
  id: string;
  label: string;
  unitType: string | null;
  customerId: string | null;
}

export async function propertyUnits(admin: Admin, propertyId: string, parentId: string | null): Promise<{ parent: UnitSummary | null; children: UnitSummary[] }> {
  const map = (r: Row): UnitSummary => ({ id: String(r.id), label: String(r.label), unitType: str(r.unit_type), customerId: str(r.customer_id) });
  const [parent, children] = await Promise.all([
    parentId
      ? admin.from("amc_property_directory").select("id, label, unit_type, customer_id").eq("id", parentId).maybeSingle<Row>()
      : Promise.resolve({ data: null, error: null }),
    admin.from("amc_property_directory").select("id, label, unit_type, customer_id").eq("parent_property_id", propertyId).order("label"),
  ]);
  if (children.error) {
    if (notMigrated(children.error)) return { parent: null, children: [] };
    throw fail(children.error);
  }
  return { parent: parent.data ? map(parent.data as Row) : null, children: ((children.data ?? []) as Row[]).map(map) };
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */

export interface AssetRecord {
  id: string;
  propertyId: string;
  assetType: string;
  trade: string;
  quantity: number;
  location: string | null;
  make: string | null;
  model: string | null;
  serialNo: string | null;
  capacity: string | null;
  installedOn: string | null;
  condition: string;
  status: "active" | "retired";
  retiredAt: string | null;
  retiredReason: string | null;
  notes: string | null;
  createdAt: string;
}

const ASSET_COLUMNS =
  "id, property_id, asset_type, trade, quantity, location, make, model, serial_no, capacity, installed_on, condition, status, retired_at, retired_reason, notes, created_at";
const mapAsset = (r: Row): AssetRecord => ({
  id: String(r.id),
  propertyId: String(r.property_id),
  assetType: String(r.asset_type),
  trade: String(r.trade),
  quantity: Number(r.quantity),
  location: str(r.location),
  make: str(r.make),
  model: str(r.model),
  serialNo: str(r.serial_no),
  capacity: str(r.capacity),
  installedOn: str(r.installed_on),
  condition: String(r.condition),
  status: r.status === "retired" ? "retired" : "active",
  retiredAt: str(r.retired_at),
  retiredReason: str(r.retired_reason),
  notes: str(r.notes),
  createdAt: String(r.created_at),
});

export async function listAssets(admin: Admin, propertyId: string): Promise<{ assets: AssetRecord[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_property_assets")
    .select(ASSET_COLUMNS)
    .eq("property_id", propertyId)
    .order("status")
    .order("trade")
    .order("asset_type");
  if (error) {
    if (notMigrated(error)) return { assets: [], migrated: false };
    throw fail(error);
  }
  return { assets: ((data ?? []) as Row[]).map(mapAsset), migrated: true };
}

type AssetInput = z.infer<typeof assetSchema>;
const assetRow = (input: AssetInput) => ({
  asset_type: input.assetType.trim(),
  trade: input.trade,
  quantity: input.quantity,
  location: blank(input.location),
  make: blank(input.make),
  model: blank(input.model),
  serial_no: blank(input.serialNo),
  capacity: blank(input.capacity),
  installed_on: input.installedOn || null,
  condition: input.condition,
  notes: blank(input.notes),
});
const assetError = (error: { code?: string; message: string }) =>
  error.code === "23505" ? new ContractError("This property already has an asset with that serial number.", 409) : fail(error);

export async function createAsset(admin: Admin, propertyId: string, input: AssetInput, actor: Actor): Promise<AssetRecord> {
  const { data, error } = await admin
    .from("amc_property_assets")
    .insert({ ...assetRow(input), property_id: propertyId, created_by: actor.id })
    .select(ASSET_COLUMNS)
    .single<Row>();
  if (error) throw assetError(error);
  await recordAmcAudit(admin, {
    entityType: "asset",
    entityId: String(data.id),
    eventType: "asset_added",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { propertyId, assetType: input.assetType, quantity: input.quantity },
  });
  return mapAsset(data);
}

export async function updateAsset(admin: Admin, propertyId: string, assetId: string, input: AssetInput, actor: Actor): Promise<AssetRecord> {
  const { data, error } = await admin
    .from("amc_property_assets")
    .update({ ...assetRow(input), updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("property_id", propertyId)
    .eq("status", "active")
    .select(ASSET_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw assetError(error);
  if (!data) throw new ContractError("Asset not found, or it is retired.", 404);
  await recordAmcAudit(admin, {
    entityType: "asset",
    entityId: assetId,
    eventType: "asset_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { propertyId },
  });
  return mapAsset(data);
}

/** Retired, never deleted: its service history stays (BRD 5.2). */
export async function retireAsset(admin: Admin, propertyId: string, assetId: string, reason: string, actor: Actor): Promise<AssetRecord> {
  const { data, error } = await admin
    .from("amc_property_assets")
    .update({ status: "retired", retired_at: new Date().toISOString(), retired_reason: reason.trim(), updated_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("property_id", propertyId)
    .eq("status", "active")
    .select(ASSET_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Asset not found, or already retired.", 404);
  await recordStatusChange(admin, { entityType: "asset", entityId: assetId, from: "active", to: "retired", reason, actor });
  return mapAsset(data);
}

/* ------------------------------------------------------------------ */
/* Access rules                                                        */
/* ------------------------------------------------------------------ */

export interface AccessRuleRecord {
  id: string;
  propertyId: string;
  accessType: string;
  issuer: string | null;
  leadTimeDays: number;
  permittedDays: number[];
  permittedFrom: string | null;
  permittedTo: string | null;
  parking: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  active: boolean;
}

const RULE_COLUMNS =
  "id, property_id, access_type, issuer, lead_time_days, permitted_days, permitted_from, permitted_to, parking, contact_name, contact_phone, notes, active";
const hm = (v: unknown) => (typeof v === "string" ? v.slice(0, 5) : null);
const mapRule = (r: Row): AccessRuleRecord => ({
  id: String(r.id),
  propertyId: String(r.property_id),
  accessType: String(r.access_type),
  issuer: str(r.issuer),
  leadTimeDays: Number(r.lead_time_days ?? 0),
  permittedDays: Array.isArray(r.permitted_days) ? (r.permitted_days as number[]) : [],
  permittedFrom: hm(r.permitted_from),
  permittedTo: hm(r.permitted_to),
  parking: str(r.parking),
  contactName: str(r.contact_name),
  contactPhone: str(r.contact_phone),
  notes: str(r.notes),
  active: r.active !== false,
});

export async function listAccessRules(admin: Admin, propertyId: string): Promise<{ rules: AccessRuleRecord[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_property_access_rules")
    .select(RULE_COLUMNS)
    .eq("property_id", propertyId)
    .order("active", { ascending: false })
    .order("access_type");
  if (error) {
    if (notMigrated(error)) return { rules: [], migrated: false };
    throw fail(error);
  }
  return { rules: ((data ?? []) as Row[]).map(mapRule), migrated: true };
}

type RuleInput = z.infer<typeof accessRuleSchema>;
const ruleRow = (input: RuleInput) => ({
  access_type: input.accessType,
  issuer: blank(input.issuer),
  lead_time_days: input.leadTimeDays,
  permitted_days: [...new Set(input.permittedDays)].sort(),
  permitted_from: input.permittedFrom || null,
  permitted_to: input.permittedTo || null,
  parking: blank(input.parking),
  contact_name: blank(input.contactName),
  contact_phone: blank(input.contactPhone),
  notes: blank(input.notes),
  ...(input.active !== undefined ? { active: input.active } : {}),
});

export async function createAccessRule(admin: Admin, propertyId: string, input: RuleInput, actor: Actor): Promise<AccessRuleRecord> {
  const { data, error } = await admin
    .from("amc_property_access_rules")
    .insert({ ...ruleRow(input), property_id: propertyId, created_by: actor.id })
    .select(RULE_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "property",
    entityId: propertyId,
    eventType: "access_rule_added",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { ruleId: data.id, accessType: input.accessType },
  });
  return mapRule(data);
}

export async function updateAccessRule(admin: Admin, propertyId: string, ruleId: string, input: RuleInput, actor: Actor): Promise<AccessRuleRecord> {
  const { data, error } = await admin
    .from("amc_property_access_rules")
    .update({ ...ruleRow(input), updated_at: new Date().toISOString() })
    .eq("id", ruleId)
    .eq("property_id", propertyId)
    .select(RULE_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Access rule not found.", 404);
  await recordAmcAudit(admin, {
    entityType: "property",
    entityId: propertyId,
    eventType: input.active === false ? "access_rule_deactivated" : "access_rule_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { ruleId },
  });
  return mapRule(data);
}

/* ------------------------------------------------------------------ */
/* Scope                                                               */
/* ------------------------------------------------------------------ */

export interface ScopeItemRecord {
  id: string;
  propertyId: string;
  serviceId: string;
  trade: string;
  assetId: string | null;
  quantity: number;
  frequencyPerYear: number | null;
  durationMinutes: number | null;
  preferredMonths: number[];
  preferredDays: number[];
  exclusions: string | null;
  notes: string | null;
  active: boolean;
}

const SCOPE_COLUMNS =
  "id, property_id, service_id, trade, asset_id, quantity, frequency_per_year, duration_minutes, preferred_months, preferred_days, exclusions, notes, active";
const mapScope = (r: Row): ScopeItemRecord => ({
  id: String(r.id),
  propertyId: String(r.property_id),
  serviceId: String(r.service_id),
  trade: String(r.trade),
  assetId: str(r.asset_id),
  quantity: Number(r.quantity ?? 1),
  frequencyPerYear: r.frequency_per_year === null || r.frequency_per_year === undefined ? null : Number(r.frequency_per_year),
  durationMinutes: r.duration_minutes === null || r.duration_minutes === undefined ? null : Number(r.duration_minutes),
  preferredMonths: Array.isArray(r.preferred_months) ? (r.preferred_months as number[]) : [],
  preferredDays: Array.isArray(r.preferred_days) ? (r.preferred_days as number[]) : [],
  exclusions: str(r.exclusions),
  notes: str(r.notes),
  active: r.active !== false,
});

export async function listScope(admin: Admin, propertyId: string): Promise<{ items: ScopeItemRecord[]; migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_scope_items")
    .select(SCOPE_COLUMNS)
    .eq("property_id", propertyId)
    .order("active", { ascending: false })
    .order("trade");
  if (error) {
    if (notMigrated(error)) return { items: [], migrated: false };
    throw fail(error);
  }
  return { items: ((data ?? []) as Row[]).map(mapScope), migrated: true };
}

type ScopeInput = z.infer<typeof scopeItemSchema>;
const scopeRow = (input: ScopeInput) => ({
  service_id: input.serviceId.trim(),
  trade: input.trade,
  asset_id: input.assetId ?? null,
  quantity: input.quantity,
  frequency_per_year: input.frequencyPerYear ?? null,
  duration_minutes: input.durationMinutes ?? null,
  preferred_months: [...new Set(input.preferredMonths)].sort((a, b) => a - b),
  preferred_days: [...new Set(input.preferredDays)].sort((a, b) => a - b),
  exclusions: blank(input.exclusions),
  notes: blank(input.notes),
  ...(input.active !== undefined ? { active: input.active } : {}),
});

async function assertAssetOnProperty(admin: Admin, propertyId: string, assetId: string | null | undefined) {
  if (!assetId) return;
  const { data } = await admin.from("amc_property_assets").select("id").eq("id", assetId).eq("property_id", propertyId).maybeSingle();
  if (!data) throw new ContractError("That asset is not on this property.", 400);
}

export async function createScopeItem(admin: Admin, propertyId: string, input: ScopeInput, actor: Actor): Promise<ScopeItemRecord> {
  await assertAssetOnProperty(admin, propertyId, input.assetId);
  const { data, error } = await admin
    .from("amc_scope_items")
    .insert({ ...scopeRow(input), property_id: propertyId, created_by: actor.id })
    .select(SCOPE_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "property",
    entityId: propertyId,
    eventType: "scope_item_added",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { scopeItemId: data.id, serviceId: input.serviceId },
  });
  return mapScope(data);
}

export async function updateScopeItem(admin: Admin, propertyId: string, itemId: string, input: ScopeInput, actor: Actor): Promise<ScopeItemRecord> {
  await assertAssetOnProperty(admin, propertyId, input.assetId);
  const { data, error } = await admin
    .from("amc_scope_items")
    .update({ ...scopeRow(input), updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("property_id", propertyId)
    .select(SCOPE_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Scope item not found.", 404);
  await recordAmcAudit(admin, {
    entityType: "property",
    entityId: propertyId,
    eventType: input.active === false ? "scope_item_removed" : "scope_item_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { scopeItemId: itemId },
  });
  return mapScope(data);
}

/* ------------------------------------------------------------------ */
/* Documents (DEV-381)                                                 */
/* ------------------------------------------------------------------ */

export interface DocumentRecord {
  id: string;
  level: DocumentLevel;
  entityId: string;
  customerId: string | null;
  category: string;
  title: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  expiresOn: string | null;
  notes: string | null;
  superseded: boolean;
  uploadedBy: string | null;
  uploadedAt: string;
}

const DOC_COLUMNS =
  "id, level, entity_id, customer_id, category, title, version, file_name, mime_type, size_bytes, expires_on, notes, superseded_by, uploaded_at, uploader:user_profile!amc_documents_uploaded_by_fkey(full_name, email)";
const mapDocument = (r: Row): DocumentRecord => {
  const uploader = (Array.isArray(r.uploader) ? r.uploader[0] : r.uploader) as { full_name?: string | null; email?: string | null } | null;
  return {
    id: String(r.id),
    level: String(r.level) as DocumentLevel,
    entityId: String(r.entity_id),
    customerId: str(r.customer_id),
    category: String(r.category),
    title: String(r.title),
    version: Number(r.version),
    fileName: String(r.file_name),
    mimeType: String(r.mime_type),
    sizeBytes: Number(r.size_bytes),
    expiresOn: str(r.expires_on),
    notes: str(r.notes),
    superseded: !!r.superseded_by,
    uploadedBy: uploader?.full_name?.trim() || uploader?.email || null,
    uploadedAt: String(r.uploaded_at),
  };
};

/** The documents of one record, or (customerId) everything that rolls up to a client. */
export async function listDocuments(
  admin: Admin,
  filter: { level: DocumentLevel; entityId: string } | { customerId: string },
): Promise<{ documents: DocumentRecord[]; migrated: boolean }> {
  let q = admin.from("amc_documents").select(DOC_COLUMNS).order("uploaded_at", { ascending: false }).limit(500);
  q = "customerId" in filter ? q.eq("customer_id", filter.customerId) : q.eq("level", filter.level).eq("entity_id", filter.entityId);
  const { data, error } = await q;
  if (error) {
    if (notMigrated(error)) return { documents: [], migrated: false };
    throw fail(error);
  }
  return { documents: ((data ?? []) as Row[]).map(mapDocument), migrated: true };
}

export async function getDocument(admin: Admin, id: string): Promise<DocumentRecord & { storagePath: string }> {
  const { data, error } = await admin.from("amc_documents").select(`${DOC_COLUMNS}, storage_path`).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Document not found.", 404);
  return { ...mapDocument(data), storagePath: String(data.storage_path) };
}

/**
 * Stores a document. The row is written first (with its version), then the
 * file; a failed upload removes the row, so neither is left without the
 * other. The previous version of the same document is marked superseded and
 * kept.
 */
export async function uploadDocument(
  admin: Admin,
  meta: z.infer<typeof documentMetaSchema> & { customerId: string | null },
  file: { bytes: Uint8Array; fileName: string },
  actor: Actor,
): Promise<DocumentRecord> {
  if (file.bytes.byteLength === 0) throw new ContractError("The file is empty.", 400);
  if (file.bytes.byteLength > AMC_DOCUMENT_MAX_BYTES) throw new ContractError("The file is larger than 20 MB.", 400);
  const type = detectDocumentType(file.bytes, file.fileName);
  if (!type) throw new ContractError("Upload a PDF, JPEG, PNG, WebP, Word (.docx) or Excel (.xlsx) file.", 400);

  const title = meta.title.trim();
  const { data: previous, error: prevError } = await admin
    .from("amc_documents")
    .select("id, version")
    .eq("level", meta.level)
    .eq("entity_id", meta.entityId)
    .eq("category", meta.category)
    .eq("title", title);
  if (prevError) throw fail(prevError);
  const versions = ((previous ?? []) as Array<{ id: string; version: number }>).map((p) => Number(p.version));
  const version = nextDocumentVersion(versions);
  const id = randomUUID();
  const path = documentStoragePath(meta.level, meta.entityId, id, type);
  const safeName = file.fileName.replace(/[^\w.\- ]+/g, "_").slice(0, 180) || `document.${path.split(".").pop()}`;

  const { error: insertError } = await admin.from("amc_documents").insert({
    id,
    level: meta.level,
    entity_id: meta.entityId,
    customer_id: meta.customerId,
    category: meta.category,
    title,
    version,
    storage_path: path,
    file_name: safeName,
    mime_type: type,
    size_bytes: file.bytes.byteLength,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
    expires_on: meta.expiresOn || null,
    notes: blank(meta.notes),
    uploaded_by: actor.id,
  });
  if (insertError) {
    if (insertError.code === "23505") throw new ContractError("Someone uploaded the same document at the same moment. Try again.", 409);
    throw fail(insertError);
  }
  const { error: uploadError } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, file.bytes, { contentType: type, upsert: false });
  if (uploadError) {
    await admin.from("amc_documents").delete().eq("id", id);
    throw new ContractError(`Could not store the file: ${uploadError.message}`, 500);
  }
  const latest = ((previous ?? []) as Array<{ id: string; version: number }>).filter((p) => Number(p.version) === Math.max(...versions, 0));
  if (latest.length > 0) {
    await admin.from("amc_documents").update({ superseded_by: id }).in("id", latest.map((p) => p.id)).is("superseded_by", null);
  }
  await recordAmcAudit(admin, {
    entityType: "document",
    entityId: id,
    eventType: "document_uploaded",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { level: meta.level, entityId: meta.entityId, category: meta.category, title, version, sizeBytes: file.bytes.byteLength },
  });
  return getDocument(admin, id);
}

/** A 10-minute signed link that downloads under the original file name. */
export async function documentDownloadUrl(admin: Admin, doc: { storagePath: string; fileName: string }): Promise<string> {
  const { data, error } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrl(doc.storagePath, 600, { download: doc.fileName });
  if (error || !data?.signedUrl) throw new ContractError("Could not prepare the download.", 500);
  return data.signedUrl;
}
