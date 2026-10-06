import type { SupabaseClient } from "@supabase/supabase-js";

import {
  canCancelContract,
  checkActivation,
  checkUsage,
  contractDisplayStatus,
  daysRemaining,
  deriveEntitlements,
  signedCommercials,
  termMonthsBetween,
  type ContractEntitlement,
  type ContractForRules,
  type StoredContractStatus,
} from "@/lib/amc/contracts";
import { grandTotalFromFinal, vatOnFinal } from "@/lib/amc/pricing";
import { buildRenewalDraft, renewalBlockedReason } from "@/lib/amc/renewal";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { notifyContractEvent, notifyEntitlementState } from "@/lib/server/amc/notifications";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { readAmcSettings } from "@/lib/server/amc/settings";
import {
  getAmcSettingsDefaults,
  mergeAmcSettings,
  servicesForProperty,
  type AmcSettings,
} from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * Active AMC contracts on the server: activation, usage, cancellation,
 * renewal and coverage. All writes use the service role passed in by the
 * route, after the route has checked who is calling.
 */

type Admin = SupabaseClient;

export class ContractError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 500 | 502 | 503 = 400,
  ) {
    super(message);
    this.name = "ContractError";
  }
}

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

export const CONTRACT_COLUMNS =
  "id, submission_id, proposal_number, status, customer, property, account_managers, customer_name, customer_ref, property_label, unit_type, start_date, end_date, term_months, currency, subtotal, discount_percent, discount_amount, final_price, vat_amount, grand_total, signed_at, signed_by_name, renewed_from_contract_id, activated_by, activated_at, cancelled_at, cancelled_by, cancellation_reason, created_at, updated_at";

export const ENTITLEMENT_COLUMNS =
  "id, contract_id, service_id, service_label, sort_order, frequency_type, entitlement_type, call_out_class, units, frequency, included_quantity, used_quantity, base_price, contracted_price";

type Row = Record<string, unknown>;

