import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CALL_OUT_CLASS_BY_SERVICE_ID,
  checkCoverage,
  coverageVerdict,
  todayInDubai,
  type CallOutClass,
  type ContractForRules,
  type CoverageResult,
  type StoredContractStatus,
} from "@/lib/amc/contracts";
import {
  AMC_FSM_AUTOMATION,
  amcServiceForFsmService,
  appointmentState,
  automationSummary,
  checkFsmCustomer,
  checkFsmService,
  isCompletedAppointment,
  mappingCoverage,
  planFsmUsage,
  slaForVisit,
  snapshotFromFsmRecord,
  type FsmAppointmentSnapshot,
  type FsmServiceMapping,
  type FsmUsagePlan,
} from "@/lib/amc/fsm-sync";
import { APPOINTMENT_STATE_LABELS } from "@/lib/scheduling/appointment-status";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import {
  ContractError,
  ENTITLEMENT_COLUMNS,
  isMissingTable,
  loadContract,
  mapEntitlement,
  usageError,
} from "@/lib/server/amc/contracts";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { getFsmContactSummary } from "@/lib/server/zoho/contacts";
import { FsmConfigError, fsmGetRecord, getFsmAccessToken } from "@/lib/server/zoho/fsm-client";
import { getFsmWorkOrderLines, searchFsmWorkOrders } from "@/lib/server/zoho/work-orders";

/**
 * Active AMC <-> Zoho FSM on the server: linking a contract to its FSM
 * customer and to FSM work, the service mapping, coverage for FSM work, and
 * the usage sync. Rules live in lib/amc/fsm-sync.ts; this reads FSM and the
 * database and writes what the rules decide. Routes check the caller first.
 *
 * Nothing here runs on a timer. A person links work and asks for a check;
 * automatic consumption stays off until AMC_FSM_AUTOMATION is switched on.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
type Visibility = { userId: string; canApprove: boolean };

const NOT_MIGRATED =
  "The FSM integration needs migration 20261006120000 (AMC FSM integration), which has not been applied to this database yet.";

function notMigrated(error: { code?: string } | null | undefined): boolean {
  return isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
}

async function fsmToken(admin: Admin): Promise<string> {
  try {
    return await getFsmAccessToken(admin);
  } catch (error) {
    if (error instanceof FsmConfigError) {
      throw new ContractError("Zoho FSM is not connected (no OAuth token in settings).", 503);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Contract FSM customer                                               */
/* ------------------------------------------------------------------ */

export interface ContractFsmCustomer {
  fsmContactId: string | null;
  fsmContactName: string | null;
  fsmCustomerId: string | null;
  linkedAt: string | null;
}

/** The contract's linked FSM customer; null when the migration is not applied. */
export async function loadContractFsmCustomer(admin: Admin, contractId: string): Promise<ContractFsmCustomer | null> {
  const { data, error } = await admin
    .from("amc_contracts")
    .select("fsm_contact_id, fsm_contact_name, fsm_customer_id, fsm_customer_linked_at")
    .eq("id", contractId)
    .maybeSingle<Row>();
  if (error) {
    if (notMigrated(error)) return null;
    throw new ContractError(error.message, 400);
  }
  return {
    fsmContactId: (data?.fsm_contact_id as string | null) ?? null,
    fsmContactName: (data?.fsm_contact_name as string | null) ?? null,
    fsmCustomerId: (data?.fsm_customer_id as string | null) ?? null,
    linkedAt: (data?.fsm_customer_linked_at as string | null) ?? null,
  };
}

/**
 * Links the contract to the FSM contact of a real work order the person
 * names. The contact's Customer_Id__C is kept for reference. A name is
 * never used to find a customer.
 */
