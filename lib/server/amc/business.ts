import type { SupabaseClient } from "@supabase/supabase-js";

import {
  additionalServiceEligibility,
  assessmentSummary,
  checkAssessmentCompletion,
  customerFromSnapshot,
  expiryBucket,
  managerPortfolio,
  portfolioMetrics,
  propertyFromSnapshot,
  proposalPrefillFromAssessment,
  renewalStage,
  serviceAnalytics,
  type AdditionalServiceEligibility,
  type AssessmentResult,
  type DiscountConfig,
  type ReportContract,
} from "@/lib/amc/business";
import {
  contractDisplayStatus,
  expiryLabel,
  summarizeContract,
  todayInDubai,
  type EntitlementType,
  type StoredContractStatus,
} from "@/lib/amc/contracts";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable, loadContract, toRulesContract } from "@/lib/server/amc/contracts";
import { fetchAllRowsById } from "@/lib/server/amc/paging";
import { removeDraftPhotoFiles } from "@/lib/server/amc/assessment-photos";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { fsmFetch, getFsmAccessToken, FsmConfigError } from "@/lib/server/zoho/fsm-client";
import { servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * AMC business operations on the server: shared customers and properties
 * and their AMC views, assessments, the checklist and discount
 * configuration, additional-service quotes, commercial history and
 * reports. Rules are in lib/amc/business.ts. Routes check the caller.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };
type Visibility = { userId: string; canApprove: boolean };

const NOT_MIGRATED =
  "This needs migration 20261006130000 (AMC business operations), which has not been applied to this database yet.";

function notMigrated(error: { code?: string } | null | undefined): boolean {
  return isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
}
function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, 400);
}
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));

/* ------------------------------------------------------------------ */
/* Customers and properties                                             */
/* ------------------------------------------------------------------ */

export interface CustomerRecord {
  id: string;
  name: string;
  customerRef: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  fsmContactId: string | null;
  snaggingClientId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PropertyRecord {
  id: string;
  customerId: string | null;
  label: string;
  address: string | null;
  community: string | null;
  propertyCategory: string | null;
  unitType: string | null;
  bedrooms: number | null;
  sizeSqft: number | null;
  notes: string | null;
  createdAt: string;
}

const CUSTOMER_COLUMNS = "id, name, customer_ref, company, email, phone, fsm_contact_id, snagging_client_id, notes, created_at";
const PROPERTY_COLUMNS =
  "id, customer_id, label, address, community, property_category, unit_type, bedrooms, size_sqft, notes, created_at";

function mapCustomer(r: Row): CustomerRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    customerRef: str(r.customer_ref),
    company: str(r.company),
    email: str(r.email),
    phone: str(r.phone),
    fsmContactId: str(r.fsm_contact_id),
    snaggingClientId: str(r.snagging_client_id),
    notes: str(r.notes),
    createdAt: String(r.created_at),
  };
}

function mapProperty(r: Row): PropertyRecord {
  return {
    id: String(r.id),
    customerId: str(r.customer_id),
    label: String(r.label),
    address: str(r.address),
    community: str(r.community),
    propertyCategory: str(r.property_category),
    unitType: str(r.unit_type),
    bedrooms: num(r.bedrooms),
    sizeSqft: num(r.size_sqft),
    notes: str(r.notes),
    createdAt: String(r.created_at),
  };
}

/** Characters that would break a PostgREST or() filter. */
function safeTerm(q: string): string {
  return q.replace(/[,()"'%_*:\\]/g, " ").trim().replace(/\s+/g, " ").slice(0, 100);
}

export async function searchCustomers(admin: Admin, q: string, limit = 25): Promise<CustomerRecord[]> {
  let query = admin.from("customers").select(CUSTOMER_COLUMNS).order("name").limit(limit);
  const term = safeTerm(q);
  if (term) query = query.or(`name.ilike.%${term}%,customer_ref.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`);
  const { data, error } = await query;
  if (error) throw fail(error);
  return ((data ?? []) as Row[]).map(mapCustomer);
}

export async function getCustomer(admin: Admin, id: string): Promise<CustomerRecord> {
  const { data, error } = await admin.from("customers").select(CUSTOMER_COLUMNS).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Customer not found.", 404);
  return mapCustomer(data);
}

export interface CustomerInput {
  name: string;
  customerRef?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

function customerRow(input: CustomerInput) {
  return {
    name: input.name.trim(),
    customer_ref: input.customerRef?.trim() || null,
    company: input.company?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    notes: input.notes?.trim() || null,
  };
}

function customerWriteError(error: { code?: string; message: string }): ContractError {
  if (error.code === "23505") return new ContractError("Another customer already has that Customer ID.", 409);
  return fail(error);
}

export async function createCustomer(admin: Admin, input: CustomerInput, actor: Actor): Promise<CustomerRecord> {
  const { data, error } = await admin
    .from("customers")
    .insert({ ...customerRow(input), created_by: actor.id })
    .select(CUSTOMER_COLUMNS)
    .single<Row>();
  if (error) throw customerWriteError(error);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: String(data.id),
    eventType: "customer_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { customerRef: data.customer_ref ?? null },
  });
  return mapCustomer(data);
}

export async function updateCustomer(admin: Admin, id: string, input: CustomerInput, actor: Actor): Promise<CustomerRecord> {
  const { data, error } = await admin
    .from("customers")
    .update({ ...customerRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw customerWriteError(error);
  if (!data) throw new ContractError("Customer not found.", 404);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: id,
    eventType: "customer_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { fields: Object.keys(customerRow(input)) },
  });
  return mapCustomer(data);
}

export async function listProperties(admin: Admin, customerId: string): Promise<PropertyRecord[]> {
  const { data, error } = await admin.from("customer_properties").select(PROPERTY_COLUMNS).eq("customer_id", customerId).order("label");
  if (error) throw fail(error);
  return ((data ?? []) as Row[]).map(mapProperty);
}

export async function getProperty(admin: Admin, id: string): Promise<PropertyRecord> {
  const { data, error } = await admin.from("customer_properties").select(PROPERTY_COLUMNS).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Property not found.", 404);
  return mapProperty(data);
}

export interface PropertyInput {
  customerId?: string | null;
  label: string;
  address?: string | null;
  community?: string | null;
  propertyCategory?: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  sizeSqft?: number | null;
  notes?: string | null;
}

function propertyRow(input: PropertyInput) {
  return {
    ...(input.customerId !== undefined ? { customer_id: input.customerId } : {}),
    label: input.label.trim(),
    address: input.address?.trim() || null,
    community: input.community?.trim() || null,
    property_category: input.propertyCategory || null,
    unit_type: input.unitType || null,
    bedrooms: input.bedrooms ?? null,
    size_sqft: input.sizeSqft ?? null,
    notes: input.notes?.trim() || null,
  };
}

export async function createProperty(admin: Admin, input: PropertyInput, actor: Actor): Promise<PropertyRecord> {
  const { data, error } = await admin
    .from("customer_properties")
    .insert({ ...propertyRow(input), created_by: actor.id })
    .select(PROPERTY_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: (data.customer_id as string | null) ?? String(data.id),
    eventType: "property_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { propertyId: data.id },
  });
  return mapProperty(data);
}