export function mapEntitlement(row: Row): ContractEntitlement {
  return {
    id: String(row.id),
    serviceId: String(row.service_id),
    serviceLabel: String(row.service_label),
    entitlementType: row.entitlement_type as ContractEntitlement["entitlementType"],
    callOutClass: (row.call_out_class as ContractEntitlement["callOutClass"]) ?? null,
    units: Number(row.units),
    frequency: Number(row.frequency),
    includedQuantity: row.included_quantity === null ? null : Number(row.included_quantity),
    usedQuantity: Number(row.used_quantity ?? 0),
    basePrice: row.base_price === null ? null : Number(row.base_price),
    contractedPrice: Number(row.contracted_price ?? 0),
    frequencyType: (row.frequency_type as string | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
  };
}

export interface ContractView {
  id: string;
  submissionId: string;
  proposalNumber: string;
  status: StoredContractStatus;
  displayStatus: ReturnType<typeof contractDisplayStatus>;
  daysRemaining: number | null;
  customerName: string;
  customerRef: string | null;
  propertyLabel: string;
  unitType: string | null;
  customer: Record<string, unknown>;
  property: Record<string, unknown>;
  accountManagers: Array<{ name: string; phone: string }>;
  startDate: string;
  endDate: string;
  termMonths: number | null;
  currency: string;
  subtotal: number;
  discountPercent: number;
  discountAmount: number;
  finalPrice: number;
  vatAmount: number;
  grandTotal: number;
  signedAt: string;
  signedByName: string;
  renewedFromContractId: string | null;
  renewedByContractId: string | null;
  activatedAt: string;
  cancelledAt: string | null;
  cancellationReason: string | null;
}

export function mapContract(row: Row, extra: { renewedByContractId?: string | null } = {}): ContractView {
  const managers = Array.isArray(row.account_managers) ? row.account_managers : [];
  const startDate = String(row.start_date);
  const endDate = String(row.end_date);
  const status = row.status as StoredContractStatus;
  return {
    id: String(row.id),
    submissionId: String(row.submission_id),
    proposalNumber: String(row.proposal_number ?? ""),
    status,
    displayStatus: contractDisplayStatus({ status, startDate, endDate }),
    daysRemaining: daysRemaining(endDate),
    customerName: String(row.customer_name ?? ""),
    customerRef: (row.customer_ref as string | null) ?? null,
    propertyLabel: String(row.property_label ?? ""),
    unitType: (row.unit_type as string | null) ?? null,
    customer: (row.customer as Record<string, unknown>) ?? {},
    property: (row.property as Record<string, unknown>) ?? {},
    accountManagers: managers
      .map((m) => ({
        name: String((m as Row)?.name ?? ""),
        phone: String((m as Row)?.phone ?? ""),
      }))
      .filter((m) => m.name || m.phone),
    startDate,
    endDate,
    termMonths: row.term_months === null || row.term_months === undefined ? null : Number(row.term_months),
    currency: String(row.currency ?? "AED"),
    subtotal: Number(row.subtotal ?? 0),
    discountPercent: Number(row.discount_percent ?? 0),
    discountAmount: Number(row.discount_amount ?? 0),
    finalPrice: Number(row.final_price ?? 0),
    vatAmount: Number(row.vat_amount ?? 0),
    grandTotal: Number(row.grand_total ?? 0),
    signedAt: String(row.signed_at),
    signedByName: String(row.signed_by_name ?? ""),
    renewedFromContractId: (row.renewed_from_contract_id as string | null) ?? null,
    renewedByContractId: extra.renewedByContractId ?? null,
    activatedAt: String(row.activated_at),
    cancelledAt: (row.cancelled_at as string | null) ?? null,
    cancellationReason: (row.cancellation_reason as string | null) ?? null,
  };
}

function propertyLabelOf(property: Row): string {
  return [property.propertyDetail, property.propertyAddress]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(" — ");
}

/** A missing table means the Active AMC migration is not applied yet. */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

/** PostgREST: the function is not in its schema cache (migration not applied). */
export function isMissingFunction(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function notMigrated(): ContractError {
  return new ContractError(
    "AMC contracts are not set up on this database yet (migrations 20261006100000 to 20261006140000 have not all been applied).",
    503,
  );
}

/**
 * The live customer and property a proposal or contract is linked to
 * (who they are today; the signed snapshots never follow them). Null when
 * migration 20261006130000 is not applied.
 */
export async function loadLiveLinks(
  admin: Admin,
  table: "amc_contracts" | "amc_submissions",
  id: string,
): Promise<{ customerId: string | null; propertyId: string | null } | null> {
  const { data, error } = await admin.from(table).select("customer_id, property_id").eq("id", id).maybeSingle<Row>();
  if (error || !data) return null;
  return {
    customerId: (data.customer_id as string | null) ?? null,
    propertyId: (data.property_id as string | null) ?? null,
  };
}

/** Columns to write only when there is a link (older databases lack them). */
function liveLinkColumns(links: { customerId: string | null; propertyId: string | null } | null) {
  return {
    ...(links?.customerId ? { customer_id: links.customerId } : {}),
    ...(links?.propertyId ? { property_id: links.propertyId } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Activation                                                          */
/* ------------------------------------------------------------------ */

const SUBMISSION_COLUMNS =
  "id, owner_id, status, proposal_number, customer, property, services, document_options, discount_percent, discount_amount, final_price, signed_by_name, signed_at, settings_snapshot, contract_settings_snapshot, renewal_of_contract_id";

/**
 * Turns a signed proposal into a contract, snapshotting everything the
 * client signed: customer, property, account managers, commercial values,
 * contracted services (as entitlements) and the contract wording.
 */
/**
 * Everything activation would create, worked out without writing: used by
 * the activation preview and by activation itself, so the dialog shows
 * exactly what the contract will hold.
 */
export async function prepareActivation(admin: Admin, submissionId: string) {
  const { data: submission, error } = await admin
    .from("amc_submissions")
    .select(SUBMISSION_COLUMNS)
    .eq("id", submissionId)
    .maybeSingle<Row>();
  if (error) {
    /* Before the migration the renewal column does not exist yet. */
    if (error.code === "42703" || error.code === "PGRST204") throw notMigrated();
    throw new ContractError(error.message, 400);
  }
  if (!submission) throw new ContractError("Proposal not found.", 404);

  const { data: existing, error: existingError } = await admin
    .from("amc_contracts")
    .select("id")
    .eq("submission_id", submissionId)
    .maybeSingle<{ id: string }>();
  if (existingError) {
    if (isMissingTable(existingError)) throw notMigrated();
    throw new ContractError(existingError.message, 400);
  }

  /* The wording the client signed: the contract's own copy, else the
     proposal's, merged over the shipped defaults as the renderer does. */
  const snapshot = (submission.contract_settings_snapshot ??
    submission.settings_snapshot ??
    null) as Partial<AmcSettings> | null;
  const signedSettings: AmcSettings = snapshot
    ? mergeAmcSettings(getAmcSettingsDefaults(), snapshot as Parameters<typeof mergeAmcSettings>[1])
    : await readAmcSettings(admin);

  const rows = (Array.isArray(submission.services) ? submission.services : []) as Array<{
    serviceId: string;
    included: boolean;
    units: number;
    frequency: number;
    basePrice?: number | null;
    price?: number | null;
  }>;
  /* Priced exactly as signed (see signedCommercials). */
  const signed = signedCommercials(rows, {
    discountPercent: submission.discount_percent as number | null,
    discountAmount: submission.discount_amount as number | null,
    finalPrice: submission.final_price as number | null,
  });
  const { finalPrice } = signed;
  const commercial = {
    subtotal: signed.subtotal,
    discountPercent: signed.discountPercent,
    discountAmount: signed.discountAmount,
  };
  const entitlements = deriveEntitlements(
    rows.map((row) => ({ ...row, price: signed.linePrices.get(row.serviceId) ?? 0 })),
    signedSettings.services.map((s) => ({ id: s.id, label: s.label, frequencyType: s.frequencyType })),
  );

  const customer = (submission.customer ?? {}) as Row;
  const property = (submission.property ?? {}) as Row;
  const options = (submission.document_options ?? {}) as Row;
  const managers = (Array.isArray(options.accountManagers) ? options.accountManagers : []).filter(
    (m) => (m as Row)?.name || (m as Row)?.phone,
  ) as Row[];

  return {
    submission,
    existingContractId: existing?.id ?? null,
    signedSettings,
    commercial,
    finalPrice,
    entitlements,
    customer,
    property,
    managers,
  };
}

/** What the activation dialog shows before anyone confirms. */
export async function activationPreview(admin: Admin, submissionId: string) {
  const p = await prepareActivation(admin, submissionId);
  const startDate = typeof p.customer.startDate === "string" ? p.customer.startDate : null;
  const endDate = typeof p.customer.endDate === "string" ? p.customer.endDate : null;
  return {
    submissionId,
    status: String(p.submission.status),
    signed: p.submission.status === "signed",
    existingContractId: p.existingContractId,
    proposalNumber: String(p.submission.proposal_number ?? ""),
    customerName: String(p.customer.customerName ?? ""),
    customerRef: String(p.customer.customerId ?? "") || null,
    propertyLabel: propertyLabelOf(p.property),
    accountManagers: p.managers.map((m) => ({ name: String(m.name ?? ""), phone: String(m.phone ?? "") })),
    signedAt: (p.submission.signed_at as string | null) ?? null,
    signedByName: (p.submission.signed_by_name as string | null) ?? null,
    /* Where the dates come from: the signed proposal's own date fields. */
    proposedStartDate: startDate,
    proposedEndDate: endDate,
    finalPrice: p.finalPrice,
    vatAmount: vatOnFinal(p.finalPrice),
    grandTotal: grandTotalFromFinal(p.finalPrice),
    entitlements: p.entitlements.map((e) => ({
      serviceId: e.serviceId,
      serviceLabel: e.serviceLabel,
      entitlementType: e.entitlementType,
      callOutClass: e.callOutClass,
      units: e.units,
      frequency: e.frequency,
      includedQuantity: e.includedQuantity,
      contractedPrice: e.contractedPrice,
    })),
  };
}

export async function activateContract(
  admin: Admin,
  input: { submissionId: string; startDate: string; endDate: string },
  actor: { id: string; label: string | null },
): Promise<ContractView> {
  const { submission, existingContractId, signedSettings, commercial, finalPrice, entitlements, customer, property, managers } =
    await prepareActivation(admin, input.submissionId);

  const check = checkActivation({
    submissionStatus: String(submission.status),
    alreadyActivated: Boolean(existingContractId),
    startDate: input.startDate,
    endDate: input.endDate,
    signedByName: submission.signed_by_name as string | null,
    signedAt: submission.signed_at as string | null,
  });
  if (!check.ok) throw new ContractError(check.error, check.status);
  if (entitlements.length === 0) {
    throw new ContractError("The signed proposal has no services to activate.", 409);
  }

  /* The proposal's live customer/property (e.g. from an assessment) carries over. */
  const links = await loadLiveLinks(admin, "amc_submissions", input.submissionId);
  /* Contract and entitlements in one database transaction
     (amc_activate_contract, 20261006140000): either both exist or neither,
     so a failure can never leave a contract without its services. */
  const { data: newId, error: insertError } = await admin.rpc("amc_activate_contract", {
    p_contract: {
      ...liveLinkColumns(links),
      submission_id: input.submissionId,
      proposal_number: submission.proposal_number,
      status: "active",
      customer,
      property,
      account_managers: managers,
      account_manager_names: managers
        .map((m) => String(m.name ?? "").trim())
        .filter(Boolean)
        .join(", "),
      customer_name: String(customer.customerName ?? "").trim(),
      customer_ref: String(customer.customerId ?? "").trim() || null,
      property_label: propertyLabelOf(property),
      unit_type: (property.unitType as string | undefined) ?? null,
      start_date: input.startDate,
      end_date: input.endDate,
      /* Under a whole month (6 to 20 Oct) has no term in months. */
      term_months: termMonthsBetween(input.startDate, input.endDate) || null,
      subtotal: commercial.subtotal,
      discount_percent: commercial.discountPercent,
      discount_amount: commercial.discountAmount,
      final_price: finalPrice,
      vat_amount: vatOnFinal(finalPrice),
      grand_total: grandTotalFromFinal(finalPrice),
      signed_at: submission.signed_at,
      signed_by_name: submission.signed_by_name,
      contract_settings_snapshot: signedSettings,
      renewed_from_contract_id: (submission.renewal_of_contract_id as string | null) ?? null,
      activated_by: actor.id,
    },
    p_entitlements: entitlements.map((e) => ({
      service_id: e.serviceId,
      service_label: e.serviceLabel,
      sort_order: e.sortOrder ?? 0,
      frequency_type: e.frequencyType ?? null,
      entitlement_type: e.entitlementType,
      call_out_class: e.callOutClass,
      units: e.units,
      frequency: e.frequency,
      included_quantity: e.includedQuantity,
      base_price: e.basePrice,
      contracted_price: e.contractedPrice,
    })),
  });
  if (insertError) {
    if (insertError.code === "23505" && /renewed_from/.test(insertError.message)) {
      throw new ContractError("The contract this proposal renews has already been renewed.", 409);
    }
    if (insertError.code === "23505" && /service_id/.test(insertError.message)) {
      throw new ContractError("The signed proposal lists the same service twice.", 409);
    }
    if (insertError.code === "23505") {
      throw new ContractError("This proposal has already been activated.", 409);
    }
    if (insertError.code === "23514" && /period_valid/.test(insertError.message)) {
      throw new ContractError("The end date must be after the start date.", 400);
    }
    if (isMissingTable(insertError) || isMissingFunction(insertError)) throw notMigrated();
    throw new ContractError(`Could not create the contract: ${insertError.message}`, 400);
  }
  const { data: created, error: readError } = await admin
    .from("amc_contracts")
    .select(CONTRACT_COLUMNS)
    .eq("id", String(newId))
    .single<Row>();
  if (readError || !created) throw new ContractError(readError?.message ?? "The new contract could not be read.", 500);

  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: String(created.id),
    eventType: "contract_activated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: {
      submissionId: input.submissionId,
      proposalNumber: submission.proposal_number,
      startDate: input.startDate,
      endDate: input.endDate,
      grandTotal: grandTotalFromFinal(finalPrice),
      services: entitlements.map((e) => ({
        serviceId: e.serviceId,
        type: e.entitlementType,
        included: e.includedQuantity,
      })),
      renewedFromContractId: (submission.renewal_of_contract_id as string | null) ?? null,
    },
  });
  await recordAmcAudit(admin, {
    entityType: "submission",
    entityId: input.submissionId,
    eventType: "contract_activated",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { contractId: created.id },
  });
  await notifyContractEvent(admin, {
    event: "contract_activated",
    contractId: String(created.id),
    actor,
  });

  return mapContract(created);
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export async function loadContract(
  admin: Admin,
  id: string,
): Promise<{ contract: ContractView; entitlements: ContractEntitlement[]; ownerId: string | null }> {
  const { data, error } = await admin
    .from("amc_contracts")
    .select(`${CONTRACT_COLUMNS}, amc_submissions!amc_contracts_submission_id_fkey(owner_id)`)
    .eq("id", id)
    .maybeSingle<Row>();
  if (error) {
    if (isMissingTable(error)) throw notMigrated();
    throw new ContractError(error.message, 400);
  }
  if (!data) throw new ContractError("Contract not found.", 404);

  const [{ data: ents, error: entError }, { data: successor }] = await Promise.all([
    admin
      .from("amc_contract_entitlements")
      .select(ENTITLEMENT_COLUMNS)
      .eq("contract_id", id)
      .order("sort_order", { ascending: true }),
    admin.from("amc_contracts").select("id").eq("renewed_from_contract_id", id).maybeSingle<{ id: string }>(),
  ]);
  if (entError) throw new ContractError(entError.message, 400);

  const submission = data.amc_submissions as { owner_id?: string } | null;
  return {
    contract: mapContract(data, { renewedByContractId: successor?.id ?? null }),
    entitlements: (ents ?? []).map((row) => mapEntitlement(row as Row)),
    ownerId: submission?.owner_id ?? null,
  };
}

export function toRulesContract(contract: ContractView, entitlements: ContractEntitlement[]): ContractForRules {
  return {
    id: contract.id,
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    customerRef: contract.customerRef,
    renewedByContractId: contract.renewedByContractId,
    entitlements,
  };
}

/* ------------------------------------------------------------------ */
/* Usage                                                               */
/* ------------------------------------------------------------------ */

export interface UsageInput {
  entitlementId: string;
  kind: "consumption" | "adjustment";
  quantity: number;
  occurredAt: string;
  externalType?: "fsm_work_order" | "fsm_appointment" | "schedule_entry" | null;
  externalReference?: string | null;
  notes?: string | null;
}

export async function recordUsage(
  admin: Admin,
  contractId: string,
  input: UsageInput,
  actor: { id: string; label: string | null },
) {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const entitlement = entitlements.find((e) => e.id === input.entitlementId);
  if (!entitlement) throw new ContractError("That service is not on this contract.", 404);

  const check = checkUsage({
    contract,
    entitlement,
    kind: input.kind,
    quantity: input.quantity,
    occurredAt: input.occurredAt,
    notes: input.notes,
  });
  if (!check.ok) throw new ContractError(check.error, check.status);

  const { data, error } = await admin
    .from("amc_entitlement_usage")
    .insert({
      contract_id: contractId,
      entitlement_id: input.entitlementId,
      kind: input.kind,
      quantity: check.quantity,
      occurred_at: input.occurredAt,
      source: "manual",
      external_type: input.externalReference ? (input.externalType ?? null) : null,
      external_reference: input.externalReference?.trim() || null,
      notes: input.notes?.trim() || null,
      created_by: actor.id,
    })
    .select("id, occurred_at")
    .single<{ id: string; occurred_at: string }>();
  if (error) {
    /* The database's own guards: someone else used the allowance first,
       or this FSM reference was already consumed. */
    throw usageError(error);
  }

  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: input.kind === "consumption" ? "entitlement_consumed" : "entitlement_adjusted",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: input.kind === "adjustment" ? input.notes ?? null : null,
    payload: {
      usageId: data.id,
      entitlementId: input.entitlementId,
      serviceId: entitlement.serviceId,
      quantity: check.quantity,
      occurredAt: data.occurred_at,
      externalType: input.externalReference ? input.externalType ?? null : null,
      externalReference: input.externalReference ?? null,
    },
  });
  /* A visits/hours allowance that has just run low or out tells the owner. */
  await notifyEntitlementState(admin, contractId, input.entitlementId, actor);
  return data;
}

/** The database's own guards, in words, matched on the constraint or message. */
export function usageError(error: { code?: string; message: string }): ContractError {
  const m = error.message;
  if (error.code === "23505") {
    return new ContractError("That work order / appointment has already been recorded against this service.", 409);
  }
  if (error.code === "23514") {
    if (/not_overused/.test(m)) {
      return new ContractError("That would take this service past its allowance. Reload and try again.", 409);
    }
    if (/used_nonnegative|used_quantity/.test(m)) {
      return new ContractError("That would take usage below zero. Reload and try again.", 409);
    }
    if (/Contract is not active/.test(m)) {
      return new ContractError("This contract was cancelled a moment ago. Reload it.", 409);
    }
    if (/external_pair/.test(m)) {
      return new ContractError("Choose whether the reference is a work order or an appointment.", 400);
    }
    if (/cannot take back more|reference a usage entry/.test(m)) {
      return new ContractError("That correction no longer fits this entry. Reload and try again.", 409);
    }
    if (/informational/i.test(m)) {
      return new ContractError("Informational services cannot be consumed.", 409);
    }
    return new ContractError("The database refused that entry. Reload and try again.", 409);
  }
  return new ContractError(m, 400);
}

/* ------------------------------------------------------------------ */
/* Cancellation                                                        */
/* ------------------------------------------------------------------ */

export async function cancelContract(
  admin: Admin,
  contractId: string,
  reason: string,
  actor: { id: string; label: string | null },
): Promise<ContractView> {
  const { contract } = await loadContract(admin, contractId);
  const check = canCancelContract(contract.status);
  if (!check.ok) throw new ContractError(check.error, check.status);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("amc_contracts")
    .update({
      status: "cancelled",
      cancelled_at: now,
      cancelled_by: actor.id,
      cancellation_reason: reason,
      updated_at: now,
    })
    .eq("id", contractId)
    .eq("status", "active")
    .select(CONTRACT_COLUMNS)
    .maybeSingle<Row>();
  if (error) throw new ContractError(error.message, 400);
  if (!data) throw new ContractError("The contract changed a moment ago. Reload it.", 409);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "contract_cancelled",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: reason,
    payload: { from: "active", to: "cancelled" },
  });
  return mapContract(data);
}

