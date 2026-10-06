import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CALL_OUT_CLASS_BY_SERVICE_ID,
  DEFAULT_EXPIRING_WINDOW_DAYS,
  checkCorrection,
  checkCoverage,
  contractDisplayStatus,
  isExhausted,
  shiftDays,
  todayInDubai,
  type ContractForRules,
  type CoverageResult,
  type StoredContractStatus,
} from "@/lib/amc/contracts";
import { grandTotalFromFinal } from "@/lib/amc/pricing";
import {
  AMC_RENEWAL_REMINDER_DAYS,
  AMC_RENEWAL_REMINDERS_ENABLED,
  buildRenewalDraft,
  newReminders,
  planRenewalReminders,
  renewalBlockedReason,
} from "@/lib/amc/renewal";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { readNotificationSettings } from "@/lib/server/amc/notifications";
import { fetchAllRows, fetchAllRowsById } from "@/lib/server/amc/paging";
import {
  ContractError,
  ENTITLEMENT_COLUMNS,
  isMissingFunction,
  isMissingTable,
  loadContract,
  mapEntitlement,
  toRulesContract,
  usageError,
} from "@/lib/server/amc/contracts";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";

/**
 * Day-to-day contract operations: corrections, the usage history, the
 * contracts dashboard, renewal previews, renewal reminders and coverage
 * checks. Routes check who is calling before any of these run.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string; label: string | null };
type Visibility = { userId: string; canApprove: boolean };

const OPERATIONS_NOT_MIGRATED =
  "This needs migration 20261006110000 (Active AMC operations), which has not been applied to this database yet.";

/* ------------------------------------------------------------------ */
/* Usage history                                                       */
/* ------------------------------------------------------------------ */

export interface UsageEntry {
  id: string;
  entitlementId: string;
  kind: "consumption" | "adjustment" | "correction";
  quantity: number;
  occurredAt: string;
  source: string;
  externalType: string | null;
  externalReference: string | null;
  notes: string | null;
  createdAt: string;
  createdBy: string | null;
  /** For a correction: the entry it takes back. */
  correctsUsageId: string | null;
  /** For a consumption: what corrections have taken back (zero or negative). */
  correctedQuantity: number;
  /** For a consumption: what still counts after corrections. */
  netQuantity: number;
  /** Taken from FSM: the work order, and when FSM was read. */
  fsmWorkOrderId: string | null;
  fsmSyncedAt: string | null;
}

const USAGE_COLUMNS =
  "id, entitlement_id, kind, quantity, occurred_at, source, external_type, external_reference, notes, created_at, corrects_usage_id, creator:user_profile!amc_entitlement_usage_created_by_fkey(full_name, email)";
/* With migration 20261006120000: the FSM work order and read time. */
const USAGE_COLUMNS_FSM = `${USAGE_COLUMNS}, fsm_work_order_id, fsm_synced_at`;
/* Before migration 20261006110000 there is no corrects_usage_id. */
const USAGE_COLUMNS_LEGACY = USAGE_COLUMNS.replace(", corrects_usage_id", "");