export async function updateProperty(admin: Admin, id: string, input: PropertyInput, actor: Actor): Promise<PropertyRecord> {
  const { data, error } = await admin
    .from("customer_properties")
    .update({ ...propertyRow(input), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(PROPERTY_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Property not found.", 404);
  await recordAmcAudit(admin, {
    entityType: "customer",
    entityId: (data.customer_id as string | null) ?? id,
    eventType: "property_updated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { propertyId: id },
  });
  return mapProperty(data);
}

/* ------------------------------------------------------------------ */
/* Contract live links                                                  */
/* ------------------------------------------------------------------ */

export async function contractLiveLinks(admin: Admin, contractId: string) {
  const { data, error } = await admin.from("amc_contracts").select("customer_id, property_id").eq("id", contractId).maybeSingle<Row>();
  if (error) {
    if (notMigrated(error)) return { migrated: false, customer: null, property: null };
    throw fail(error);
  }
  const [customer, property] = await Promise.all([
    data?.customer_id ? getCustomer(admin, String(data.customer_id)).catch(() => null) : Promise.resolve(null),
    data?.property_id ? getProperty(admin, String(data.property_id)).catch(() => null) : Promise.resolve(null),
  ]);
  return { migrated: true, customer, property };
}

/**
 * Links a contract to a shared customer: an existing one, or a new one made
 * from the signed snapshot (and confirmed by the person). The snapshot is
 * not touched. Null unlinks.
 */
export async function linkContractCustomer(
  admin: Admin,
  contractId: string,
  input: { customerId?: string | null; createFromSnapshot?: boolean },
  actor: Actor,
) {
  const { contract } = await loadContract(admin, contractId);
  let customerId: string | null = input.customerId ?? null;
  if (input.createFromSnapshot) {
    const draft = customerFromSnapshot(contract.customer);
    if (!draft.name) throw new ContractError("The signed contract has no customer name to start from.", 409);
    customerId = (await createCustomer(admin, draft, actor)).id;
  } else if (customerId) {
    await getCustomer(admin, customerId);
  }
  const { error } = await admin.from("amc_contracts").update({ customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", contractId);
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: customerId ? "customer_linked" : "customer_unlinked",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { customerId, createdFromSnapshot: Boolean(input.createFromSnapshot) },
  });
  return contractLiveLinks(admin, contractId);
}

/** The same for the property; a property made from the snapshot belongs to the linked customer. */
export async function linkContractProperty(
  admin: Admin,
  contractId: string,
  input: { propertyId?: string | null; createFromSnapshot?: boolean },
  actor: Actor,
) {
  const { contract } = await loadContract(admin, contractId);
  const links = await contractLiveLinks(admin, contractId);
  if (!links.migrated) throw new ContractError(NOT_MIGRATED, 503);
  let propertyId: string | null = input.propertyId ?? null;
  if (input.createFromSnapshot) {
    const draft = propertyFromSnapshot(contract.property);
    if (!draft.label) throw new ContractError("The signed contract has no property to start from.", 409);
    propertyId = (await createProperty(admin, { ...draft, customerId: links.customer?.id ?? null }, actor)).id;
  } else if (propertyId) {
    const property = await getProperty(admin, propertyId);
    if (links.customer && property.customerId && property.customerId !== links.customer.id) {
      throw new ContractError("That property belongs to a different customer.", 409);
    }
  }
  const { error } = await admin.from("amc_contracts").update({ property_id: propertyId, updated_at: new Date().toISOString() }).eq("id", contractId);
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: propertyId ? "property_linked" : "property_unlinked",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { propertyId, createdFromSnapshot: Boolean(input.createFromSnapshot) },
  });
  return contractLiveLinks(admin, contractId);
}

/* ------------------------------------------------------------------ */
/* Contracts for reports and customer/property views                    */
/* ------------------------------------------------------------------ */

export interface ContractRow extends ReportContract {
  proposalNumber: string;
  customerName: string;
  customerRef: string | null;
  propertyLabel: string;
  renewalProposal: { id: string; proposalNumber: string; status: string } | null;
}

const REPORT_COLUMNS =
  "id, proposal_number, customer_name, customer_ref, property_label, status, start_date, end_date, grand_total, account_managers, renewed_from_contract_id, customer_id, property_id, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id), amc_contract_entitlements(service_id, service_label, entitlement_type, included_quantity, used_quantity)";
const REPORT_COLUMNS_LEGACY = REPORT_COLUMNS.replace(" customer_id, property_id,", "");

/** Every contract the caller can see, with entitlements and renewal state. */
export async function loadContractRows(
  admin: Admin,
  who: Visibility,
  scope: { customerId?: string; propertyId?: string } = {},
): Promise<ContractRow[]> {
  /* Every row, a page at a time: a report must never stop at a row cap. */
  const run = (columns: string) =>
    fetchAllRowsById<Row>((afterId, size) => {
      let q = admin.from("amc_contracts").select(columns).order("id").limit(size);
      if (afterId) q = q.gt("id", afterId);
      if (!who.canApprove) q = q.eq("amc_submissions.owner_id", who.userId);
      if (scope.customerId) q = q.eq("customer_id", scope.customerId);
      if (scope.propertyId) q = q.eq("property_id", scope.propertyId);
      return q as unknown as PromiseLike<{ data: Row[] | null; error: { code?: string; message: string } | null }>;
    });
  let res = await run(REPORT_COLUMNS);
  if (res.error && notMigrated(res.error) && !scope.customerId && !scope.propertyId) res = await run(REPORT_COLUMNS_LEGACY);
  if (res.error) {
    if (isMissingTable(res.error)) throw new ContractError("AMC contracts are not set up on this database yet.", 503);
    throw fail(res.error);
  }
  if (res.truncated) console.error("AMC reports: more contracts than the safety stop; the report is incomplete.");
  const raw = res.data;
  const ids = raw.map((r) => String(r.id));
  const renewedBy = new Map<string, string>();
  for (const r of raw) if (r.renewed_from_contract_id) renewedBy.set(String(r.renewed_from_contract_id), String(r.id));

  const proposals = new Map<string, { id: string; proposalNumber: string; status: string }>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from("amc_submissions")
      .select("id, proposal_number, status, renewal_of_contract_id")
      .in("renewal_of_contract_id", ids.slice(i, i + 200));
    for (const p of (data ?? []) as Row[]) {
      proposals.set(String(p.renewal_of_contract_id), {
        id: String(p.id),
        proposalNumber: String(p.proposal_number ?? ""),
        status: String(p.status),
      });
    }
  }
  /* A successor outside the caller's view still means "renewed". */
  const missing = ids.filter((id) => !renewedBy.has(id));
  for (let i = 0; i < missing.length; i += 200) {
    const { data } = await admin.from("amc_contracts").select("id, renewed_from_contract_id").in("renewed_from_contract_id", missing.slice(i, i + 200));
    for (const r of (data ?? []) as Row[]) renewedBy.set(String(r.renewed_from_contract_id), String(r.id));
  }

  return raw.map((r) => ({
    id: String(r.id),
    proposalNumber: String(r.proposal_number ?? ""),
    customerName: String(r.customer_name ?? ""),
    customerRef: str(r.customer_ref),
    propertyLabel: String(r.property_label ?? ""),
    status: r.status as StoredContractStatus,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    grandTotal: Number(r.grand_total ?? 0),
    customerId: str(r.customer_id),
    propertyId: str(r.property_id),
    accountManagers: (Array.isArray(r.account_managers) ? (r.account_managers as Row[]) : [])
      .map((m) => String(m?.name ?? "").trim())
      .filter(Boolean),
    renewedFromContractId: str(r.renewed_from_contract_id),
    renewedByContractId: renewedBy.get(String(r.id)) ?? null,
    renewalProposalStatus: proposals.get(String(r.id))?.status ?? null,
    renewalProposal: proposals.get(String(r.id)) ?? null,
    entitlements: ((r.amc_contract_entitlements as Row[]) ?? []).map((e) => ({
      serviceId: String(e.service_id),
      serviceLabel: String(e.service_label ?? e.service_id),
      entitlementType: e.entitlement_type as EntitlementType,
      includedQuantity: e.included_quantity === null ? null : Number(e.included_quantity),
      usedQuantity: Number(e.used_quantity ?? 0),
    })),
  }));
}