/* ------------------------------------------------------------------ */
/* Renewal                                                             */
/* ------------------------------------------------------------------ */

/**
 * Starts a renewal proposal: a normal draft owned by the person who asked,
 * pre-filled from the contract, priced by the server against the current
 * settings. Nothing is sent. The old contract is not touched.
 */
export async function createRenewalProposal(
  admin: Admin,
  contractId: string,
  actor: { id: string; label: string | null },
): Promise<{ submissionId: string; droppedServiceIds: string[] }> {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const { data: openRenewal } = await admin
    .from("amc_submissions")
    .select("id")
    .eq("renewal_of_contract_id", contractId)
    .limit(1)
    .maybeSingle<{ id: string }>();
  const blocked = renewalBlockedReason({
    status: contract.status,
    renewedByContractId: contract.renewedByContractId,
    hasRenewalProposal: Boolean(openRenewal),
  });
  if (blocked) throw new ContractError(blocked, 409);

  const settings = await readAmcSettings(admin);
  const unitType = String(contract.property.unitType ?? contract.unitType ?? "");
  const offered = servicesForProperty(settings, unitType).map((s) => s.id);
  const draft = buildRenewalDraft(
    {
      id: contract.id,
      startDate: contract.startDate,
      endDate: contract.endDate,
      customer: contract.customer,
      property: contract.property,
      accountManagers: contract.accountManagers,
      discountPercent: contract.discountPercent,
      entitlements,
    },
    offered,
  );

  const priced = priceSubmission({
    services: draft.services,
    discountPercent: draft.discountPercent,
    unitType,
    settings,
  });
  if (!priced.ok) throw new ContractError(priced.error, 409);

  /* Unticked rows for every other service on offer, as a new draft has. */
  const rowIds = new Set(priced.services.map((s) => s.serviceId));
  const allRows = [
    ...priced.services,
    ...servicesForProperty(settings, unitType)
      .filter((s) => !rowIds.has(s.id))
      .map((s) => ({
        serviceId: s.id,
        included: false,
        units: 1,
        frequency: s.frequencyPerYear && s.frequencyPerYear >= 1 ? Math.trunc(s.frequencyPerYear) : 1,
        basePrice: null,
        price: 0,
      })),
  ];

  const { data, error } = await admin
    .from("amc_submissions")
    .insert({
      owner_id: actor.id,
      status: "draft",
      property: draft.property,
      customer: draft.customer,
      document_options: {
        optionalSections: { supplyInstallPriceList: false, additionalFixedPriceServices: false },
        priceListRows: [],
        accountManagers: draft.accountManagers,
      },
      services: allRows,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      final_price: priced.final_price,
      generated_documents: [],
      renewal_of_contract_id: contractId,
      ...liveLinkColumns(await loadLiveLinks(admin, "amc_contracts", contractId)),
      updated_at: new Date().toISOString(),
    })
    .select("id, proposal_number, customer")
    .single<{ id: string; proposal_number: string; customer: Row }>();
  if (error) {
    /* The one-renewal-per-contract index: another click got there first. */
    if (error.code === "23505") {
      throw new ContractError("A renewal proposal already exists for this contract. Open it from AMC proposals.", 409);
    }
    throw new ContractError(error.message, 400);
  }

  /* Pin the JSON copy of the allocated number, as POST /api/amc-submissions does. */
  await admin
    .from("amc_submissions")
    .update({ customer: { ...(data.customer ?? {}), proposalNumber: data.proposal_number } })
    .eq("id", data.id);

  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "renewal_created",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: { renewalSubmissionId: data.id, droppedServiceIds: draft.droppedServiceIds },
  });
  await notifyContractEvent(admin, { event: "renewal_created", contractId, actor });
  return { submissionId: data.id, droppedServiceIds: draft.droppedServiceIds };
}