function mapUsage(r: Row, corrected: Map<string, number>): UsageEntry {
  const who = r.creator as { full_name?: string | null; email?: string | null } | null;
  const quantity = Number(r.quantity);
  const correctedQuantity = corrected.get(String(r.id)) ?? 0;
  return {
    id: String(r.id),
    entitlementId: String(r.entitlement_id),
    kind: r.kind as UsageEntry["kind"],
    quantity,
    occurredAt: String(r.occurred_at),
    source: String(r.source),
    externalType: (r.external_type as string | null) ?? null,
    externalReference: (r.external_reference as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    createdAt: String(r.created_at),
    createdBy: who?.full_name?.trim() || who?.email || null,
    correctsUsageId: (r.corrects_usage_id as string | null) ?? null,
    correctedQuantity,
    netQuantity: Math.round((quantity + correctedQuantity) * 100) / 100,
    fsmWorkOrderId: (r.fsm_work_order_id as string | null) ?? null,
    fsmSyncedAt: (r.fsm_synced_at as string | null) ?? null,
  };
}

/** Sum of corrections per original entry, for the given originals. */
async function correctionsFor(admin: Admin, ids: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (ids.length === 0) return totals;
  const { data, error } = await admin
    .from("amc_entitlement_usage")
    .select("corrects_usage_id, quantity")
    .eq("kind", "correction")
    .in("corrects_usage_id", ids);
  if (error) return totals; // not migrated yet: nothing can have been corrected
  for (const row of data ?? []) {
    const id = String((row as Row).corrects_usage_id);
    totals.set(id, (totals.get(id) ?? 0) + Number((row as Row).quantity));
  }
  return totals;
}

/**
 * One page of a contract's usage, newest first, with each consumption's
 * corrected total. Entries are never edited or deleted: a mistake is
 * shown with the correction that took it back.
 */
export async function loadUsagePage(
  admin: Admin,
  contractId: string,
  { page, pageSize, entitlementId }: { page: number; pageSize: number; entitlementId?: string | null },
): Promise<{ rows: UsageEntry[]; totalCount: number }> {
  const run = (columns: string) => {
    let q = admin
      .from("amc_entitlement_usage")
      .select(columns, { count: "exact" })
      .eq("contract_id", contractId);
    if (entitlementId) q = q.eq("entitlement_id", entitlementId);
    return q
      .order("occurred_at", { ascending: false })
      .order("created_at", { ascending: false })
      .range(page * pageSize, page * pageSize + pageSize - 1);
  };
  const missingColumn = (e: { code?: string } | null) => e?.code === "42703" || e?.code === "PGRST204";
  let result = await run(USAGE_COLUMNS_FSM);
  if (result.error && missingColumn(result.error)) result = await run(USAGE_COLUMNS);
  if (result.error && missingColumn(result.error)) result = await run(USAGE_COLUMNS_LEGACY);
  if (result.error) throw new ContractError(result.error.message, 400);
  const rows = (result.data ?? []) as unknown as Row[];
  const corrected = await correctionsFor(
    admin,
    rows.filter((r) => r.kind === "consumption").map((r) => String(r.id)),
  );
  return { rows: rows.map((r) => mapUsage(r, corrected)), totalCount: result.count ?? 0 };
}

/** Counts for the summary: how many entries, and the latest consumption date. */
export async function usageStats(
  admin: Admin,
  contractId: string,
): Promise<{ usageEvents: number; lastUsageDate: string | null }> {
  const [all, last] = await Promise.all([
    admin
      .from("amc_entitlement_usage")
      .select("id", { count: "exact", head: true })
      .eq("contract_id", contractId),
    admin
      .from("amc_entitlement_usage")
      .select("occurred_at")
      .eq("contract_id", contractId)
      .eq("kind", "consumption")
      .order("occurred_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ occurred_at: string }>(),
  ]);
  return { usageEvents: all.count ?? 0, lastUsageDate: last.data?.occurred_at ?? null };
}

/* ------------------------------------------------------------------ */
/* Corrections                                                         */
/* ------------------------------------------------------------------ */

/**
 * Takes back (part of) one usage entry with a compensating 'correction'
 * entry that references it. The original stays as it was. Allowed on any
 * contract state: fixing the record is not new usage.
 */
export async function recordCorrection(
  admin: Admin,
  contractId: string,
  usageId: string,
  input: { amount: number; reason: string },
  actor: Actor,
): Promise<UsageEntry> {
  const { entitlements } = await loadContract(admin, contractId);
  const { data: original, error } = await admin
    .from("amc_entitlement_usage")
    .select("id, entitlement_id, kind, quantity, occurred_at")
    .eq("id", usageId)
    .eq("contract_id", contractId)
    .maybeSingle<Row>();
  if (error) throw new ContractError(error.message, 400);
  if (!original) throw new ContractError("That usage entry is not on this contract.", 404);

  const entitlement = entitlements.find((e) => e.id === original.entitlement_id);
  if (!entitlement) throw new ContractError("That service is not on this contract.", 404);

  const earlier = await admin
    .from("amc_entitlement_usage")
    .select("quantity")
    .eq("kind", "correction")
    .eq("corrects_usage_id", usageId);
  if (earlier.error) {
    if (earlier.error.code === "42703" || earlier.error.code === "PGRST204") {
      throw new ContractError(OPERATIONS_NOT_MIGRATED, 503);
    }
    throw new ContractError(earlier.error.message, 400);
  }
  const alreadyCorrected = (earlier.data ?? []).reduce((sum, r) => sum + Number((r as Row).quantity), 0);

  const check = checkCorrection({
    original: { kind: String(original.kind), quantity: Number(original.quantity) },
    alreadyCorrected,
    amount: input.amount,
    reason: input.reason,
    entitlementUsed: entitlement.usedQuantity,
  });
  if (!check.ok) throw new ContractError(check.error, check.status);

  const reason = input.reason.trim();
  const { data, error: insertError } = await admin
    .from("amc_entitlement_usage")
    .insert({
      contract_id: contractId,
      entitlement_id: entitlement.id,
      kind: "correction",
      quantity: check.quantity,
      /* Dated as the entry it corrects, so it lands in the same period;
         created_at records when the correction was made. */
      occurred_at: original.occurred_at,
      source: "manual",
      notes: reason,
      corrects_usage_id: usageId,
      created_by: actor.id,
    })
    .select(USAGE_COLUMNS)
    .single<Row>();
  if (insertError) {
    if (insertError.code === "42703" || insertError.code === "PGRST204") {
      throw new ContractError(OPERATIONS_NOT_MIGRATED, 503);
    }
    throw usageError(insertError);
  }

  await recordAmcAudit(admin, {
    entityType: "contract",
    entityId: contractId,
    eventType: "entitlement_corrected",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: reason,
    payload: {
      usageId: data.id,
      correctsUsageId: usageId,
      entitlementId: entitlement.id,
      serviceId: entitlement.serviceId,
      quantity: check.quantity,
      originalQuantity: Number(original.quantity),
    },
  });
  return mapUsage(data, new Map());
}

/* ------------------------------------------------------------------ */
/* Pending activation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Signed proposals with no contract yet, newest signature first. The
 * anti-join (`amc_contracts=is.null`) runs in the database so old pending
 * proposals never fall off a row limit; the rows are re-checked here too.
 */
export async function loadPendingActivations(admin: Admin, who: Visibility): Promise<Row[]> {
  const { data, error } = await fetchAllRows<Row>((from, to) => {
    let q = admin
      .from("amc_submissions")
      .select(
        "id, owner_id, proposal_number, customer, property, document_options, final_price, signed_at, amc_contracts!amc_contracts_submission_id_fkey(id)",
      )
      .eq("status", "signed")
      .is("amc_contracts", null)
      .order("signed_at", { ascending: false })
      .order("id")
      .range(from, to);
    if (!who.canApprove) q = q.eq("owner_id", who.userId);
    return q;
  });
  if (error) throw error;
  return data.filter((row) => {
    const linked = row.amc_contracts;
    return !(Array.isArray(linked) ? linked.length : linked);
  });
}

/* ------------------------------------------------------------------ */
/* Contracts dashboard                                                 */
/* ------------------------------------------------------------------ */

export interface ContractsDashboard {
  inForce: number;
  pendingActivation: number;
  expiringSoon: number;
  expired: number;
  notStarted: number;
  cancelled: number;
  /** Sum of grand totals (incl. VAT) of contracts in force today. */
  inForceValue: number;
  /** In-force contracts with at least one visit/hour allowance used up. */
  withExhaustedEntitlements: number;
  /** Consumption entries recorded in the last 30 days. */
  usageLast30Days: number;
  recentUsage: Array<{
    id: string;
    contractId: string;
    proposalNumber: string;
    customerName: string;
    serviceLabel: string;
    kind: string;
    quantity: number;
    occurredAt: string;
  }>;
  expiringWindowDays: number;
}

/**
 * The figures on the contracts page, for the contracts the caller can see.
 * Every number is counted from rows, none estimated. Counted in the
 * database (amc_contracts_dashboard, 20261006140000), so the cost does not
 * grow with the number of contracts sent to the server.
 */
export async function contractsDashboard(admin: Admin, who: Visibility): Promise<ContractsDashboard> {
  const today = todayInDubai();
  const { data, error } = await admin.rpc("amc_contracts_dashboard", {
    p_owner_id: who.canApprove ? null : who.userId,
    p_today: today,
    p_window_days: DEFAULT_EXPIRING_WINDOW_DAYS,
    p_since: `${shiftDays(today, -30)}T00:00:00+04:00`,
  });
  if (error) {
    /* Function not installed yet: count from the rows instead. */
    if (isMissingFunction(error)) return contractsDashboardFromRows(admin, who);
    if (isMissingTable(error)) {
      throw new ContractError("AMC contracts are not set up on this database yet (migration 20261006100000).", 503);
    }
    throw error;
  }
  return dashboardFromFigures(data as Row);
}

/** Maps amc_contracts_dashboard's JSON onto the page's figures. */
export function dashboardFromFigures(figures: Row): ContractsDashboard {
  const n = (v: unknown) => Number(v ?? 0);
  return {
    inForce: n(figures.inForce),
    pendingActivation: n(figures.pendingActivation),
    expiringSoon: n(figures.expiringSoon),
    expired: n(figures.expired),
    notStarted: n(figures.notStarted),
    cancelled: n(figures.cancelled),
    inForceValue: n(figures.inForceValueFils) / 100,
    withExhaustedEntitlements: n(figures.withExhaustedEntitlements),
    usageLast30Days: n(figures.usageLast30Days),
    recentUsage: ((figures.recentUsage as Row[] | null) ?? []).map((u) => ({
      id: String(u.id),
      contractId: String(u.contractId),
      proposalNumber: String(u.proposalNumber ?? ""),
      customerName: String(u.customerName ?? ""),
      serviceLabel: String(u.serviceLabel ?? ""),
      kind: String(u.kind),
      quantity: Number(u.quantity),
      occurredAt: String(u.occurredAt),
    })),
    expiringWindowDays: DEFAULT_EXPIRING_WINDOW_DAYS,
  };
}

/** The same figures counted in the server, for a database without 20261006140000. */
async function contractsDashboardFromRows(admin: Admin, who: Visibility): Promise<ContractsDashboard> {
  const today = todayInDubai();
  const { data, error } = await fetchAllRowsById<Row>((afterId, size) => {
    let q = admin
      .from("amc_contracts")
      .select(
        "id, status, start_date, end_date, grand_total, proposal_number, customer_name, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id), amc_contract_entitlements(entitlement_type, included_quantity, used_quantity)",
      )
      .order("id")
      .limit(size);
    if (afterId) q = q.gt("id", afterId);
    if (!who.canApprove) q = q.eq("amc_submissions.owner_id", who.userId);
    return q;
  });
  if (error) {
    if (isMissingTable(error)) {
      throw new ContractError("AMC contracts are not set up on this database yet (migration 20261006100000).", 503);
    }
    throw error;
  }
  const contracts = data;
  const pending = await loadPendingActivations(admin, who);

  const out: ContractsDashboard = {
    inForce: 0,
    pendingActivation: pending.length,
    expiringSoon: 0,
    expired: 0,
    notStarted: 0,
    cancelled: 0,
    inForceValue: 0,
    withExhaustedEntitlements: 0,
    usageLast30Days: 0,
    recentUsage: [],
    expiringWindowDays: DEFAULT_EXPIRING_WINDOW_DAYS,
  };
  let valueFils = 0;
  for (const c of contracts) {
    const status = contractDisplayStatus(
      { status: c.status as StoredContractStatus, startDate: String(c.start_date), endDate: String(c.end_date) },
      today,
    );
    if (status === "cancelled") out.cancelled += 1;
    else if (status === "expired") out.expired += 1;
    else if (status === "not_started") out.notStarted += 1;
    else {
      out.inForce += 1;
      if (status === "expiring") out.expiringSoon += 1;
      valueFils += Math.round(Number(c.grand_total ?? 0) * 100);
      const ents = ((c.amc_contract_entitlements as Row[]) ?? []).map((e) => ({
        entitlementType: e.entitlement_type as "visits" | "hours" | "unlimited" | "informational",
        includedQuantity: e.included_quantity === null ? null : Number(e.included_quantity),
        usedQuantity: Number(e.used_quantity ?? 0),
      }));
      if (ents.some((e) => isExhausted(e))) out.withExhaustedEntitlements += 1;
    }
  }
  out.inForceValue = valueFils / 100;

  /* Recent usage across the visible contracts. Approvers see every
     contract, so they need no filter; anyone else sees only their own,
     a short list, so the ids fit in the request. */
  const visibleIds = contracts.map((c) => String(c.id));
  if (visibleIds.length > 0) {
    const since = `${shiftDays(today, -30)}T00:00:00+04:00`;
    let recentQuery = admin
      .from("amc_entitlement_usage")
      .select("id, contract_id, kind, quantity, occurred_at, amc_contract_entitlements(service_label)")
      .order("created_at", { ascending: false })
      .limit(6);
    let countQuery = admin
      .from("amc_entitlement_usage")
      .select("id", { count: "exact", head: true })
      .eq("kind", "consumption")
      .gte("occurred_at", since);
    if (!who.canApprove) {
      const ids = visibleIds.slice(0, 200);
      recentQuery = recentQuery.in("contract_id", ids);
      countQuery = countQuery.in("contract_id", ids);
    }
    const [recent, count] = await Promise.all([recentQuery, countQuery]);
    const byId = new Map(contracts.map((c) => [String(c.id), c]));
    out.usageLast30Days = count.count ?? 0;
    out.recentUsage = ((recent.data ?? []) as Row[]).map((u) => {
      const c = byId.get(String(u.contract_id));
      return {
        id: String(u.id),
        contractId: String(u.contract_id),
        proposalNumber: String(c?.proposal_number ?? ""),
        customerName: String(c?.customer_name ?? ""),
        serviceLabel: String((u.amc_contract_entitlements as Row | null)?.service_label ?? ""),
        kind: String(u.kind),
        quantity: Number(u.quantity),
        occurredAt: String(u.occurred_at),
      };
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Renewal                                                             */
/* ------------------------------------------------------------------ */

export interface RenewalOverview {
  /** The proposal renewing this contract, if one was started. */
  renewalProposal: { id: string; proposalNumber: string; status: string } | null;
  /** The contract that replaced this one, once the renewal was activated. */
  renewedBy: { id: string; proposalNumber: string } | null;
  /** The contract this one renewed. */
  renewedFrom: { id: string; proposalNumber: string } | null;
  canCreate: boolean;
  blockedReason: string | null;
  /** What a new renewal proposal would start with. Null when it cannot be created. */
  preview: null | {
    startDate: string;
    endDate: string;
    services: Array<{ serviceId: string; label: string; units: number; frequency: number; basePrice: number | null }>;
    droppedServices: Array<{ serviceId: string; label: string }>;
    discountPercent: number;
    finalPrice: number;
    grandTotal: number;
    previousGrandTotal: number;
  };
}

/** The renewal relationships and a preview of what a renewal would copy. */
export async function renewalOverview(admin: Admin, contractId: string): Promise<RenewalOverview> {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const [proposal, successor, predecessor] = await Promise.all([
    admin
      .from("amc_submissions")
      .select("id, proposal_number, status")
      .eq("renewal_of_contract_id", contractId)
      .limit(1)
      .maybeSingle<Row>(),
    contract.renewedByContractId
      ? admin
          .from("amc_contracts")
          .select("id, proposal_number")
          .eq("id", contract.renewedByContractId)
          .maybeSingle<Row>()
      : Promise.resolve({ data: null }),
    contract.renewedFromContractId
      ? admin
          .from("amc_contracts")
          .select("id, proposal_number")
          .eq("id", contract.renewedFromContractId)
          .maybeSingle<Row>()
      : Promise.resolve({ data: null }),
  ]);

  const renewalProposal = proposal.data
    ? {
        id: String(proposal.data.id),
        proposalNumber: String(proposal.data.proposal_number ?? ""),
        status: String(proposal.data.status),
      }
    : null;
  const ref = (row: Row | null | undefined) =>
    row ? { id: String(row.id), proposalNumber: String(row.proposal_number ?? "") } : null;

  const blockedReason = renewalBlockedReason({
    status: contract.status,
    renewedByContractId: contract.renewedByContractId,
    hasRenewalProposal: Boolean(renewalProposal),
  });

  let preview: RenewalOverview["preview"] = null;
  if (!blockedReason) {
    const settings = await readAmcSettings(admin);
    const unitType = String(contract.property.unitType ?? contract.unitType ?? "");
    const offered = servicesForProperty(settings, unitType);
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
      offered.map((s) => s.id),
    );
    const priced = priceSubmission({
      services: draft.services,
      discountPercent: draft.discountPercent,
      unitType,
      settings,
    });
    const labelOf = (id: string) =>
      offered.find((s) => s.id === id)?.label ?? entitlements.find((e) => e.serviceId === id)?.serviceLabel ?? id;
    preview = {
      startDate: String(draft.customer.startDate ?? ""),
      endDate: String(draft.customer.endDate ?? ""),
      services: draft.services.map((s) => ({ ...s, label: labelOf(s.serviceId) })),
      droppedServices: draft.droppedServiceIds.map((id) => ({ serviceId: id, label: labelOf(id) })),
      discountPercent: draft.discountPercent,
      finalPrice: priced.ok ? priced.final_price : 0,
      grandTotal: priced.ok ? grandTotalFromFinal(priced.final_price) : 0,
      previousGrandTotal: contract.grandTotal,
    };
  }

  return {
    renewalProposal,
    renewedBy: ref(successor.data as Row | null),
    renewedFrom: ref(predecessor.data as Row | null),
    canCreate: !blockedReason,
    blockedReason,
    preview,
  };
}

/* ------------------------------------------------------------------ */
/* Renewal reminders                                                   */
/* ------------------------------------------------------------------ */

export interface ReminderPlan {
  enabled: boolean;
  migrated: boolean;
  thresholds: number[];
  reminders: Array<{ daysBefore: number; remindOn: string; created: boolean; todoId: string | null }>;
}

async function existingReminders(admin: Admin, contractId: string) {
  const { data, error } = await admin
    .from("amc_renewal_reminders")
    .select("threshold_days, remind_on, todo_id")
    .eq("contract_id", contractId);
  if (error) {
    if (isMissingTable(error)) return null;
    throw new ContractError(error.message, 400);
  }
  return (data ?? []) as Array<{ threshold_days: number; remind_on: string; todo_id: string | null }>;
}

/** The reminders this contract would get, and which already exist. */
export async function reminderPlan(admin: Admin, contractId: string): Promise<ReminderPlan> {
  const { contract } = await loadContract(admin, contractId);
  const existing = await existingReminders(admin, contractId);
  const settings = await readNotificationSettings(admin);
  const made = new Map((existing ?? []).map((r) => [Number(r.threshold_days), r]));
  const planned =
    contract.status === "cancelled"
      ? []
      : planRenewalReminders(contract.endDate, todayInDubai(), settings.reminderThresholds);
  /* Created ones stay listed even once their date has passed. */
  const rows = new Map<number, ReminderPlan["reminders"][number]>();
  for (const p of planned) {
    rows.set(p.daysBefore, { ...p, created: made.has(p.daysBefore), todoId: made.get(p.daysBefore)?.todo_id ?? null });
  }
  for (const [days, r] of made) {
    if (!rows.has(days)) rows.set(days, { daysBefore: days, remindOn: r.remind_on, created: true, todoId: r.todo_id });
  }
  return {
    /* The code default (off) until the settings row says otherwise. */
    enabled: AMC_RENEWAL_REMINDERS_ENABLED || settings.reminderAutoEnabled,
    migrated: existing !== null,
    thresholds: settings.reminderThresholds.length ? settings.reminderThresholds : [...AMC_RENEWAL_REMINDER_DAYS],
    reminders: [...rows.values()].sort((a, b) => a.remindOn.localeCompare(b.remindOn)),
  };
}

/**
 * Creates the missing reminder Todos for a contract. Switched off
 * (AMC_RENEWAL_REMINDERS_ENABLED) until the schedule is approved, because
 * the reminders cron emails Todos. Each reminder row is inserted before its
 * Todo; the (contract, threshold) unique key means a second run, or two at
 * once, never creates the same reminder twice.
 */
export async function createReminders(
  admin: Admin,
  contractId: string,
  actor: Actor,
): Promise<ReminderPlan> {
  const settings = await readNotificationSettings(admin);
  if (!AMC_RENEWAL_REMINDERS_ENABLED && !settings.reminderAutoEnabled) {
    throw new ContractError(
      "Renewal reminders are switched off until the reminder schedule is approved.",
      409,
    );
  }
  const { contract, ownerId } = await loadContract(admin, contractId);
  if (contract.status === "cancelled") {
    throw new ContractError("A cancelled contract gets no renewal reminders.", 409);
  }
  const existing = await existingReminders(admin, contractId);
  if (existing === null) throw new ContractError(OPERATIONS_NOT_MIGRATED, 503);
  const toCreate = newReminders(
    planRenewalReminders(contract.endDate, todayInDubai(), settings.reminderThresholds),
    existing.map((r) => Number(r.threshold_days)),
  );

  for (const reminder of toCreate) {
    const { data: slot, error } = await admin
      .from("amc_renewal_reminders")
      .insert({
        contract_id: contractId,
        threshold_days: reminder.daysBefore,
        remind_on: reminder.remindOn,
        created_by: actor.id,
      })
      .select("id")
      .single<{ id: string }>();
    if (error) {
      if (error.code === "23505") continue; // made by a parallel run
      throw new ContractError(error.message, 400);
    }
    const at = `${reminder.remindOn}T09:00:00+04:00`;
    const { data: todo, error: todoError } = await admin
      .from("todos")
      .insert({
        owner_id: ownerId ?? actor.id,
        title: `Renew AMC ${contract.proposalNumber} (${reminder.daysBefore} days left)`,
        description: `${contract.customerName}: the AMC for ${contract.propertyLabel || "the property"} ends on ${contract.endDate}. Start the renewal from AMC contracts.`,
        related_type: "amc_contract",
        related_id: contractId,
        deadline_at: `${contract.endDate}T18:00:00+04:00`,
        reminder_at: at,
      })
      .select("id")
      .single<{ id: string }>();
    if (todoError) {
      /* Free the slot so the next run can try again. */
      await admin.from("amc_renewal_reminders").delete().eq("id", slot.id);
      throw new ContractError(`Could not create the reminder: ${todoError.message}`, 400);
    }
    await admin.from("amc_renewal_reminders").update({ todo_id: todo.id }).eq("id", slot.id);
  }

  if (toCreate.length > 0) {
    await recordAmcAudit(admin, {
      entityType: "contract",
      entityId: contractId,
      eventType: "renewal_reminders_created",
      actorId: actor.id,
      actorLabel: actor.label,
      payload: { thresholds: toCreate.map((r) => r.daysBefore) },
    });
  }
  return reminderPlan(admin, contractId);
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/** The services the coverage check can ask about: the current catalogue. */
export async function coverageCatalogue(admin: Admin) {
  const settings = await readAmcSettings(admin);
  return settings.services.map((s) => ({
    id: s.id,
    label: s.label,
    callOutClass: CALL_OUT_CLASS_BY_SERVICE_ID[s.id] ?? null,
  }));
}

/** Coverage on one contract (used from the contract page). */
export async function coverageForContract(
  admin: Admin,
  contractId: string,
  { serviceId, date }: { serviceId: string; date: string },
): Promise<{ coverage: CoverageResult; contract: ContractForRules }> {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const rules = toRulesContract(contract, entitlements);
  return { coverage: checkCoverage([rules], { serviceId, date }), contract: rules };
}

/**
 * Coverage for a customer (the proposal's Customer ID): every contract of
 * theirs the caller may see, whatever its state, so the answer can say
 * "expired" or "cancelled" rather than just "none".
 */
export async function coverageForCustomer(
  admin: Admin,
  who: Visibility,
  { customerRef, serviceId, date }: { customerRef: string; serviceId: string; date: string },
): Promise<CoverageResult> {
  let q = admin
    .from("amc_contracts")
    .select(
      `id, status, start_date, end_date, customer_ref, amc_submissions!amc_contracts_submission_id_fkey!inner(owner_id), amc_contract_entitlements(${ENTITLEMENT_COLUMNS})`,
    )
    .eq("customer_ref", customerRef);
  if (!who.canApprove) q = q.eq("amc_submissions.owner_id", who.userId);
  const { data, error } = await q;
  if (error) {
    if (isMissingTable(error)) {
      throw new ContractError("AMC contracts are not set up on this database yet (migration 20261006100000).", 503);
    }
    throw new ContractError(error.message, 400);
  }
  const contracts: ContractForRules[] = ((data ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    status: r.status as StoredContractStatus,
    startDate: String(r.start_date),
    endDate: String(r.end_date),
    customerRef: (r.customer_ref as string | null) ?? null,
    entitlements: ((r.amc_contract_entitlements as Row[]) ?? []).map(mapEntitlement),
  }));
  return checkCoverage(contracts, { serviceId, date });
}