/** A contract row as the customer/property views and reports show it. */
function presentContract(c: ContractRow, today: string) {
  const s = summarizeContract(c.entitlements);
  const stage = renewalStage(c, today);
  return {
    id: c.id,
    proposalNumber: c.proposalNumber,
    customerName: c.customerName,
    customerRef: c.customerRef,
    propertyLabel: c.propertyLabel,
    propertyId: c.propertyId,
    customerId: c.customerId,
    startDate: c.startDate,
    endDate: c.endDate,
    grandTotal: c.grandTotal,
    displayStatus: contractDisplayStatus(c, today),
    expiryLabel: expiryLabel(c, today),
    accountManagers: c.accountManagers,
    coverage: { totalServices: s.totalServices, withRemaining: s.withRemaining, exhausted: s.exhausted, unlimited: s.unlimited },
    renewalStage: stage?.stage ?? null,
    renewalOverdue: stage?.overdue ?? false,
    renewalProposal: c.renewalProposal,
    renewedByContractId: c.renewedByContractId,
    renewedFromContractId: c.renewedFromContractId,
    entitlements: c.entitlements,
  };
}

/* ------------------------------------------------------------------ */
/* Customer and property AMC views                                      */
/* ------------------------------------------------------------------ */

async function assessmentsFor(admin: Admin, column: "customer_id" | "property_id", id: string) {
  const { data, error } = await admin
    .from("amc_assessments")
    .select(
      "id, assessment_number, status, assessed_on, assessor_name, summary, property_id, submission_id, created_at, property:customer_properties(label), submission:amc_submissions!amc_assessments_submission_id_fkey(id, proposal_number, status)",
    )
    .eq(column, id)
    .order("created_at", { ascending: false });
  if (error) throw fail(error);
  return ((data ?? []) as Row[]).map((a) => ({
    id: String(a.id),
    assessmentNumber: String(a.assessment_number),
    status: String(a.status),
    assessedOn: str(a.assessed_on),
    assessorName: str(a.assessor_name),
    summary: str(a.summary),
    propertyLabel: str((a.property as Row | null)?.label),
    proposal: a.submission
      ? { id: String((a.submission as Row).id), proposalNumber: String((a.submission as Row).proposal_number ?? ""), status: String((a.submission as Row).status) }
      : null,
  }));
}

async function quotesFor(admin: Admin, column: "customer_id" | "contract_id" | "property_id", id: string) {
  const { data, error } = await admin
    .from("amc_additional_quotes")
    .select(QUOTE_COLUMNS)
    .eq(column, id)
    .order("created_at", { ascending: false });
  if (error) throw fail(error);
  return ((data ?? []) as Row[]).map(mapQuote);
}

export async function customerOverview(admin: Admin, who: Visibility, customerId: string) {
  const today = todayInDubai();
  const [customer, properties, rows, assessments, quotes] = await Promise.all([
    getCustomer(admin, customerId),
    listProperties(admin, customerId),
    loadContractRows(admin, who, { customerId }),
    assessmentsFor(admin, "customer_id", customerId),
    quotesFor(admin, "customer_id", customerId),
  ]);
  const contracts = rows.map((c) => presentContract(c, today));
  const live = contracts.filter((c) => c.displayStatus === "active" || c.displayStatus === "expiring");
  const liveProps = new Set(live.map((c) => c.propertyId).filter(Boolean));
  return {
    customer,
    properties,
    contracts,
    assessments,
    quotes,
    summary: {
      contracts: contracts.length,
      inForce: live.length,
      activeProperties: liveProps.size,
      inForceContractsWithoutProperty: live.filter((c) => !c.propertyId).length,
      currentValue: live.reduce((sum, c) => Math.round((sum + c.grandTotal) * 100) / 100, 0),
      historical: contracts.length - live.length,
      renewals: contracts.filter((c) => c.renewedFromContractId).length,
      quotesIssued: quotes.filter((q) => q.status === "estimate_linked").length,
      quotesDraft: quotes.filter((q) => q.status === "draft").length,
    },
  };
}