export async function linkFsmCustomer(admin: Admin, contractId: string, workOrderId: string, actor: Actor) {
  const { contract } = await loadContract(admin, contractId);
  const wo = await getFsmWorkOrderLines(workOrderId);
  if (!wo.ok) throw new ContractError(wo.json?.error ?? "Could not read the work order from Zoho FSM.", wo.status === 404 ? 404 : 502);
  const contactId = (wo.json?.contactId as string | null) ?? null;
  if (!contactId) throw new ContractError("That work order has no FSM contact to link.", 409);

  const token = await fsmToken(admin);
  const contact = await getFsmContactSummary(token, contactId);
  if (!contact.ok) throw new ContractError("Could not read the work order's contact from Zoho FSM.", 502);

  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_contracts")
    .update({
      fsm_contact_id: contact.contact.id,
      fsm_contact_name: contact.contact.name,
      fsm_customer_id: contact.contact.customerId,
      fsm_customer_linked_at: now,
      fsm_customer_linked_by: actor.id,
      updated_at: now,
    })
    .eq("id", contractId);
  if (error) {
    if (notMigrated(error)) throw new ContractError(NOT_MIGRATED, 503);
    throw new ContractError(error.message, 400);
  }
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "fsm_customer_linked",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: {
      fsmContactId: contact.contact.id,
      fsmCustomerId: contact.contact.customerId,
      viaWorkOrder: wo.json?.workOrderName ?? workOrderId,
      contractCustomerRef: contract.customerRef,
    },
  });
  return {
    fsmContactId: contact.contact.id,
    fsmContactName: contact.contact.name,
    fsmCustomerId: contact.contact.customerId,
    /* The proposal's typed Customer ID, for the person to compare. */
    matchesProposalCustomerId:
      contract.customerRef && contact.contact.customerId
        ? contract.customerRef.trim().toUpperCase() === contact.contact.customerId.toUpperCase()
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Service mapping                                                     */
/* ------------------------------------------------------------------ */

export async function loadServiceMappings(admin: Admin): Promise<{ migrated: boolean; mappings: FsmServiceMapping[] }> {
  const { data, error } = await admin
    .from("amc_fsm_service_mappings")
    .select("amc_service_id, fsm_service_id, fsm_service_name, active");
  if (error) {
    if (notMigrated(error)) return { migrated: false, mappings: [] };
    throw new ContractError(error.message, 400);
  }
  return {
    migrated: true,
    mappings: ((data ?? []) as Row[]).map((r) => ({
      amcServiceId: String(r.amc_service_id),
      fsmServiceId: String(r.fsm_service_id),
      fsmServiceName: (r.fsm_service_name as string | null) ?? null,
      active: Boolean(r.active),
    })),
  };
}

/** The AMC catalogue with each service's FSM mapping, for the admin screen. */
export async function serviceMappingOverview(admin: Admin) {
  const [settings, { migrated, mappings }] = await Promise.all([readAmcSettings(admin), loadServiceMappings(admin)]);
  return {
    migrated,
    services: settings.services.map((s) => {
      const m = mappings.find((x) => x.amcServiceId === s.id) ?? null;
      return {
        amcServiceId: s.id,
        label: s.label,
        frequencyType: s.frequencyType,
        fsmServiceId: m?.fsmServiceId ?? null,
        fsmServiceName: m?.fsmServiceName ?? null,
        active: m?.active ?? false,
        status: !m ? "unmapped" : m.active ? "mapped" : "inactive",
      };
    }),
  };
}

export async function saveServiceMapping(
  admin: Admin,
  input: { amcServiceId: string; fsmServiceId: string | null; fsmServiceName?: string | null; active: boolean },
  actor: Actor,
) {
  const settings = await readAmcSettings(admin);
  if (!settings.services.some((s) => s.id === input.amcServiceId)) {
    throw new ContractError("That AMC service is not in the catalogue.", 404);
  }
  if (!input.fsmServiceId) {
    const { error } = await admin.from("amc_fsm_service_mappings").delete().eq("amc_service_id", input.amcServiceId);
    if (error) throw notMigrated(error) ? new ContractError(NOT_MIGRATED, 503) : new ContractError(error.message, 400);
  } else {
    const { error } = await admin.from("amc_fsm_service_mappings").upsert(
      {
        amc_service_id: input.amcServiceId,
        fsm_service_id: input.fsmServiceId.trim(),
        fsm_service_name: input.fsmServiceName?.trim() || null,
        active: input.active,
        updated_by: actor.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "amc_service_id" },
    );
    if (error) {
      if (notMigrated(error)) throw new ContractError(NOT_MIGRATED, 503);
      if (error.code === "23505") {
        throw new ContractError("That FSM service is already mapped to another AMC service.", 409);
      }
      throw new ContractError(error.message, 400);
    }
  }
  await recordAmcAudit(admin, {
    entityType: "settings",
    eventType: input.fsmServiceId ? "fsm_service_mapping_saved" : "fsm_service_mapping_removed",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: {
      amcServiceId: input.amcServiceId,
      fsmServiceId: input.fsmServiceId,
      fsmServiceName: input.fsmServiceName ?? null,
      active: input.active,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Work order lookup                                                   */
/* ------------------------------------------------------------------ */

export interface FsmWorkOrderForAmc {
  workOrderId: string;
  workOrderName: string | null;
  contactId: string | null;
  contactName: string | null;
  lines: Array<{
    id: string;
    name: string;
    serviceId: string | null;
    serviceName: string | null;
    amcServiceId: string | null;
    status: string | null;
  }>;
  appointments: Array<{ id: string; name: string; status: string | null; state: string }>;
}

/** A work order by its FSM number (e.g. WO731) or id, with its lines' AMC mapping. */
export async function lookupFsmWorkOrder(admin: Admin, reference: string): Promise<FsmWorkOrderForAmc> {
  const ref = reference.trim();
  if (!ref) throw new ContractError("Enter a work order number.", 400);
  let workOrderId = /^\d{6,}$/.test(ref) ? ref : null;
  if (!workOrderId) {
    const found = await searchFsmWorkOrders({ workOrderName: ref });
    if (!found.ok) throw new ContractError(found.json?.error ?? "Could not search Zoho FSM.", 502);
    const results = (found.json?.results ?? []) as Array<{ id: string; name: string | null }>;
    const exact = results.find((w) => (w.name ?? "").toLowerCase() === ref.toLowerCase());
    if (!exact) {
      throw new ContractError(
        results.length ? `No work order is exactly ${ref}. Did you mean ${results[0].name}?` : `No work order ${ref} in Zoho FSM.`,
        404,
      );
    }
    workOrderId = exact.id;
  }
  const wo = await getFsmWorkOrderLines(workOrderId);
  if (!wo.ok) throw new ContractError(wo.json?.error ?? "Could not read the work order from Zoho FSM.", wo.status === 404 ? 404 : 502);
  const { mappings } = await loadServiceMappings(admin);
  const j = wo.json as Row;
  return {
    workOrderId: String(j.workOrderId),
    workOrderName: (j.workOrderName as string | null) ?? null,
    contactId: (j.contactId as string | null) ?? null,
    contactName: (j.contactName as string | null) ?? null,
    lines: ((j.serviceLineItems as Row[]) ?? []).map((l) => ({
      id: String(l.id),
      name: String(l.name ?? l.id),
      serviceId: (l.serviceId as string | null) ?? null,
      serviceName: (l.serviceName as string | null) ?? null,
      amcServiceId: amcServiceForFsmService((l.serviceId as string | null) ?? null, mappings),
      status: (l.status as string | null) ?? null,
    })),
    appointments: ((j.appointments as Row[]) ?? []).map((a) => ({
      id: String(a.id),
      name: String(a.name ?? a.id),
      status: (a.status as string | null) ?? null,
      state: String(a.state ?? "unknown"),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export interface FsmLink {
  id: string;
  contractId: string;
  entitlementId: string;
  fsmWorkOrderId: string;
  fsmWorkOrderName: string | null;
  fsmAppointmentId: string | null;
  fsmAppointmentName: string | null;
  fsmServiceLineItemId: string | null;
  fsmServiceId: string | null;
  fsmContactId: string | null;
  requestedAt: string | null;
  coverage: Row;
  source: string;
  linkedAt: string;
  linkedBy: string | null;
}

const LINK_COLUMNS =
  "id, contract_id, entitlement_id, fsm_work_order_id, fsm_work_order_name, fsm_appointment_id, fsm_appointment_name, fsm_service_line_item_id, fsm_service_id, fsm_contact_id, requested_at, coverage, source, linked_at, linker:user_profile!amc_fsm_links_linked_by_fkey(full_name, email)";

function mapLink(r: Row): FsmLink {
  const who = r.linker as { full_name?: string | null; email?: string | null } | null;
  return {
    id: String(r.id),
    contractId: String(r.contract_id),
    entitlementId: String(r.entitlement_id),
    fsmWorkOrderId: String(r.fsm_work_order_id),
    fsmWorkOrderName: (r.fsm_work_order_name as string | null) ?? null,
    fsmAppointmentId: (r.fsm_appointment_id as string | null) ?? null,
    fsmAppointmentName: (r.fsm_appointment_name as string | null) ?? null,
    fsmServiceLineItemId: (r.fsm_service_line_item_id as string | null) ?? null,
    fsmServiceId: (r.fsm_service_id as string | null) ?? null,
    fsmContactId: (r.fsm_contact_id as string | null) ?? null,
    requestedAt: (r.requested_at as string | null) ?? null,
    coverage: (r.coverage as Row) ?? {},
    source: String(r.source ?? "manual"),
    linkedAt: String(r.linked_at),
    linkedBy: who?.full_name?.trim() || who?.email || null,
  };
}

export async function loadLinks(admin: Admin, contractId: string): Promise<{ migrated: boolean; links: FsmLink[] }> {
  const { data, error } = await admin
    .from("amc_fsm_links")
    .select(LINK_COLUMNS)
    .eq("contract_id", contractId)
    .is("unlinked_at", null)
    .order("linked_at", { ascending: false });
  if (error) {
    if (notMigrated(error)) return { migrated: false, links: [] };
    throw new ContractError(error.message, 400);
  }
  return { migrated: true, links: ((data ?? []) as Row[]).map(mapLink) };
}

export interface LinkWorkInput {
  workOrderId: string;
  appointmentId?: string | null;
  serviceLineItemId?: string | null;
  entitlementId: string;
  requestedAt?: string | null;
}

/**
 * Links FSM work to one of the contract's services, after checking that
 * the work belongs to the contract's FSM customer (when linked) and runs
 * the coverage check for the record. Linking never consumes anything.
 */
export async function linkFsmWork(admin: Admin, contractId: string, input: LinkWorkInput, actor: Actor) {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const entitlement = entitlements.find((e) => e.id === input.entitlementId);
  if (!entitlement) throw new ContractError("That service is not on this contract.", 404);

  const customer = await loadContractFsmCustomer(admin, contractId);
  if (!customer) throw new ContractError(NOT_MIGRATED, 503);

  const wo = await lookupFsmWorkOrder(admin, input.workOrderId);
  const appointment = input.appointmentId ? wo.appointments.find((a) => a.id === input.appointmentId) : null;
  if (input.appointmentId && !appointment) throw new ContractError("That appointment is not on this work order.", 404);
  const line = input.serviceLineItemId ? wo.lines.find((l) => l.id === input.serviceLineItemId) : null;
  if (input.serviceLineItemId && !line) throw new ContractError("That service line is not on this work order.", 404);

  const customerCheck = checkFsmCustomer(customer.fsmContactId, wo.contactId);
  if (customerCheck === "mismatch") {
    throw new ContractError(
      "This work order belongs to a different FSM customer than the one linked to this contract.",
      409,
    );
  }
  const { mappings } = await loadServiceMappings(admin);
  const serviceCheck = checkFsmService(line?.serviceId ?? null, entitlement.serviceId, mappings);
  if (serviceCheck === "mismatch") {
    throw new ContractError("That service line is mapped to a different AMC service.", 409);
  }

  /* Coverage for the record: on the requested date, else today. */
  const date = (input.requestedAt ?? "").slice(0, 10) || todayInDubai();
  const rules: ContractForRules = {
    id: contract.id,
    status: contract.status,
    startDate: contract.startDate,
    endDate: contract.endDate,
    customerRef: contract.customerRef,
    entitlements,
  };
  const coverage = checkCoverage([rules], { serviceId: entitlement.serviceId, date });
  const verdict = coverageVerdict(coverage, entitlement.serviceLabel);

  const { data, error } = await admin
    .from("amc_fsm_links")
    .insert({
      contract_id: contractId,
      entitlement_id: entitlement.id,
      fsm_work_order_id: wo.workOrderId,
      fsm_work_order_name: wo.workOrderName,
      fsm_appointment_id: appointment?.id ?? null,
      fsm_appointment_name: appointment?.name ?? null,
      fsm_service_line_item_id: line?.id ?? null,
      fsm_service_id: line?.serviceId ?? null,
      fsm_contact_id: wo.contactId,
      requested_at: input.requestedAt || null,
      coverage: {
        date,
        verdict: verdict.verdict,
        headline: verdict.headline,
        included: coverage.included,
        used: coverage.used,
        remaining: coverage.remaining,
        customer: customerCheck,
        service: serviceCheck,
      },
      source: "manual",
      linked_by: actor.id,
    })
    .select(LINK_COLUMNS)
    .single<Row>();
  if (error) {
    if (notMigrated(error)) throw new ContractError(NOT_MIGRATED, 503);
    if (error.code === "23505") {
      throw new ContractError(
        appointment
          ? "That appointment is already linked to an AMC contract."
          : "That work order is already linked to an AMC contract.",
        409,
      );
    }
    throw new ContractError(error.message, 400);
  }
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: appointment ? "fsm_appointment_linked" : "fsm_work_linked",
    actorId: actor.id,
    actorLabel: actor.label,
    payload: {
      linkId: data.id,
      fsmWorkOrderId: wo.workOrderId,
      fsmWorkOrderName: wo.workOrderName,
      fsmAppointmentId: appointment?.id ?? null,
      entitlementId: entitlement.id,
      serviceId: entitlement.serviceId,
      verdict: verdict.verdict,
      customer: customerCheck,
      service: serviceCheck,
    },
  });
  return { link: mapLink(data), verdict, customerCheck, serviceCheck };
}

export async function unlinkFsmWork(admin: Admin, contractId: string, linkId: string, reason: string, actor: Actor) {
  const { data, error } = await admin
    .from("amc_fsm_links")
    .update({ unlinked_at: new Date().toISOString(), unlinked_by: actor.id, unlink_reason: reason })
    .eq("id", linkId)
    .eq("contract_id", contractId)
    .is("unlinked_at", null)
    .select("id, fsm_work_order_id, fsm_appointment_id")
    .maybeSingle<Row>();
  if (error) throw notMigrated(error) ? new ContractError(NOT_MIGRATED, 503) : new ContractError(error.message, 400);
  if (!data) throw new ContractError("That link is not on this contract.", 404);
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "fsm_work_unlinked",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: reason,
    payload: { linkId, fsmWorkOrderId: data.fsm_work_order_id, fsmAppointmentId: data.fsm_appointment_id },
  });
}

/* ------------------------------------------------------------------ */
/* Coverage for FSM work (reusable; never consumes)                    */
/* ------------------------------------------------------------------ */

export interface FsmCoverageInput {
  /** The FSM Contacts id of the customer. */
  fsmContactId: string;
  /** The FSM service on the work, mapped to an AMC service... */
  fsmServiceId?: string | null;
  /** ...or the AMC service directly... */
  amcServiceId?: string | null;
  /** ...or a call-out class. */
  callOutClass?: CallOutClass | null;
  date?: string;
}

export interface FsmCoverageAnswer {
  status: "no_amc" | "amc_active" | "service_unmapped";
  contractId: string | null;
  proposalNumber: string | null;
  amcServiceId: string | null;
  coverage: CoverageResult | null;
  verdict: ReturnType<typeof coverageVerdict> | null;
  reason: string;
}

/**
 * Is FSM work for this FSM customer covered by an AMC? Finds the
 * contracts linked to the FSM contact (only those the caller may see),
 * resolves the service through the explicit mapping, and asks the
 * coverage engine. Read-only.
 */
export async function fsmCoverage(admin: Admin, who: Visibility, input: FsmCoverageInput): Promise<FsmCoverageAnswer> {
  const date = input.date ?? todayInDubai();
  const { mappings } = await loadServiceMappings(admin);
  const amcServiceId =
    input.amcServiceId ??
    amcServiceForFsmService(input.fsmServiceId ?? null, mappings) ??
    (input.callOutClass
      ? Object.entries(CALL_OUT_CLASS_BY_SERVICE_ID).find(([, c]) => c === input.callOutClass)?.[0] ?? null
      : null);

  let q = admin
    .from("amc_contracts")
    .select(
      `id, status, start_date, end_date, customer_ref, proposal_number, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id), amc_contract_entitlements(${ENTITLEMENT_COLUMNS})`,
    )
    .eq("fsm_contact_id", input.fsmContactId);
  if (!who.canApprove) q = q.eq("amc_submissions.owner_id", who.userId);
  const { data, error } = await q;
  if (error) {
    if (notMigrated(error)) throw new ContractError(NOT_MIGRATED, 503);
    throw new ContractError(error.message, 400);
  }
  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    return {
      status: "no_amc",
      contractId: null,
      proposalNumber: null,
      amcServiceId,
      coverage: null,
      verdict: null,
      reason: "No AMC contract is linked to this FSM customer.",
    };
  }
  if (!amcServiceId) {
    return {
      status: "service_unmapped",
      contractId: null,
      proposalNumber: null,
      amcServiceId: null,
      coverage: null,
      verdict: null,
      reason: "This FSM service is not mapped to an AMC service.",
    };
  }
  const contracts: ContractForRules[] = rows.map((r) => ({
    id: String(r.id),
    status: r.status as StoredContractStatus,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    customerRef: (r.customer_ref as string | null) ?? null,
    entitlements: ((r.amc_contract_entitlements as Row[]) ?? []).map(mapEntitlement),
  }));
  const coverage = checkCoverage(contracts, { serviceId: amcServiceId, date });
  const label =
    contracts.flatMap((c) => c.entitlements).find((e) => e.serviceId === amcServiceId)?.serviceLabel ?? amcServiceId;
  const verdict = coverageVerdict(coverage, label);
  const contractRow = rows.find((r) => String(r.id) === coverage.contractId);
  return {
    status: coverage.amcStatus === "active" ? "amc_active" : "no_amc",
    contractId: coverage.contractId,
    proposalNumber: (contractRow?.proposal_number as string | null) ?? null,
    amcServiceId,
    coverage,
    verdict,
    reason: coverage.reason,
  };
}

/**
 * The AMC context of an FSM work order, for the scheduling board: its
 * customer's AMC (if linked), each line's coverage, and existing links.
 */
export async function fsmContextForWorkOrder(admin: Admin, who: Visibility, workOrderId: string, date?: string) {
  const wo = await lookupFsmWorkOrder(admin, workOrderId);
  const { data: linkRows } = await admin
    .from("amc_fsm_links")
    .select("id, contract_id, entitlement_id, fsm_appointment_id")
    .eq("fsm_work_order_id", wo.workOrderId)
    .is("unlinked_at", null);
  if (!wo.contactId) {
    return { workOrder: wo, status: "no_contact" as const, lines: [], links: linkRows ?? [] };
  }
  const lines = await Promise.all(
    wo.lines.map(async (l) => ({
      lineId: l.id,
      lineName: l.name,
      serviceName: l.serviceName,
      answer: await fsmCoverage(admin, who, { fsmContactId: wo.contactId!, fsmServiceId: l.serviceId, date }),
    })),
  );
  const anyAmc = lines.some((l) => l.answer.status !== "no_amc");
  return { workOrder: wo, status: anyAmc ? ("checked" as const) : ("no_amc" as const), lines, links: linkRows ?? [] };
}

/* ------------------------------------------------------------------ */
/* Usage sync                                                          */
/* ------------------------------------------------------------------ */

export interface SyncOutcome {
  appointmentId: string;
  appointmentName: string | null;
  status: "recorded" | "skipped" | "needs_review" | "failed" | "reversed";
  code: string;
  reason: string;
  usageId: string | null;
  suggestedQuantity: number | null;
}

/** This appointment's consumption on this entitlement, net of corrections. */
async function existingFsmUsage(admin: Admin, entitlementId: string, appointmentId: string) {
  const { data } = await admin
    .from("amc_entitlement_usage")
    .select("id, quantity")
    .eq("entitlement_id", entitlementId)
    .eq("external_type", "fsm_appointment")
    .eq("external_reference", appointmentId)
    .eq("kind", "consumption")
    .maybeSingle<{ id: string; quantity: number }>();
  if (!data) return { usageId: null, netQuantity: 0 };
  const { data: corrections } = await admin
    .from("amc_entitlement_usage")
    .select("quantity")
    .eq("corrects_usage_id", data.id)
    .eq("kind", "correction");
  const corrected = (corrections ?? []).reduce((s, r) => s + Number((r as Row).quantity), 0);
  return { usageId: data.id, netQuantity: Math.round((Number(data.quantity) + corrected) * 100) / 100 };
}

/** Records the attempt and FSM's view of the appointment. */
async function logSyncEvent(
  admin: Admin,
  values: {
    appointmentId: string;
    action: "consume" | "reverse";
    contractId: string;
    linkId: string;
    status: "pending" | "recorded" | "skipped" | "needs_review" | "failed";
    reason: string;
    snapshot: FsmAppointmentSnapshot | null;
    usageId?: string | null;
  },
) {
  const now = new Date().toISOString();
  const { data: prior } = await admin
    .from("amc_fsm_sync_events")
    .select("id, attempts, status, reason")
    .eq("fsm_appointment_id", values.appointmentId)
    .eq("action", values.action)
    .maybeSingle<{ id: string; attempts: number; status: string; reason: string | null }>();
  const row = {
    fsm_appointment_id: values.appointmentId,
    action: values.action,
    contract_id: values.contractId,
    link_id: values.linkId,
    status: values.status,
    reason: values.reason,
    fsm_status: values.snapshot?.status ?? null,
    fsm_work_order_id: values.snapshot?.workOrderId ?? null,
    fsm_appointment_name: values.snapshot?.name ?? null,
    fsm_scheduled_start_at: values.snapshot?.scheduledStart ?? null,
    fsm_actual_start_at: values.snapshot?.actualStart ?? null,
    fsm_actual_end_at: values.snapshot?.actualEnd ?? null,
    fsm_actual_duration_seconds: values.snapshot?.actualDurationSeconds ?? null,
    usage_id: values.usageId ?? null,
    attempts: (prior?.attempts ?? 0) + 1,
    last_attempt_at: now,
    resolved_at: values.status === "recorded" || values.status === "skipped" ? now : null,
  };
  if (prior) {
    /* A recorded event keeps its usage id even if a later check skips. */
    if (prior.status === "recorded" && values.status === "skipped") delete (row as Partial<typeof row>).usage_id;
    await admin.from("amc_fsm_sync_events").update(row).eq("id", prior.id);
  } else {
    await admin.from("amc_fsm_sync_events").insert(row);
  }
  return { changed: !prior || prior.status !== values.status || prior.reason !== values.reason };
}

/**
 * Checks one FSM appointment against its linked entitlement and, when the
 * rules allow, records (or reverses) the usage. Safe to repeat: the ledger's
 * unique (entitlement, fsm_appointment, id) key means an appointment is
 * consumed at most once, and a reversal can never take back more than was
 * recorded.
 *
 * `confirm`: a person confirms the plan (and enters hours where FSM has
 * none). Without it, only plans the automation allows are written.
 */
export async function syncFsmAppointment(
  admin: Admin,
  contractId: string,
  appointmentId: string,
  options: { actor: Actor; confirm?: { quantity?: number | null } | null; token?: string },
): Promise<SyncOutcome> {
  const { links, migrated } = await loadLinks(admin, contractId);
  if (!migrated) throw new ContractError(NOT_MIGRATED, 503);

  const token = options.token ?? (await fsmToken(admin));
  const read = await fsmGetRecord<Row>(token, "Service_Appointments", appointmentId);
  const snapshot = read.ok && read.record ? snapshotFromFsmRecord(read.record) : null;
  const link =
    links.find((l) => l.fsmAppointmentId === appointmentId) ??
    (snapshot?.workOrderId ? links.find((l) => !l.fsmAppointmentId && l.fsmWorkOrderId === snapshot.workOrderId) : undefined);
  if (!link) throw new ContractError("That appointment is not linked to this contract.", 404);

  if (!snapshot) {
    const reason = `Could not read the appointment from Zoho FSM (status ${read.status}).`;
    await logSyncEvent(admin, { appointmentId, action: "consume", contractId, linkId: link.id, status: "failed", reason, snapshot: null });
    return { appointmentId, appointmentName: link.fsmAppointmentName, status: "failed", code: "fsm_unavailable", reason, usageId: null, suggestedQuantity: null };
  }

  const { contract, entitlements } = await loadContract(admin, contractId);
  const entitlement = entitlements.find((e) => e.id === link.entitlementId);
  if (!entitlement) throw new ContractError("The linked service is no longer on this contract.", 409);
  const customer = await loadContractFsmCustomer(admin, contractId);
  const { mappings } = await loadServiceMappings(admin);
  const existing = await existingFsmUsage(admin, link.entitlementId, appointmentId);

  const plan: FsmUsagePlan = planFsmUsage({
    snapshot,
    contract: { ...contract, fsmContactId: customer?.fsmContactId ?? null },
    entitlement,
    linkFsmServiceId: link.fsmServiceId,
    mappings,
    existing,
    confirm: options.confirm ?? null,
  });

  const base = { appointmentId, appointmentName: snapshot.name, suggestedQuantity: null as number | null };
  const auditSkip = async (eventType: "fsm_usage_skipped" | "fsm_mapping_failed", code: string, reason: string) => {
    await recordAmcAudit(admin, {
      entityType: "contract",
      entityId: contractId,
      eventType,
      actorId: options.actor.id,
      actorLabel: options.actor.label,
      origin: options.actor.id ? "portal" : "system",
      payload: { fsmAppointmentId: appointmentId, fsmStatus: snapshot.status, code, reason },
    });
  };

  if (plan.action === "skip") {
    const { changed } = await logSyncEvent(admin, {
      appointmentId,
      action: "consume",
      contractId,
      linkId: link.id,
      status: "skipped",
      reason: plan.reason,
      snapshot,
    });
    /* Only worth an audit line when the answer changes and it is not routine. */
    if (changed && plan.code !== "not_completed" && plan.code !== "already_recorded") {
      await auditSkip(plan.code.endsWith("mismatch") ? "fsm_mapping_failed" : "fsm_usage_skipped", plan.code, plan.reason);
    }
    return { ...base, status: "skipped", code: plan.code, reason: plan.reason, usageId: existing.usageId };
  }

  if (plan.action === "review") {
    await logSyncEvent(admin, {
      appointmentId,
      action: "consume",
      contractId,
      linkId: link.id,
      status: "needs_review",
      reason: plan.reason,
      snapshot,
    });
    return { ...base, status: "needs_review", code: plan.code, reason: plan.reason, usageId: null, suggestedQuantity: plan.suggestedQuantity };
  }

  if (plan.action === "reverse") {
    if (!plan.autoAllowed && !options.confirm) {
      await logSyncEvent(admin, {
        appointmentId,
        action: "reverse",
        contractId,
        linkId: link.id,
        status: "needs_review",
        reason: plan.reason,
        snapshot,
      });
      return { ...base, status: "needs_review", code: plan.code, reason: plan.reason, usageId: existing.usageId };
    }
    const note = `FSM appointment ${snapshot.name ?? appointmentId} is ${snapshot.status ?? "no longer completed"}; usage taken back.`;
    const { data, error } = await admin
      .from("amc_entitlement_usage")
      .insert({
        contract_id: contractId,
        entitlement_id: entitlement.id,
        kind: "correction",
        quantity: -plan.quantity,
        occurred_at: new Date().toISOString(),
        source: "fsm",
        notes: note,
        corrects_usage_id: plan.correctsUsageId,
        fsm_work_order_id: snapshot.workOrderId,
        fsm_synced_at: new Date().toISOString(),
        created_by: options.actor.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) {
      const failure = usageError(error);
      await logSyncEvent(admin, { appointmentId, action: "reverse", contractId, linkId: link.id, status: "failed", reason: failure.message, snapshot });
      return { ...base, status: "failed", code: "write_refused", reason: failure.message, usageId: null };
    }
    await logSyncEvent(admin, { appointmentId, action: "reverse", contractId, linkId: link.id, status: "recorded", reason: note, snapshot, usageId: data.id });
    await recordAmcAudit(admin, {
      entityType: "contract",
      entityId: contractId,
      eventType: "fsm_usage_reversed",
      actorId: options.actor.id,
      actorLabel: options.actor.label,
      origin: options.actor.id ? "portal" : "system",
      justification: note,
      payload: { usageId: data.id, correctsUsageId: plan.correctsUsageId, fsmAppointmentId: appointmentId, quantity: -plan.quantity },
    });
    return { ...base, status: "reversed", code: plan.code, reason: note, usageId: data.id };
  }

  /* consume */
  if (!plan.autoAllowed && !options.confirm) {
    /* Unreachable by construction (planFsmUsage returns "review"), kept as a guard. */
    return { ...base, status: "needs_review", code: "automation_disabled", reason: plan.reason, usageId: null };
  }
  const syncedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("amc_entitlement_usage")
    .insert({
      contract_id: contractId,
      entitlement_id: entitlement.id,
      kind: "consumption",
      quantity: plan.quantity,
      occurred_at: plan.occurredAt,
      source: "fsm",
      external_type: "fsm_appointment",
      external_reference: appointmentId,
      fsm_work_order_id: snapshot.workOrderId,
      fsm_synced_at: syncedAt,
      notes: `FSM appointment ${snapshot.name ?? appointmentId} (${snapshot.status})${options.confirm ? ", confirmed" : ", automatic"}.`,
      created_by: options.actor.id,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    /* Already recorded (by hand or an earlier run): the idempotency key held. */
    if (error.code === "23505") {
      const again = await existingFsmUsage(admin, link.entitlementId, appointmentId);
      await logSyncEvent(admin, { appointmentId, action: "consume", contractId, linkId: link.id, status: "skipped", reason: "Already recorded.", snapshot, usageId: again.usageId });
      return { ...base, status: "skipped", code: "already_recorded", reason: "This appointment is already recorded against this service.", usageId: again.usageId };
    }
    const failure = usageError(error);
    await logSyncEvent(admin, { appointmentId, action: "consume", contractId, linkId: link.id, status: "failed", reason: failure.message, snapshot });
    return { ...base, status: "failed", code: "write_refused", reason: failure.message, usageId: null };
  }
  await logSyncEvent(admin, { appointmentId, action: "consume", contractId, linkId: link.id, status: "recorded", reason: plan.reason, snapshot, usageId: data.id });
  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "fsm_usage_recorded",
    actorId: options.actor.id,
    actorLabel: options.actor.label,
    origin: options.actor.id ? "portal" : "system",
    payload: {
      usageId: data.id,
      fsmAppointmentId: appointmentId,
      fsmWorkOrderId: snapshot.workOrderId,
      quantity: plan.quantity,
      automatic: plan.autoAllowed && !options.confirm,
      warnings: plan.warnings,
    },
  });
  return { ...base, status: "recorded", code: "completed", reason: plan.reason, usageId: data.id };
}

/** The appointment ids behind a contract's links (work-order links expand to their live appointments). */
async function linkedAppointmentIds(links: FsmLink[]): Promise<string[]> {
  const ids = new Set<string>();
  for (const l of links) {
    if (l.fsmAppointmentId) {
      ids.add(l.fsmAppointmentId);
      continue;
    }
    const wo = await getFsmWorkOrderLines(l.fsmWorkOrderId);
    if (!wo.ok) continue;
    for (const a of ((wo.json?.appointments ?? []) as Array<{ id: string; state: string }>)) {
      if (a.state !== "cancelled") ids.add(a.id);
    }
  }
  return [...ids];
}

/**
 * Re-reads every linked appointment from FSM and applies the rules
 * (nothing is written while automation is off, apart from the sync log).
 * Bounded so one contract cannot exhaust FSM's API credits.
 */
export async function checkContractFsm(admin: Admin, contractId: string, actor: Actor) {
  const { links, migrated } = await loadLinks(admin, contractId);
  if (!migrated) throw new ContractError(NOT_MIGRATED, 503);
  const token = await fsmToken(admin);
  const ids = (await linkedAppointmentIds(links)).slice(0, 40);
  const outcomes: SyncOutcome[] = [];
  for (let i = 0; i < ids.length; i += 4) {
    const batch = await Promise.all(
      ids.slice(i, i + 4).map((id) =>
        syncFsmAppointment(admin, contractId, id, { actor, token }).catch((error) => ({
          appointmentId: id,
          appointmentName: null,
          status: "failed" as const,
          code: "error",
          reason: error instanceof Error ? error.message : "Unexpected error",
          usageId: null,
          suggestedQuantity: null,
        })),
      ),
    );
    outcomes.push(...batch);
  }
  return { checked: outcomes.length, outcomes };
}

/* ------------------------------------------------------------------ */
/* Contract activity: integration status, visits, upcoming             */
/* ------------------------------------------------------------------ */

export interface FsmVisit {
  key: string;
  date: string | null;
  serviceLabel: string;
  entitlementId: string | null;
  workOrder: string | null;
  appointment: string | null;
  appointmentId: string | null;
  technicians: string[];
  fsmStatus: string | null;
  stateLabel: string | null;
  checkedAt: string | null;
  usage: { quantity: number; source: string; kind: string } | null;
  syncStatus: string | null;
  syncReason: string | null;
  coverage: string | null;
  sla: { label: string; state: string; actualMinutes: number | null; missing: string | null } | null;
  manual: boolean;
}

export async function contractFsmActivity(admin: Admin, contractId: string) {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const [customer, { links, migrated }, { mappings, migrated: mappingsMigrated }] = await Promise.all([
    loadContractFsmCustomer(admin, contractId),
    loadLinks(admin, contractId),
    loadServiceMappings(admin),
  ]);
  const automation = automationSummary(AMC_FSM_AUTOMATION);
  const coverageOfMappings = mappingCoverage(entitlements, mappings);
  const callOutClasses = entitlements.map((e) => e.callOutClass).filter(Boolean);

  const base = {
    migrated: migrated && mappingsMigrated && customer !== null,
    status: {
      customer: customer?.fsmContactId ? ("linked" as const) : ("missing" as const),
      fsmCustomer: customer,
      proposalCustomerRef: contract.customerRef,
      mappings: coverageOfMappings,
      linkedWork: links.length,
      linkedAppointments: links.filter((l) => l.fsmAppointmentId).length,
      automation,
      completionStatuses: [...AMC_FSM_AUTOMATION.completedStatuses],
      /* Request times are entered on links; attendance/booking times are not mapped. */
      slaTracking: callOutClasses.length === 0 ? ("not_applicable" as const) : ("unavailable" as const),
    },
  };
  if (!base.migrated) return { ...base, links: [], visits: [] as FsmVisit[], upcoming: [], syncEvents: [] };

  const byEnt = new Map(entitlements.map((e) => [e.id, e]));
  const woIds = [...new Set(links.map((l) => l.fsmWorkOrderId))];
  const apptIds = links.map((l) => l.fsmAppointmentId).filter((x): x is string => Boolean(x));

  /* Scheduling board rows for the linked work (current versions only). */
  const scheduleRows: Row[] = [];
  if (woIds.length) {
    const { data } = await admin
      .from("schedule_entries")
      .select(
        "id, fsm_work_order_id, fsm_work_order_name, fsm_appointment_id, fsm_appointment_name, start_at, end_at, operating_date, fsm_status, fsm_status_checked_at, title, schedule_entry_assignments(technician_fsm_id), schedule_versions!inner(is_current)",
      )
      .in("fsm_work_order_id", woIds.slice(0, 100))
      .eq("schedule_versions.is_current", true)
      .order("start_at", { ascending: true });
    scheduleRows.push(...((data ?? []) as Row[]));
  }
  const techIds = [
    ...new Set(
      scheduleRows.flatMap((r) => ((r.schedule_entry_assignments as Row[]) ?? []).map((a) => String(a.technician_fsm_id))),
    ),
  ];
  const { data: techRows } = techIds.length
    ? await admin.from("technician_reference").select("fsm_resource_id, display_name").in("fsm_resource_id", techIds)
    : { data: [] as Row[] };
  const techName = new Map(((techRows ?? []) as Row[]).map((t) => [String(t.fsm_resource_id), String(t.display_name ?? "")]));

  const [{ data: syncRows }, { data: usageRows }] = await Promise.all([
    admin.from("amc_fsm_sync_events").select("*").eq("contract_id", contractId).order("last_attempt_at", { ascending: false }),
    admin
      .from("amc_entitlement_usage")
      .select("id, entitlement_id, kind, quantity, occurred_at, source, external_type, external_reference, fsm_work_order_id, created_at")
      .eq("contract_id", contractId)
      .order("occurred_at", { ascending: false })
      .limit(300),
  ]);
  const syncs = (syncRows ?? []) as Row[];
  const usages = (usageRows ?? []) as Row[];

  const linkFor = (appointmentId: string | null, workOrderId: string | null) =>
    links.find((l) => appointmentId && l.fsmAppointmentId === appointmentId) ??
    links.find((l) => !l.fsmAppointmentId && workOrderId && l.fsmWorkOrderId === workOrderId) ??
    null;
  const now = Date.now();

  /* One row per appointment seen anywhere: board, sync log, ledger, link. */
  const visits = new Map<string, FsmVisit>();
  const visitFor = (appointmentId: string, workOrderId: string | null): FsmVisit => {
    const existing = visits.get(appointmentId);
    if (existing) return existing;
    const link = linkFor(appointmentId, workOrderId);
    const ent = link ? byEnt.get(link.entitlementId) : undefined;
    const v: FsmVisit = {
      key: appointmentId,
      date: null,
      serviceLabel: ent?.serviceLabel ?? "Linked work",
      entitlementId: ent?.id ?? null,
      workOrder: link?.fsmWorkOrderName ?? workOrderId,
      appointment: link?.fsmAppointmentName ?? null,
      appointmentId,
      technicians: [],
      fsmStatus: null,
      stateLabel: null,
      checkedAt: null,
      usage: null,
      syncStatus: null,
      syncReason: null,
      coverage: (link?.coverage?.headline as string | undefined) ?? null,
      sla: null,
      manual: false,
    };
    visits.set(appointmentId, v);
    return v;
  };

  for (const r of scheduleRows) {
    const id = r.fsm_appointment_id as string | null;
    if (!id || (!apptIds.includes(id) && !links.some((l) => !l.fsmAppointmentId && l.fsmWorkOrderId === r.fsm_work_order_id))) continue;
    const v = visitFor(id, (r.fsm_work_order_id as string | null) ?? null);
    v.date = v.date ?? String(r.start_at);
    v.workOrder = (r.fsm_work_order_name as string | null) ?? v.workOrder;
    v.appointment = (r.fsm_appointment_name as string | null) ?? v.appointment;
    v.technicians = ((r.schedule_entry_assignments as Row[]) ?? []).map((a) => techName.get(String(a.technician_fsm_id)) || "Technician");
    v.fsmStatus = (r.fsm_status as string | null) ?? v.fsmStatus;
    v.checkedAt = (r.fsm_status_checked_at as string | null) ?? v.checkedAt;
  }
  /* Reversal checks first, so a consume check of the same appointment (newer or not) does not hide one waiting for review. */
  for (const s of syncs.filter((x) => x.action === "reverse")) {
    const v = visitFor(String(s.fsm_appointment_id), (s.fsm_work_order_id as string | null) ?? null);
    if (s.status === "needs_review" || s.status === "recorded") {
      v.syncStatus = String(s.status);
      v.syncReason = (s.reason as string | null) ?? null;
    }
  }
  for (const s of syncs) {
    if (s.action !== "consume") continue;
    const v = visitFor(String(s.fsm_appointment_id), (s.fsm_work_order_id as string | null) ?? null);
    const checked = s.last_attempt_at as string | null;
    if (!v.checkedAt || (checked && checked > v.checkedAt)) {
      v.fsmStatus = (s.fsm_status as string | null) ?? v.fsmStatus;
      v.checkedAt = checked;
    }
    v.date = (s.fsm_actual_end_at as string | null) ?? (s.fsm_scheduled_start_at as string | null) ?? v.date;
    v.appointment = (s.fsm_appointment_name as string | null) ?? v.appointment;
    if (v.syncStatus !== "needs_review") {
      v.syncStatus = String(s.status);
      v.syncReason = (s.reason as string | null) ?? null;
    }
    const link = linkFor(String(s.fsm_appointment_id), (s.fsm_work_order_id as string | null) ?? null);
    const ent = link ? byEnt.get(link.entitlementId) : undefined;
    const sla = slaForVisit(ent?.callOutClass ?? null, {
      requestedAt: link?.requestedAt ?? null,
      snapshot: { actualStart: (s.fsm_actual_start_at as string | null) ?? null },
      completed: isCompletedAppointment({ status: (s.fsm_status as string | null) ?? null, actualEnd: (s.fsm_actual_end_at as string | null) ?? null }),
    });
    if (ent?.callOutClass) {
      v.sla = {
        label: ent.callOutClass === "emergency" ? "Emergency: 120 min" : "Non-emergency: 6 h",
        state: sla.state,
        actualMinutes: sla.actualMinutes,
        missing: sla.missing,
      };
    }
  }
  for (const u of usages) {
    const ent = byEnt.get(String(u.entitlement_id));
    if (u.external_type === "fsm_appointment" && u.external_reference) {
      const v = visitFor(String(u.external_reference), (u.fsm_work_order_id as string | null) ?? null);
      if (u.kind === "consumption") {
        v.usage = { quantity: Number(u.quantity), source: String(u.source), kind: "consumption" };
        v.date = v.date ?? String(u.occurred_at);
        v.serviceLabel = ent?.serviceLabel ?? v.serviceLabel;
      }
    } else if (u.kind === "consumption") {
      /* Recorded by hand with no FSM appointment: listed as such. */
      visits.set(`manual:${u.id}`, {
        key: `manual:${u.id}`,
        date: String(u.occurred_at),
        serviceLabel: ent?.serviceLabel ?? "Service",
        entitlementId: ent?.id ?? null,
        workOrder: u.external_type === "fsm_work_order" ? String(u.external_reference) : null,
        appointment: null,
        appointmentId: null,
        technicians: [],
        fsmStatus: null,
        stateLabel: null,
        checkedAt: null,
        usage: { quantity: Number(u.quantity), source: String(u.source), kind: "consumption" },
        syncStatus: null,
        syncReason: null,
        coverage: null,
        sla: null,
        manual: true,
      });
    }
  }
  for (const v of visits.values()) {
    v.stateLabel = v.fsmStatus ? APPOINTMENT_STATE_LABELS[appointmentState({ status: v.fsmStatus })] : null;
  }

  const all = [...visits.values()];
  const upcoming = all
    .filter((v) => v.appointmentId && v.date && Date.parse(v.date) >= now)
    .filter((v) => !["completed", "cancelled", "cannot_complete"].includes(appointmentState({ status: v.fsmStatus })))
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const history = all
    .filter((v) => !upcoming.includes(v))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return {
    ...base,
    links: links.map((l) => ({ ...l, serviceLabel: byEnt.get(l.entitlementId)?.serviceLabel ?? "Service" })),
    visits: history,
    upcoming,
    syncEvents: syncs.map((s) => ({
      appointmentId: String(s.fsm_appointment_id),
      action: String(s.action),
      status: String(s.status),
      reason: (s.reason as string | null) ?? null,
      attempts: Number(s.attempts ?? 0),
      lastAttemptAt: (s.last_attempt_at as string | null) ?? null,
    })),
  };
}

export type ContractFsmActivity = Awaited<ReturnType<typeof contractFsmActivity>>;