export async function propertyOverview(admin: Admin, who: Visibility, propertyId: string) {
  const today = todayInDubai();
  const property = await getProperty(admin, propertyId);
  const [customer, rows, assessments, quotes] = await Promise.all([
    property.customerId ? getCustomer(admin, property.customerId).catch(() => null) : Promise.resolve(null),
    loadContractRows(admin, who, { propertyId }),
    assessmentsFor(admin, "property_id", propertyId),
    quotesFor(admin, "property_id", propertyId),
  ]);
  const contracts = rows.map((c) => presentContract(c, today)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const current =
    contracts.find((c) => c.displayStatus === "active" || c.displayStatus === "expiring") ??
    contracts.find((c) => c.displayStatus === "not_started") ??
    null;
  return { property, customer, current, previous: contracts.filter((c) => c !== current), assessments, quotes };
}

/* ------------------------------------------------------------------ */
/* Assessment checklist                                                 */
/* ------------------------------------------------------------------ */

export interface ChecklistItem {
  itemKey: string;
  categoryKey: string;
  categoryLabel: string;
  label: string;
  sortOrder: number;
  active: boolean;
}

export async function listChecklist(admin: Admin, includeInactive = false): Promise<ChecklistItem[]> {
  let q = admin.from("amc_assessment_checklist").select("item_key, category_key, category_label, label, sort_order, active").order("sort_order");
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw fail(error);
  return ((data ?? []) as Row[]).map((r) => ({
    itemKey: String(r.item_key),
    categoryKey: String(r.category_key),
    categoryLabel: String(r.category_label),
    label: String(r.label),
    sortOrder: Number(r.sort_order ?? 0),
    active: Boolean(r.active),
  }));
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "item";

export async function saveChecklistItem(
  admin: Admin,
  input: { itemKey?: string | null; categoryLabel: string; label: string; sortOrder?: number; active: boolean },
  actor: Actor,
) {
  const itemKey = input.itemKey || `${slug(input.label)}-${Date.now().toString(36)}`;
  const { error } = await admin.from("amc_assessment_checklist").upsert(
    {
      item_key: itemKey,
      category_key: slug(input.categoryLabel),
      category_label: input.categoryLabel.trim(),
      label: input.label.trim(),
      sort_order: input.sortOrder ?? 0,
      active: input.active,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "item_key" },
  );
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "settings",
    eventType: "assessment_checklist_saved",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { itemKey, active: input.active },
  });
  return listChecklist(admin, true);
}

/* ------------------------------------------------------------------ */
/* Assessments                                                          */
/* ------------------------------------------------------------------ */

export interface AssessmentRecord {
  id: string;
  assessmentNumber: string;
  status: "draft" | "completed";
  customer: { id: string; name: string; customerRef: string | null } | null;
  property: { id: string; label: string } | null;
  contractId: string | null;
  proposal: { id: string; proposalNumber: string; status: string } | null;
  assessedOn: string | null;
  assessorName: string | null;
  propertyCategory: string | null;
  unitType: string | null;
  bedrooms: number | null;
  sizeSqft: number | null;
  occupancy: string | null;
  summary: string | null;
  findings: string | null;
  notes: string | null;
  recommendedServiceIds: string[];
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  items: Array<{
    itemKey: string;
    categoryKey: string;
    categoryLabel: string;
    label: string;
    result: AssessmentResult | null;
    notes: string | null;
  }>;
}

const ASSESSMENT_COLUMNS =
  "id, assessment_number, status, customer_id, property_id, contract_id, submission_id, assessed_on, assessor_name, property_category, unit_type, bedrooms, size_sqft, occupancy, summary, findings, notes, recommended_service_ids, completed_at, created_by, created_at, customer:customers(id, name, customer_ref), property:customer_properties(id, label), submission:amc_submissions!amc_assessments_submission_id_fkey(id, proposal_number, status)";

function mapAssessment(r: Row, items: Row[] = []): AssessmentRecord {
  const c = r.customer as Row | null;
  const p = r.property as Row | null;
  const s = r.submission as Row | null;
  return {
    id: String(r.id),
    assessmentNumber: String(r.assessment_number),
    status: r.status as "draft" | "completed",
    customer: c ? { id: String(c.id), name: String(c.name), customerRef: str(c.customer_ref) } : null,
    property: p ? { id: String(p.id), label: String(p.label) } : null,
    contractId: str(r.contract_id),
    proposal: s ? { id: String(s.id), proposalNumber: String(s.proposal_number ?? ""), status: String(s.status) } : null,
    assessedOn: str(r.assessed_on),
    assessorName: str(r.assessor_name),
    propertyCategory: str(r.property_category),
    unitType: str(r.unit_type),
    bedrooms: num(r.bedrooms),
    sizeSqft: num(r.size_sqft),
    occupancy: str(r.occupancy),
    summary: str(r.summary),
    findings: str(r.findings),
    notes: str(r.notes),
    recommendedServiceIds: Array.isArray(r.recommended_service_ids) ? (r.recommended_service_ids as string[]) : [],
    completedAt: str(r.completed_at),
    createdBy: str(r.created_by),
    createdAt: String(r.created_at),
    items: items
      .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0))
      .map((i) => ({
        itemKey: String(i.item_key),
        categoryKey: String(i.category_key),
        categoryLabel: String(i.category_label),
        label: String(i.label),
        result: (i.result as AssessmentResult | null) ?? null,
        notes: str(i.notes),
      })),
  };
}

/**
 * One page of assessments, newest first. The search runs in the database
 * (number, assessor, customer name or reference, property label), so an
 * old assessment is found however many newer ones there are.
 */
export async function listAssessments(
  admin: Admin,
  filter: { status?: string | null; q?: string | null; from?: number; to?: number; createdBy?: string | null } = {},
): Promise<{ assessments: AssessmentRecord[]; total: number }> {
  const from = filter.from ?? 0;
  const to = filter.to ?? from + 24;
  let q = admin
    .from("amc_assessments")
    .select(ASSESSMENT_COLUMNS, { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to);
  if (filter.status === "draft" || filter.status === "completed") q = q.eq("status", filter.status);
  /* Only the caller's own, unless they see all (lib/amc/access.ts). */
  if (filter.createdBy) q = q.eq("created_by", filter.createdBy);
  const term = safeTerm(filter.q ?? "");
  if (term) {
    const like = `%${term}%`;
    /* Customers and properties matching the term, by id (bounded: a search
       this broad is refined by typing more, not by paging 200 customers). */
    const [{ data: customers }, { data: properties }] = await Promise.all([
      admin.from("customers").select("id").or(`name.ilike.${like},customer_ref.ilike.${like}`).limit(200),
      admin.from("customer_properties").select("id").ilike("label", like).limit(200),
    ]);
    const clauses = [`assessment_number.ilike.${like}`, `assessor_name.ilike.${like}`];
    const customerIds = ((customers ?? []) as Row[]).map((r) => String(r.id));
    const propertyIds = ((properties ?? []) as Row[]).map((r) => String(r.id));
    if (customerIds.length) clauses.push(`customer_id.in.(${customerIds.join(",")})`);
    if (propertyIds.length) clauses.push(`property_id.in.(${propertyIds.join(",")})`);
    q = q.or(clauses.join(","));
  }
  const { data, error, count } = await q;
  if (error) throw fail(error);
  return { assessments: ((data ?? []) as Row[]).map((r) => mapAssessment(r)), total: count ?? 0 };
}

export async function getAssessment(admin: Admin, id: string): Promise<AssessmentRecord> {
  const [{ data, error }, { data: items, error: itemsError }] = await Promise.all([
    admin.from("amc_assessments").select(ASSESSMENT_COLUMNS).eq("id", id).maybeSingle<Row>(),
    admin
      .from("amc_assessment_items")
      .select("item_key, category_key, category_label, label, sort_order, result, notes")
      .eq("assessment_id", id),
  ]);
  if (error) throw fail(error);
  if (itemsError) throw fail(itemsError);
  if (!data) throw new ContractError("Assessment not found.", 404);
  return mapAssessment(data, (items ?? []) as Row[]);
}

/** Who may edit a draft: whoever created it, or an AMC approver. */
function canEditAssessment(who: Visibility, a: AssessmentRecord) {
  return who.canApprove || a.createdBy === who.userId;
}

export async function createAssessment(
  admin: Admin,
  input: { customerId: string | null; propertyId: string | null; contractId?: string | null; assessorName?: string | null },
  actor: Actor,
): Promise<AssessmentRecord> {
  const property = input.propertyId ? await getProperty(admin, input.propertyId) : null;
  if (property && input.customerId && property.customerId && property.customerId !== input.customerId) {
    throw new ContractError("That property belongs to a different customer.", 409);
  }
  const customerId = input.customerId ?? property?.customerId ?? null;
  if (customerId) await getCustomer(admin, customerId);
  const checklist = await listChecklist(admin);
  const { data, error } = await admin
    .from("amc_assessments")
    .insert({
      customer_id: customerId,
      property_id: property?.id ?? null,
      contract_id: input.contractId ?? null,
      assessor_id: actor.id,
      assessor_name: input.assessorName?.trim() || actor.label,
      /* Starts from what the property record already says. */
      property_category: property?.propertyCategory ?? null,
      unit_type: property?.unitType ?? null,
      bedrooms: property?.bedrooms ?? null,
      size_sqft: property?.sizeSqft ?? null,
      created_by: actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) throw fail(error);
  if (checklist.length) {
    const { error: itemsError } = await admin.from("amc_assessment_items").insert(
      checklist.map((c) => ({
        assessment_id: data.id,
        item_key: c.itemKey,
        category_key: c.categoryKey,
        category_label: c.categoryLabel,
        label: c.label,
        sort_order: c.sortOrder,
      })),
    );
    if (itemsError) throw fail(itemsError);
  }
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: data.id,
    eventType: "assessment_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { customerId, propertyId: property?.id ?? null, contractId: input.contractId ?? null, items: checklist.length },
  });
  return getAssessment(admin, data.id);
}

export interface AssessmentPatch {
  customerId?: string | null;
  propertyId?: string | null;
  assessedOn?: string | null;
  assessorName?: string | null;
  propertyCategory?: string | null;
  unitType?: string | null;
  bedrooms?: number | null;
  sizeSqft?: number | null;
  occupancy?: string | null;
  summary?: string | null;
  findings?: string | null;
  notes?: string | null;
  recommendedServiceIds?: string[];
  items?: Array<{ itemKey: string; result: AssessmentResult | null; notes?: string | null }>;
}

export async function updateAssessment(admin: Admin, who: Visibility, id: string, patch: AssessmentPatch): Promise<AssessmentRecord> {
  const current = await getAssessment(admin, id);
  if (current.status !== "draft") throw new ContractError("A completed assessment cannot be changed.", 409);
  if (!canEditAssessment(who, current)) throw new ContractError("Only its assessor or an AMC approver can edit this assessment.", 403);
  if (patch.recommendedServiceIds) {
    const settings = await readAmcSettings(admin);
    const known = new Set(settings.services.map((s) => s.id));
    const unknown = patch.recommendedServiceIds.filter((s) => !known.has(s));
    if (unknown.length) throw new ContractError(`Not in the AMC catalogue: ${unknown.join(", ")}.`, 400);
  }
  if (patch.propertyId) {
    const property = await getProperty(admin, patch.propertyId);
    const customerId = patch.customerId ?? current.customer?.id ?? null;
    if (customerId && property.customerId && property.customerId !== customerId) {
      throw new ContractError("That property belongs to a different customer.", 409);
    }
  }
  const row: Row = { updated_at: new Date().toISOString() };
  const map: Array<[keyof AssessmentPatch, string]> = [
    ["customerId", "customer_id"],
    ["propertyId", "property_id"],
    ["assessedOn", "assessed_on"],
    ["assessorName", "assessor_name"],
    ["propertyCategory", "property_category"],
    ["unitType", "unit_type"],
    ["bedrooms", "bedrooms"],
    ["sizeSqft", "size_sqft"],
    ["occupancy", "occupancy"],
    ["summary", "summary"],
    ["findings", "findings"],
    ["notes", "notes"],
    ["recommendedServiceIds", "recommended_service_ids"],
  ];
  for (const [key, column] of map) if (patch[key] !== undefined) row[column] = patch[key];
  const { error } = await admin.from("amc_assessments").update(row).eq("id", id).eq("status", "draft");
  if (error) throw fail(error);
  for (const item of patch.items ?? []) {
    const { error: itemError } = await admin
      .from("amc_assessment_items")
      .update({ result: item.result, notes: item.notes?.trim() || null })
      .eq("assessment_id", id)
      .eq("item_key", item.itemKey);
    if (itemError) throw fail(itemError);
  }
  return getAssessment(admin, id);
}

export async function completeAssessment(admin: Admin, who: Visibility, id: string, actor: Actor): Promise<AssessmentRecord> {
  const a = await getAssessment(admin, id);
  if (!canEditAssessment(who, a)) throw new ContractError("Only its assessor or an AMC approver can complete this assessment.", 403);
  const check = checkAssessmentCompletion({ status: a.status, assessedOn: a.assessedOn, propertyId: a.property?.id ?? null, items: a.items });
  if (!check.ok) throw new ContractError(check.errors.join(" "), 409);
  const { error } = await admin
    .from("amc_assessments")
    .update({ status: "completed", completed_at: new Date().toISOString(), completed_by: actor.id, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");
  if (error) throw fail(error);
  const summary = assessmentSummary(a.items);
  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: id,
    eventType: "assessment_completed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { ok: summary.ok, attention: summary.attention, notApplicable: summary.notApplicable, recommended: a.recommendedServiceIds },
  });
  return getAssessment(admin, id);
}

export async function deleteDraftAssessment(admin: Admin, who: Visibility, id: string, actor: Actor) {
  const a = await getAssessment(admin, id);
  if (a.status !== "draft") throw new ContractError("A completed assessment is kept as history.", 409);
  if (!canEditAssessment(who, a)) throw new ContractError("Only its assessor or an AMC approver can delete this draft.", 403);
  /* A draft's photos go with it: the files here, the rows by cascade. */
  await removeDraftPhotoFiles(admin, id);
  const { error } = await admin.from("amc_assessments").delete().eq("id", id).eq("status", "draft");
  if (error) throw fail(error);
  await recordAmcAudit(admin, { entityType: "assessment", entityId: id, eventType: "assessment_draft_deleted", actorId: actor.id, actorLabel: actor.label });
}

/**
 * Starts an AMC proposal from a completed assessment: a normal draft in AMC
 * proposals with the customer, the property and the recommended services
 * ticked, unpriced. Prices are entered in the proposal wizard as usual;
 * the approval workflow is unchanged.
 */
export async function createProposalFromAssessment(admin: Admin, id: string, actor: Actor) {
  const a = await getAssessment(admin, id);
  const [customer, property, settings] = await Promise.all([
    a.customer ? getCustomer(admin, a.customer.id) : Promise.resolve(null),
    a.property ? getProperty(admin, a.property.id) : Promise.resolve(null),
    readAmcSettings(admin),
  ]);
  const unitType = property?.unitType ?? a.unitType ?? "";
  const offered = servicesForProperty(settings, unitType);
  const prefill = proposalPrefillFromAssessment(
    {
      status: a.status,
      submissionId: a.proposal?.id ?? null,
      recommendedServiceIds: a.recommendedServiceIds,
      unitType: a.unitType,
      propertyCategory: a.propertyCategory,
    },
    customer ? { name: customer.name, customerRef: customer.customerRef, email: customer.email, phone: customer.phone } : null,
    property
      ? { label: property.label, address: property.address, unitType: property.unitType, propertyCategory: property.propertyCategory }
      : null,
    offered.map((s) => ({ id: s.id, frequencyPerYear: s.frequencyPerYear ?? null })),
  );
  if (!prefill.ok) throw new ContractError(prefill.error, prefill.status);
  const priced = priceSubmission({ services: prefill.services, discountPercent: 0, unitType: prefill.property.unitType, settings });
  if (!priced.ok) throw new ContractError(priced.error, 409);

  const { data, error } = await admin
    .from("amc_submissions")
    .insert({
      owner_id: actor.id,
      status: "draft",
      property: prefill.property,
      customer: prefill.customer,
      document_options: {
        optionalSections: { supplyInstallPriceList: false, additionalFixedPriceServices: false },
        priceListRows: [],
        accountManagers: [
          { name: "", phone: "" },
          { name: "", phone: "" },
        ],
      },
      services: priced.services,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      final_price: priced.final_price,
      generated_documents: [],
      customer_id: customer?.id ?? null,
      property_id: property?.id ?? null,
      assessment_id: a.id,
      updated_at: new Date().toISOString(),
    })
    .select("id, proposal_number, customer")
    .single<{ id: string; proposal_number: string; customer: Row }>();
  if (error) throw fail(error);
  /* Pin the JSON copy of the allocated number, as POST /api/amc-submissions does. */
  await admin
    .from("amc_submissions")
    .update({ customer: { ...(data.customer ?? {}), proposalNumber: data.proposal_number } })
    .eq("id", data.id);
  const { error: linkError } = await admin.from("amc_assessments").update({ submission_id: data.id }).eq("id", a.id);
  if (linkError) console.error("[amc:assessment] proposal created but not linked:", linkError.message, a.id, data.id);

  await recordAmcAudit(admin, {
    entityType: "assessment",
    entityId: a.id,
    eventType: "proposal_created_from_assessment",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { submissionId: data.id, proposalNumber: data.proposal_number, droppedServiceIds: prefill.droppedServiceIds },
  });
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: data.id,
    eventType: "created_from_assessment",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { assessmentId: a.id, assessmentNumber: a.assessmentNumber },
  });
  return { submissionId: data.id, proposalNumber: data.proposal_number, droppedServiceIds: prefill.droppedServiceIds };
}

/* ------------------------------------------------------------------ */
/* Additional-service discount configuration                            */
/* ------------------------------------------------------------------ */

const DISCOUNT_OFF: DiscountConfig = { enabled: false, discountPercent: null, eligibleServiceKeys: [], eligibleCategories: [] };

export async function getDiscountConfig(admin: Admin): Promise<DiscountConfig & { migrated: boolean }> {
  const { data, error } = await admin
    .from("amc_additional_service_discount")
    .select("enabled, discount_percent, eligible_service_keys, eligible_categories")
    .eq("id", 1)
    .maybeSingle<Row>();
  if (error) {
    if (notMigrated(error)) return { ...DISCOUNT_OFF, migrated: false };
    throw fail(error);
  }
  if (!data) return { ...DISCOUNT_OFF, migrated: true };
  return {
    migrated: true,
    enabled: Boolean(data.enabled),
    discountPercent: num(data.discount_percent),
    eligibleServiceKeys: (data.eligible_service_keys as string[] | null) ?? [],
    eligibleCategories: (data.eligible_categories as string[] | null) ?? [],
  };
}

export async function saveDiscountConfig(admin: Admin, config: DiscountConfig, actor: Actor) {
  if (config.enabled && !(config.discountPercent && config.discountPercent > 0)) {
    throw new ContractError("Set a discount percentage before switching the discount on.", 400);
  }
  const clean = (list: ReadonlyArray<string>) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];
  const { error } = await admin.from("amc_additional_service_discount").upsert({
    id: 1,
    enabled: config.enabled,
    discount_percent: config.discountPercent,
    eligible_service_keys: clean(config.eligibleServiceKeys),
    eligible_categories: clean(config.eligibleCategories),
    updated_by: actor.id,
    updated_at: new Date().toISOString(),
  });
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "settings",
    eventType: "amc_discount_config_saved",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { enabled: config.enabled, discountPercent: config.discountPercent, services: config.eligibleServiceKeys.length, categories: config.eligibleCategories.length },
  });
  return getDiscountConfig(admin);
}

/* ------------------------------------------------------------------ */
/* Additional-service quotes                                            */
/* ------------------------------------------------------------------ */

export interface AdditionalServiceInput {
  serviceKey: string;
  serviceLabel: string;
  /** The AMC catalogue service, when the request is one (inclusion check). */
  amcServiceId?: string | null;
  category?: string | null;
  date: string;
  standardPrice: number | null;
}

export async function checkAdditionalService(admin: Admin, contractId: string, input: AdditionalServiceInput) {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const config = await getDiscountConfig(admin);
  const eligibility = additionalServiceEligibility({
    contract: toRulesContract(contract, entitlements),
    amcServiceId: input.amcServiceId ?? null,
    serviceKey: input.serviceKey,
    category: input.category ?? null,
    date: input.date,
    standardPrice: input.standardPrice,
    config,
  });
  return { eligibility, config };
}

export interface QuoteRecord {
  id: string;
  quoteNumber: string;
  contractId: string;
  serviceKey: string;
  serviceLabel: string;
  serviceCategory: string | null;
  requestedFor: string;
  eligibility: AdditionalServiceEligibility["outcome"];
  standardPrice: number | null;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number | null;
  status: "draft" | "estimate_linked" | "cancelled";
  fsmEstimateNumber: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
}

const QUOTE_COLUMNS =
  "id, quote_number, contract_id, service_key, service_label, service_category, requested_for, eligibility, standard_price, discount_percent, discount_amount, final_price, status, fsm_estimate_number, notes, created_at, creator:user_profile!amc_additional_quotes_created_by_fkey(full_name, email)";

function mapQuote(r: Row): QuoteRecord {
  const who = r.creator as { full_name?: string | null; email?: string | null } | null;
  return {
    id: String(r.id),
    quoteNumber: String(r.quote_number),
    contractId: String(r.contract_id),
    serviceKey: String(r.service_key),
    serviceLabel: String(r.service_label),
    serviceCategory: str(r.service_category),
    requestedFor: String(r.requested_for),
    eligibility: r.eligibility as QuoteRecord["eligibility"],
    standardPrice: num(r.standard_price),
    discountPercent: Number(r.discount_percent ?? 0),
    discountAmount: Number(r.discount_amount ?? 0),
    finalPrice: num(r.final_price),
    status: r.status as QuoteRecord["status"],
    fsmEstimateNumber: str(r.fsm_estimate_number),
    notes: str(r.notes),
    createdBy: who?.full_name?.trim() || who?.email || null,
    createdAt: String(r.created_at),
  };
}

/**
 * Records an additional-service quote from an active AMC: the eligibility
 * answer and the commercial calculation as computed now, kept unchanged.
 * Nothing is sent: staff create the estimate in Zoho FSM (the existing
 * quotation workflow) with these figures and link its number here.
 */
export async function createAdditionalQuote(admin: Admin, contractId: string, input: AdditionalServiceInput & { notes?: string | null }, actor: Actor) {
  const { eligibility, config } = await checkAdditionalService(admin, contractId, input);
  if (!config.migrated) throw new ContractError(NOT_MIGRATED, 503);
  if (eligibility.outcome === "included_in_amc") {
    throw new ContractError("This service is covered by the AMC: record it as usage instead of quoting it.", 409);
  }
  if (eligibility.standardPrice === null) {
    throw new ContractError("Enter the standard price so the quote records the full calculation.", 400);
  }
  const links = await contractLiveLinks(admin, contractId);
  const { data, error } = await admin
    .from("amc_additional_quotes")
    .insert({
      contract_id: contractId,
      customer_id: links.customer?.id ?? null,
      property_id: links.property?.id ?? null,
      service_key: input.serviceKey.trim(),
      service_label: input.serviceLabel.trim(),
      service_category: input.category?.trim() || null,
      requested_for: input.date,
      eligibility: eligibility.outcome,
      standard_price: eligibility.standardPrice,
      discount_percent: eligibility.discountPercent,
      discount_amount: eligibility.discountAmount,
      final_price: eligibility.finalPrice,
      calculation: {
        computedAt: new Date().toISOString(),
        rule: "lib/amc/business.ts additionalServiceEligibility",
        config: {
          enabled: config.enabled,
          discountPercent: config.discountPercent,
          eligibleServiceKeys: config.eligibleServiceKeys,
          eligibleCategories: config.eligibleCategories,
        },
        amcServiceId: input.amcServiceId ?? null,
        reasons: eligibility.reasons,
      },
      notes: input.notes?.trim() || null,
      created_by: actor.id,
    })
    .select(QUOTE_COLUMNS)
    .single<Row>();
  if (error) throw fail(error);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "additional_quote_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { quoteId: data.id, quoteNumber: data.quote_number, serviceKey: input.serviceKey, eligibility: eligibility.outcome },
  });
  if (eligibility.outcome === "amc_discount_eligible" && eligibility.discountAmount > 0) {
    await recordAmcAudit(admin, {
      entityType: "quote",
      entityId: String(data.id),
      eventType: "amc_discount_applied",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: {
        contractId,
        standardPrice: eligibility.standardPrice,
        discountPercent: eligibility.discountPercent,
        discountAmount: eligibility.discountAmount,
        finalPrice: eligibility.finalPrice,
      },
    });
  }
  return mapQuote(data);
}

/**
 * Links the FSM estimate staff created for the quote. The estimate is
 * looked up in FSM by its number first, so a typo is caught.
 */
export async function linkQuoteEstimate(admin: Admin, contractId: string, quoteId: string, estimateNumber: string, actor: Actor) {
  const number = estimateNumber.trim();
  let token: string;
  try {
    token = await getFsmAccessToken(admin);
  } catch (error) {
    if (error instanceof FsmConfigError) throw new ContractError("Zoho FSM is not connected (no OAuth token in settings).", 503);
    throw error;
  }
  const query = new URLSearchParams({ api_name: "Name", value: number, comparator: "equal" });
  const found = await fsmFetch(token, `/Estimates/search?${query.toString()}`);
  const estimate = (found.json?.data ?? [])[0] as { id?: string; Name?: string } | undefined;
  if (!found.ok || !estimate?.id) throw new ContractError(`No estimate ${number} in Zoho FSM.`, 404);

  const { data, error } = await admin
    .from("amc_additional_quotes")
    .update({ status: "estimate_linked", fsm_estimate_id: estimate.id, fsm_estimate_number: estimate.Name ?? number, updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("contract_id", contractId)
    .neq("status", "cancelled")
    .select(QUOTE_COLUMNS)
    .maybeSingle<Row>();
  if (error) {
    if (error.code === "23505") throw new ContractError("That estimate is already linked to another quote.", 409);
    throw fail(error);
  }
  if (!data) throw new ContractError("That quote is not on this contract, or is cancelled.", 404);
  await recordAmcAudit(admin, {
    entityType: "quote",
    entityId: quoteId,
    eventType: "additional_quote_estimate_linked",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { contractId, fsmEstimateNumber: estimate.Name ?? number },
  });
  return mapQuote(data);
}

export async function cancelQuote(admin: Admin, contractId: string, quoteId: string, reason: string, actor: Actor) {
  const { data, error } = await admin
    .from("amc_additional_quotes")
    .update({ status: "cancelled", notes: reason, updated_at: new Date().toISOString() })
    .eq("id", quoteId)
    .eq("contract_id", contractId)
    .neq("status", "cancelled")
    .select(QUOTE_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("That quote is not on this contract, or is already cancelled.", 404);
  await recordAmcAudit(admin, {
    entityType: "quote",
    entityId: quoteId,
    eventType: "additional_quote_cancelled",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: reason,
    payload: { contractId },
  });
  return mapQuote(data);
}

/* ------------------------------------------------------------------ */
/* Commercial history                                                   */
/* ------------------------------------------------------------------ */

/**
 * The contract's commercial relationships. Discounts are totalled only for
 * quotes whose FSM estimate exists (issued), never drafts or cancelled ones;
 * whether the customer accepted an estimate is FSM's to say, so this reads
 * "offered", not revenue.
 */
export async function contractCommercialHistory(admin: Admin, contractId: string) {
  const { contract } = await loadContract(admin, contractId);
  const [source, renewal, quotes] = await Promise.all([
    admin.from("amc_submissions").select("id, proposal_number, status, signed_at, final_price").eq("id", contract.submissionId).maybeSingle<Row>(),
    admin.from("amc_submissions").select("id, proposal_number, status").eq("renewal_of_contract_id", contractId).limit(1).maybeSingle<Row>(),
    quotesFor(admin, "contract_id", contractId).catch((error) => {
      if (error instanceof ContractError && error.status === 503) return [] as QuoteRecord[];
      throw error;
    }),
  ]);
  const issued = quotes.filter((q) => q.status === "estimate_linked");
  return {
    originalProposal: source.data
      ? { id: String(source.data.id), proposalNumber: String(source.data.proposal_number ?? ""), signedAt: str(source.data.signed_at) }
      : null,
    contractValue: contract.grandTotal,
    renewalProposal: renewal.data
      ? { id: String(renewal.data.id), proposalNumber: String(renewal.data.proposal_number ?? ""), status: String(renewal.data.status) }
      : null,
    renewedFromContractId: contract.renewedFromContractId,
    renewedByContractId: contract.renewedByContractId,
    quotes,
    totals: {
      issued: issued.length,
      drafts: quotes.filter((q) => q.status === "draft").length,
      cancelled: quotes.filter((q) => q.status === "cancelled").length,
      discountsOffered: issued.reduce((sum, q) => Math.round((sum + q.discountAmount) * 100) / 100, 0),
      issuedValue: issued.reduce((sum, q) => Math.round((sum + (q.finalPrice ?? 0)) * 100) / 100, 0),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

export interface ReportFilters {
  manager?: string | null;
  customer?: string | null;
  property?: string | null;
}

export async function amcReports(admin: Admin, who: Visibility, filters: ReportFilters = {}) {
  const today = todayInDubai();
  const all = await loadContractRows(admin, who);
  const m = filters.manager?.trim().toLowerCase();
  const c = filters.customer?.trim().toLowerCase();
  const p = filters.property?.trim().toLowerCase();
  const rows = all.filter(
    (r) =>
      (!m || r.accountManagers.some((x) => x.toLowerCase().includes(m))) &&
      (!c || [r.customerName, r.customerRef ?? ""].some((x) => x.toLowerCase().includes(c))) &&
      (!p || r.propertyLabel.toLowerCase().includes(p)),
  );
  const present = rows.map((r) => presentContract(r, today));
  return {
    today,
    filters,
    managers: [...new Set(all.flatMap((r) => r.accountManagers))].sort(),
    metrics: portfolioMetrics(rows, today),
    expiry: present
      .map((r) => ({ ...r, bucket: expiryBucket({ status: rows.find((x) => x.id === r.id)!.status, endDate: r.endDate }, today) }))
      .filter((r) => r.bucket !== null)
      .sort((a, b) => a.endDate.localeCompare(b.endDate)),
    pipeline: present.filter((r) => r.renewalStage !== null).sort((a, b) => a.endDate.localeCompare(b.endDate)),
    portfolio: managerPortfolio(rows, today),
    services: serviceAnalytics(rows, today),
  };
}

export type AmcReports = Awaited<ReturnType<typeof amcReports>>;
export type CustomerOverview = Awaited<ReturnType<typeof customerOverview>>;
export type PropertyOverview = Awaited<ReturnType<typeof propertyOverview>>;
export type CommercialHistory = Awaited<ReturnType<typeof contractCommercialHistory>>;
