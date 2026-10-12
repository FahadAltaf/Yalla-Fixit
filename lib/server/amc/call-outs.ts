import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { fillTemplate, whatsappUrl } from "@/lib/amc/approval-ladder";
import {
  CALL_OUT_PRIORITY_LABELS,
  OPEN_CALL_OUT_STATUSES,
  SETTLED_ADDITIONAL_WORK,
  allowanceBalance,
  canMoveCallOut,
  checkCallOutCoverage,
  loggedInTime,
  nearZero,
  needsAdditionalWork,
  slaDeadlines,
  slaDueAt,
  slaState,
  type AllowanceBalance,
  type CallOutAction,
  type CallOutCreateInput,
  type CallOutPriority,
  type CallOutStatus,
  type CoverageAnswer,
  type SlaState,
} from "@/lib/amc/call-outs";
import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { isInForce, todayInDubai } from "@/lib/amc/contracts";
import { templateText } from "@/lib/amc/message-templates";
import { AMC_PHOTO_MAX_BYTES, PHOTO_EXTENSION, detectImageType } from "@/lib/amc/photos";
import { assignmentProblems, type Trade } from "@/lib/amc/visits";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyEntitlementState, notifyUsers } from "@/lib/server/amc/notifications";
import { recordSend } from "@/lib/server/amc/proposal-share";
import { AMC_DOCUMENTS_BUCKET } from "@/lib/server/amc/signed-archive";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";
import { crewFitsForSlot, dubaiSlot } from "@/lib/server/amc/visits";

/**
 * Call outs on the server (Phase 11: DEV-405, 406, 408, 409, to-do 8).
 * Logged from a call, WhatsApp or email against a contract; the coverage
 * answer is given before it is confirmed; a covered booking reserves a
 * unit of the allowance, consumed when the call out closes and released
 * when it is cancelled. The FSM appointment comes in Phase 15; until then
 * attendance and resolution are recorded in the portal.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const NOT_MIGRATED = "Call outs are not set up on this database yet (migration 20261012120000).";
export const notMigrated = (error: { code?: string } | null | undefined) =>
  isMissingTable(error) || error?.code === "42703" || error?.code === "PGRST204";
export function fail(error: { code?: string; message: string }): ContractError {
  if (notMigrated(error)) return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" || error.code === "23505" ? 409 : 400);
}
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
export const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const dateOf = (iso: string) => todayInDubai(new Date(iso));

/** Who hears about call outs besides the contract owner: the supervisors (named, else level 1 approvers). */
export function callOutSupervisors(config: AmcConfig): string[] {
  return config.scheduling.supervisorUserIds.length ? config.scheduling.supervisorUserIds : approversForLevel(config, 1);
}

/* ------------------------------------------------------------------ */
/* The contract and its call-out allowance                             */
/* ------------------------------------------------------------------ */

const CONTRACT_FACTS =
  "id, status, start_date, end_date, contract_number, proposal_number, customer_name, property_label, customer, property, " +
  "submission:amc_submissions!amc_contracts_submission_id_fkey(id, owner_id)";
const ENTITLEMENT_FACTS =
  "id, service_id, service_label, entitlement_type, call_out_class, included_quantity, used_quantity, reserved_quantity, labour_covered, material_coverage, value_limit_aed, exclusions";

export interface CallOutContract {
  id: string;
  status: string;
  startDate: string;
  endDate: string;
  number: string;
  customerName: string;
  propertyLabel: string;
  customer: Row;
  property: Row;
  ownerId: string | null;
  submissionId: string | null;
  entitlements: Array<{
    id: string;
    serviceId: string;
    serviceLabel: string;
    entitlementType: "visits" | "hours" | "unlimited" | "informational";
    callOutClass: CallOutPriority | null;
    includedQuantity: number | null;
    usedQuantity: number;
    reservedQuantity: number;
    labourCovered: boolean;
    materialCoverage: "none" | "consumables" | "parts_within_limit" | "all";
    valueLimitAed: number | null;
    exclusions: string | null;
  }>;
}

export async function loadCallOutContract(admin: Admin, contractId: string): Promise<CallOutContract> {
  const { data: c, error } = await admin.from("amc_contracts").select(CONTRACT_FACTS).eq("id", contractId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!c) throw new ContractError("Contract not found.", 404);
  const { data: ents, error: entError } = await admin.from("amc_contract_entitlements").select(ENTITLEMENT_FACTS).eq("contract_id", contractId).order("sort_order");
  if (entError) throw fail(entError);
  const submission = one(c.submission);
  return {
    id: String(c.id),
    status: String(c.status),
    startDate: String(c.start_date),
    endDate: String(c.end_date),
    number: String(c.contract_number ?? c.proposal_number ?? ""),
    customerName: String(c.customer_name ?? ""),
    propertyLabel: String(c.property_label ?? ""),
    customer: (c.customer ?? {}) as Row,
    property: (c.property ?? {}) as Row,
    ownerId: str(submission?.owner_id),
    submissionId: str(submission?.id),
    entitlements: ((ents ?? []) as Row[]).map((e) => ({
      id: String(e.id),
      serviceId: String(e.service_id),
      serviceLabel: String(e.service_label),
      entitlementType: e.entitlement_type as CallOutContract["entitlements"][number]["entitlementType"],
      callOutClass: (str(e.call_out_class) as CallOutPriority | null) ?? null,
      includedQuantity: e.included_quantity === null ? null : Number(e.included_quantity),
      usedQuantity: Number(e.used_quantity ?? 0),
      reservedQuantity: Number(e.reserved_quantity ?? 0),
      labourCovered: e.labour_covered !== false,
      materialCoverage: (str(e.material_coverage) ?? "consumables") as CallOutContract["entitlements"][number]["materialCoverage"],
      valueLimitAed: e.value_limit_aed === null || e.value_limit_aed === undefined ? null : Number(e.value_limit_aed),
      exclusions: str(e.exclusions),
    })),
  };
}

/** The contract's service for call outs of this priority (by its class, else by the catalogue id). */
export function callOutEntitlement(contract: CallOutContract, priority: CallOutPriority) {
  return (
    contract.entitlements.find((e) => e.callOutClass === priority) ??
    contract.entitlements.find((e) => e.serviceId === (priority === "emergency" ? "emergency" : "non-emergency")) ??
    null
  );
}

export interface CoveragePreview extends CoverageAnswer {
  entitlementId: string | null;
  serviceLabel: string | null;
  exclusions: string | null;
  nearZero: boolean;
  sla: { attendDueAt: string | null; scheduleDueAt: string | null };
}

export function previewCoverage(
  contract: CallOutContract,
  input: Pick<CallOutCreateInput, "priority" | "partsExpected" | "partsValueAed" | "excluded"> & { reportedAt?: string },
  config: AmcConfig,
): CoveragePreview {
  const e = callOutEntitlement(contract, input.priority);
  const reportedAt = input.reportedAt ?? new Date().toISOString();
  const answer = checkCallOutCoverage({
    contractInForce: isInForce({ status: contract.status as "active", startDate: contract.startDate, endDate: contract.endDate }, dateOf(reportedAt)),
    entitlement: e,
    quantity: 1,
    partsExpected: input.partsExpected,
    partsValueAed: input.partsValueAed ?? null,
    excluded: input.excluded,
  });
  return {
    ...answer,
    entitlementId: e?.id ?? null,
    serviceLabel: e?.serviceLabel ?? null,
    exclusions: e?.exclusions ?? null,
    nearZero: answer.balance ? nearZero(answer.balance, config.allowances.warningRemaining) : false,
    sla: slaDeadlines(input.priority, reportedAt, config.sla),
  };
}

/* ------------------------------------------------------------------ */
/* Logging a call out                                                  */
/* ------------------------------------------------------------------ */

export async function createCallOut(admin: Admin, input: CallOutCreateInput, actor: Actor, config: AmcConfig, canOverride: boolean) {
  const contract = await loadCallOutContract(admin, input.contractId);
  if (!["active", "on_hold"].includes(contract.status)) throw new ContractError("Call outs are logged against an active contract.", 409);
  if (Date.parse(input.reportedAt) > Date.now() + 5 * 60_000) throw new ContractError("The call cannot be in the future.", 400);
  const preview = previewCoverage(contract, input, config);
  let coverage = preview.coverage;
  let overrideReason: string | null = null;
  if (preview.coverage === "chargeable" && input.overrideReason) {
    if (!canOverride) throw new ContractError("Only someone with AMC Allowances (Approve) may book a chargeable call out as covered.", 403);
    coverage = "covered";
    overrideReason = input.overrideReason;
  }
  const { data: created, error } = await admin
    .from("amc_call_outs")
    .insert({
      contract_id: contract.id,
      entitlement_id: preview.entitlementId,
      priority: input.priority,
      channel: input.channel,
      reported_at: input.reportedAt,
      issue: input.issue,
      trade: input.trade ?? null,
      on_site_contact_name: input.onSiteContactName,
      on_site_contact_phone: input.onSiteContactPhone,
      coverage,
      coverage_reasons: [...preview.reasons, ...preview.chargeableExtras],
      coverage_override_reason: overrideReason,
      coverage_override_by: overrideReason ? actor.id : null,
      sla_attend_due_at: preview.sla.attendDueAt,
      sla_schedule_due_at: preview.sla.scheduleDueAt,
      created_by: actor.id,
    })
    .select("id, call_out_no, created_at")
    .single<Row>();
  if (error) throw fail(error);
  const id = String(created.id);
  const callOutNo = String(created.call_out_no);

  /* A covered booking holds a unit until the work is done (BRD 5.14). */
  let reserved = false;
  if (preview.reserves && preview.entitlementId) {
    const { data: res, error: resError } = await admin
      .from("amc_entitlement_usage")
      .insert({
        contract_id: contract.id,
        entitlement_id: preview.entitlementId,
        kind: "reserve",
        quantity: 1,
        occurred_at: input.reportedAt,
        source: "system",
        call_out_id: id,
        notes: `Booked by call out ${callOutNo}`,
        created_by: actor.id,
      })
      .select("id")
      .single<Row>();
    if (resError) {
      /* Someone used the last unit meanwhile: the call out stands, as chargeable. */
      await admin
        .from("amc_call_outs")
        .update({ coverage: overrideReason ? "covered" : "chargeable", coverage_reasons: ["Chargeable.", "The allowance was used up while this call out was being logged."] })
        .eq("id", id);
      coverage = overrideReason ? "covered" : "chargeable";
    } else {
      await admin.from("amc_call_outs").update({ reservation_id: String(res.id) }).eq("id", id);
      reserved = true;
      await notifyEntitlementState(admin, contract.id, preview.entitlementId, actor);
    }
  }

  const label = `${callOutNo} (${CALL_OUT_PRIORITY_LABELS[input.priority]})`;
  const supervisors = callOutSupervisors(config);
  const dueAt = slaDueAt(preview.sla) ?? new Date(Date.now() + 24 * 3_600_000).toISOString();
  await openAmcTodo(
    admin,
    {
      kind: "call_out",
      entityType: "call_out",
      entityId: id,
      dedupeKey: `call_out:${id}`,
      title: `Call out ${label}: ${contract.customerName}`,
      description: `${input.issue.slice(0, 300)}\n${contract.propertyLabel}. ${coverage === "covered" ? "Covered" : "Chargeable"}. Attend by ${new Date(dueAt).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}.`,
      ownerId: contract.ownerId ?? actor.id ?? supervisors[0] ?? "",
      assigneeIds: [contract.ownerId, actor.id].filter((v): v is string => Boolean(v)),
      dueAt,
      escalateAt: dueAt,
      createdBy: actor.id,
    },
    config,
  ).catch((e) => console.error("[amc:call-outs] to-do not opened:", e instanceof Error ? e.message : e));
  await notifyUsers(admin, {
    event: "call_out_logged",
    userIds: [contract.ownerId, ...(input.priority === "emergency" ? supervisors : [])].filter((v): v is string => Boolean(v) && v !== actor.id),
    title: `Call out logged: ${label}`,
    body: `${contract.customerName}, ${contract.propertyLabel}: ${input.issue.slice(0, 200)}`,
    link: `/extensions/amc-contracts/call-outs?open=${id}`,
    entityType: "call_out",
    entityId: id,
    contractId: contract.id,
    dedupeKey: `call_out_logged:${id}`,
  });
  await recordAmcAudit(admin, {
    entityType: "call_out",
    entityId: id,
    eventType: "call_out_logged",
    actorId: actor.id,
    actorLabel: actor.label,
    justification: overrideReason,
    payload: { contractId: contract.id, priority: input.priority, coverage, reasons: preview.reasons, reserved, override: Boolean(overrideReason) },
  });

  /* The acknowledgement (BRD 6.3), prepared for WhatsApp. */
  const values = {
    "Client name": str(contract.customer.customerName) ?? contract.customerName ?? "customer",
    "Call out no": callOutNo,
    Property: contract.propertyLabel,
    Priority: CALL_OUT_PRIORITY_LABELS[input.priority],
    "Coverage line":
      coverage === "covered"
        ? "This visit is covered by your AMC."
        : `This visit is chargeable${preview.reasons[1] ? ` (${preview.reasons[1].replace(/\.$/, "")})` : ""}; we will confirm the charge before the visit.`,
  };
  const message = fillTemplate(templateText("messageCallOutAcknowledgement", config.templates)!.body, values).trim();
  const phone = input.onSiteContactPhone ?? str(contract.customer.customerPhone);
  if (contract.submissionId) {
    await recordSend(admin, {
      submissionId: contract.submissionId,
      versionNo: 1,
      document: "call_out_acknowledgement",
      channel: "whatsapp",
      recipients: phone ? [{ name: values["Client name"], address: phone }] : [],
      outcome: phone ? "prepared" : "no_recipient",
      detail: `Call out ${callOutNo}`,
      sentBy: actor.id,
    });
  }
  return {
    id,
    callOutNo,
    coverage,
    reserved,
    reasons: preview.reasons,
    chargeableExtras: preview.chargeableExtras,
    message,
    whatsapp: phone ? whatsappUrl(phone, message) : null,
    loggedInTime: loggedInTime(input.priority, input.reportedAt, String(created.created_at), config.sla.emergencyLogMinutes),
  };
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

const CALL_OUT_COLUMNS =
  "id, call_out_no, contract_id, entitlement_id, priority, channel, reported_at, issue, trade, on_site_contact_name, on_site_contact_phone, coverage, coverage_reasons, coverage_override_reason, reservation_id, " +
  "status, status_reason, sla_attend_due_at, sla_schedule_due_at, sla_met, scheduled_start, scheduled_end, technician_ids, lead_technician_id, attended_at, diagnosis, resolution, parts_needed, pending_works, " +
  "resolved_at, closed_at, misuse_flag, misuse_note, acknowledged_at, created_at, " +
  "contract:amc_contracts!amc_call_outs_contract_id_fkey(id, status, contract_number, proposal_number, customer_name, property_label, customer, submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))";

export interface CallOutRecord {
  id: string;
  callOutNo: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  propertyLabel: string;
  ownerId: string | null;
  priority: CallOutPriority;
  channel: string;
  reportedAt: string;
  issue: string;
  trade: Trade | null;
  onSiteContactName: string | null;
  onSiteContactPhone: string | null;
  coverage: "covered" | "chargeable";
  coverageReasons: string[];
  coverageOverrideReason: string | null;
  reserved: boolean;
  status: CallOutStatus;
  statusReason: string | null;
  attendDueAt: string | null;
  scheduleDueAt: string | null;
  slaState: SlaState | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianIds: string[];
  attendedAt: string | null;
  diagnosis: string | null;
  resolution: string | null;
  partsNeeded: string | null;
  pendingWorks: Array<{ description: string; reason: string }>;
  resolvedAt: string | null;
  closedAt: string | null;
  misuseFlag: boolean;
  misuseNote: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

function mapCallOut(r: Row, config: AmcConfig, now: Date): CallOutRecord {
  const c = one(r.contract) ?? {};
  const base = {
    reportedAt: String(r.reported_at),
    attendedAt: str(r.attended_at),
    attendDueAt: str(r.sla_attend_due_at),
    scheduleDueAt: str(r.sla_schedule_due_at),
    status: r.status as CallOutStatus,
  };
  return {
    id: String(r.id),
    callOutNo: String(r.call_out_no),
    contractId: String(r.contract_id),
    contractNumber: String(c.contract_number ?? c.proposal_number ?? ""),
    customerName: String(c.customer_name ?? ""),
    propertyLabel: String(c.property_label ?? ""),
    ownerId: str(one(c.submission)?.owner_id),
    priority: r.priority as CallOutPriority,
    channel: String(r.channel),
    issue: String(r.issue),
    trade: (str(r.trade) as Trade | null) ?? null,
    onSiteContactName: str(r.on_site_contact_name),
    onSiteContactPhone: str(r.on_site_contact_phone),
    coverage: r.coverage as "covered" | "chargeable",
    coverageReasons: strings(r.coverage_reasons),
    coverageOverrideReason: str(r.coverage_override_reason),
    reserved: Boolean(r.reservation_id),
    statusReason: str(r.status_reason),
    ...base,
    slaState: slaState(base, now, config.sla.atRiskPercent),
    scheduledStart: str(r.scheduled_start),
    scheduledEnd: str(r.scheduled_end),
    technicianIds: strings(r.technician_ids),
    diagnosis: str(r.diagnosis),
    resolution: str(r.resolution),
    partsNeeded: str(r.parts_needed),
    pendingWorks: (r.pending_works ?? []) as CallOutRecord["pendingWorks"],
    resolvedAt: str(r.resolved_at),
    closedAt: str(r.closed_at),
    misuseFlag: Boolean(r.misuse_flag),
    misuseNote: str(r.misuse_note),
    acknowledgedAt: str(r.acknowledged_at),
    createdAt: String(r.created_at),
  };
}

export async function listCallOuts(
  admin: Admin,
  filter: { contractId?: string | null; open?: boolean; ownerId?: string | null },
  config: AmcConfig,
  now = new Date(),
): Promise<{ migrated: boolean; callOuts: CallOutRecord[] }> {
  let q = admin.from("amc_call_outs").select(CALL_OUT_COLUMNS).order("reported_at", { ascending: false }).limit(500);
  if (filter.contractId) q = q.eq("contract_id", filter.contractId);
  if (filter.open) q = q.in("status", [...OPEN_CALL_OUT_STATUSES]);
  const { data, error } = await q;
  if (error) {
    if (notMigrated(error)) return { migrated: false, callOuts: [] };
    throw fail(error);
  }
  let rows = ((data ?? []) as unknown as Row[]).map((r) => mapCallOut(r, config, now));
  if (filter.ownerId) rows = rows.filter((r) => r.ownerId === filter.ownerId);
  return { migrated: true, callOuts: rows };
}

async function loadCallOut(admin: Admin, id: string): Promise<Row> {
  const { data, error } = await admin.from("amc_call_outs").select(CALL_OUT_COLUMNS).eq("id", id).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Call out not found.", 404);
  return data;
}

export async function callOutOwner(admin: Admin, id: string): Promise<{ found: boolean; ownerId: string | null }> {
  const { data } = await admin
    .from("amc_call_outs")
    .select("id, contract:amc_contracts!amc_call_outs_contract_id_fkey(submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id))")
    .eq("id", id)
    .maybeSingle<Row>();
  if (!data) return { found: false, ownerId: null };
  return { found: true, ownerId: str(one(one(data.contract)?.submission)?.owner_id) };
}

export interface WorkPhoto {
  id: string;
  kind: string;
  caption: string | null;
  url: string | null;
  createdAt: string;
}

export async function workPhotos(admin: Admin, owner: { callOutId?: string; additionalWorkId?: string }): Promise<WorkPhoto[]> {
  let q = admin.from("amc_work_photos").select("id, kind, caption, storage_path, created_at").order("created_at");
  q = owner.callOutId ? q.eq("call_out_id", owner.callOutId) : q.eq("additional_work_id", String(owner.additionalWorkId));
  const { data } = await q;
  const rows = (data ?? []) as Row[];
  const urls = new Map<string, string>();
  if (rows.length) {
    const { data: signed } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).createSignedUrls(rows.map((p) => String(p.storage_path)), 600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return rows.map((p) => ({ id: String(p.id), kind: String(p.kind), caption: str(p.caption), url: urls.get(String(p.storage_path)) ?? null, createdAt: String(p.created_at) }));
}

export async function callOutDetail(admin: Admin, id: string, config: AmcConfig, now = new Date()) {
  const row = await loadCallOut(admin, id);
  const record = mapCallOut(row, config, now);
  const contract = await loadCallOutContract(admin, record.contractId);
  const e = contract.entitlements.find((x) => x.id === str(row.entitlement_id)) ?? null;
  const [photos, { data: works }] = await Promise.all([
    workPhotos(admin, { callOutId: id }),
    admin.from("amc_additional_works").select("id, work_no, status, finding, total, risk").eq("call_out_id", id).order("created_at"),
  ]);
  return {
    callOut: record,
    allowance: e ? { serviceLabel: e.serviceLabel, ...allowanceBalance(e), nearZero: nearZero(allowanceBalance(e), config.allowances.warningRemaining) } : null,
    photos,
    additionalWorks: ((works ?? []) as Row[]).map((w) => ({ id: String(w.id), workNo: String(w.work_no), status: String(w.status), finding: String(w.finding), total: Number(w.total ?? 0), risk: String(w.risk) })),
    loggedInTime: loggedInTime(record.priority, record.reportedAt, record.createdAt, config.sla.emergencyLogMinutes),
    minorFixHours: config.sla.minorFixHours,
  };
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

async function setStatus(admin: Admin, row: Row, to: CallOutStatus, changes: Row, actor: Actor, reason: string | null = null) {
  const from = row.status as CallOutStatus;
  const { data, error } = await admin
    .from("amc_call_outs")
    .update({ ...changes, status: to, updated_at: new Date().toISOString() })
    .eq("id", String(row.id))
    .eq("status", from)
    .select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("Someone else changed this call out. Reload and try again.", 409);
  await recordStatusChange(admin, { entityType: "call_out", entityId: String(row.id), from, to, reason, actor });
}

async function settleReservation(admin: Admin, row: Row, kind: "consumption" | "release", note: string, actor: Actor) {
  const reservationId = str(row.reservation_id);
  const entitlementId = str(row.entitlement_id);
  if (!entitlementId) return;
  if (kind === "release" && !reservationId) return;
  const { error } = await admin.from("amc_entitlement_usage").insert({
    contract_id: String(row.contract_id),
    entitlement_id: entitlementId,
    kind,
    quantity: 1,
    reservation_id: reservationId,
    occurred_at: new Date().toISOString(),
    source: "system",
    call_out_id: String(row.id),
    notes: note,
    created_by: actor.id,
  });
  if (error) {
    if (error.code === "23505") return; /* already settled */
    console.warn("[amc:call-outs] allowance not settled:", error.message);
    return;
  }
  await notifyEntitlementState(admin, String(row.contract_id), entitlementId, actor);
}

export async function performCallOutAction(admin: Admin, id: string, action: CallOutAction, actor: Actor, config: AmcConfig) {
  const row = await loadCallOut(admin, id);
  const status = row.status as CallOutStatus;
  const no = String(row.call_out_no);
  const move = (to: CallOutStatus) => {
    if (!canMoveCallOut(status, to)) throw new ContractError(`Call out ${no} is ${status.replace(/_/g, " ")}: it cannot be ${to.replace(/_/g, " ")} now.`, 409);
  };

  switch (action.action) {
    case "schedule": {
      move("scheduled");
      const slot = dubaiSlot(action.date, action.time, action.durationMinutes);
      const trades = str(row.trade) ? [str(row.trade) as Trade] : [];
      const property =(await admin.from("amc_contracts").select("property").eq("id", String(row.contract_id)).maybeSingle<Row>()).data?.property as Row | undefined;
      const fits = await crewFitsForSlot(
        admin,
        { trades, date: action.date, area: str(property?.community) ?? str(property?.propertyDetail) ?? null, accessTypes: [] },
        slot,
        action.technicianIds,
        [id],
      );
      const problems = assignmentProblems(fits, trades);
      if (problems.length) throw new ContractError(problems.join(" "), 409);
      await setStatus(admin, row, "scheduled", {
        scheduled_start: slot.start,
        scheduled_end: slot.end,
        technician_ids: action.technicianIds,
        lead_technician_id: action.technicianIds[0],
        assignment_override_reason: action.overrideReason,
      }, actor);
      return { ok: true as const };
    }
    case "attend": {
      move("attended");
      if (Date.parse(action.attendedAt) < Date.parse(String(row.reported_at))) throw new ContractError("Attendance cannot be before the call.", 400);
      const due = str(row.sla_attend_due_at) ?? str(row.sla_schedule_due_at);
      await setStatus(admin, row, "attended", {
        attended_at: action.attendedAt,
        sla_met: due ? Date.parse(action.attendedAt) <= Date.parse(due) : null,
        ...(action.technicianIds?.length ? { technician_ids: action.technicianIds } : {}),
      }, actor);
      await closeAmcTodos(admin, { entityType: "call_out", entityId: id, kind: "call_out" }, { status: "done", reason: "Attended" }).catch(() => 0);
      return { ok: true as const };
    }
    case "record": {
      if (status !== "attended" && status !== "pending_works" && status !== "quoted") {
        throw new ContractError(`Call out ${no} is ${status.replace(/_/g, " ")}: record the attendance first.`, 409);
      }
      if (action.outcome !== status) move(action.outcome);
      if (action.outcome === "pending_works" && !action.pendingWorks.length) throw new ContractError("List the pending works and why.", 400);
      const changes: Row = {
        diagnosis: action.diagnosis,
        resolution: action.resolution,
        parts_needed: action.partsNeeded,
        pending_works: action.pendingWorks,
        resolved_at: action.outcome === "resolved" ? new Date().toISOString() : null,
      };
      if (action.outcome === status) {
        const { error } = await admin.from("amc_call_outs").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw fail(error);
      } else await setStatus(admin, row, action.outcome, changes, actor);
      return {
        ok: true as const,
        suggestAdditionalWork: needsAdditionalWork(
          { priority: row.priority as CallOutPriority, minutesOnSite: action.minutesOnSite ?? null, partsNeeded: Boolean(action.partsNeeded) },
          config.sla.minorFixHours,
        ),
      };
    }
    case "close": {
      move("closed");
      const { data: works } = await admin.from("amc_additional_works").select("work_no, status").eq("call_out_id", id);
      const open = ((works ?? []) as Row[]).filter((w) => !(SETTLED_ADDITIONAL_WORK as readonly string[]).includes(String(w.status)));
      if (open.length) {
        throw new ContractError(`The call out stays open until its additional work is done or declined (${open.map((w) => String(w.work_no)).join(", ")}).`, 409);
      }
      await setStatus(admin, row, "closed", { closed_at: new Date().toISOString(), closed_by: actor.id }, actor, action.note);
      /* The visit was delivered: a covered call out consumes its unit (an unlimited one is counted). */
      if (row.coverage === "covered") await settleReservation(admin, row, "consumption", `Call out ${no} closed`, actor);
      else if (row.reservation_id) await settleReservation(admin, row, "release", `Call out ${no} closed as chargeable`, actor);
      await closeAmcTodos(admin, { entityType: "call_out", entityId: id, kind: "call_out" }, { status: "done", reason: "Closed" }).catch(() => 0);
      return { ok: true as const };
    }
    case "cancel": {
      move("cancelled");
      await setStatus(admin, row, "cancelled", { status_reason: action.reason, closed_at: new Date().toISOString(), closed_by: actor.id }, actor, action.reason);
      await settleReservation(admin, row, "release", `Call out ${no} cancelled: ${action.reason}`, actor);
      await closeAmcTodos(admin, { entityType: "call_out", entityId: id, kind: "call_out" }, { status: "canceled", reason: "Cancelled" }).catch(() => 0);
      return { ok: true as const };
    }
    case "flag_misuse": {
      if (row.priority !== "emergency") throw new ContractError("Only an emergency call out can be flagged as misuse of the emergency line.", 400);
      const { error } = await admin.from("amc_call_outs").update({ misuse_flag: true, misuse_note: action.note, updated_at: new Date().toISOString() }).eq("id", id);
      if (error) throw fail(error);
      await recordAmcAudit(admin, { entityType: "call_out", entityId: id, eventType: "call_out_misuse_flagged", actorId: actor.id, actorLabel: actor.label, justification: action.note });
      return { ok: true as const };
    }
    case "acknowledged": {
      const { error } = await admin.from("amc_call_outs").update({ acknowledged_at: new Date().toISOString() }).eq("id", id).is("acknowledged_at", null);
      if (error) throw fail(error);
      return { ok: true as const };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Photos (call outs and additional works share the table)             */
/* ------------------------------------------------------------------ */

const PHOTOS_PER_RECORD = 30;

export async function addWorkPhoto(
  admin: Admin,
  owner: { callOutId: string } | { additionalWorkId: string },
  input: { bytes: Uint8Array; kind: "reported" | "before" | "after" | "finding" | "other"; caption: string | null },
  actor: Actor,
) {
  if (input.bytes.byteLength === 0) throw new ContractError("The file is empty.", 400);
  if (input.bytes.byteLength > AMC_PHOTO_MAX_BYTES) throw new ContractError("A photo can be at most 10 MB.", 400);
  const type = detectImageType(input.bytes);
  if (!type) throw new ContractError("Only JPEG, PNG or WebP photos can be added.", 400);
  const column = "callOutId" in owner ? "call_out_id" : "additional_work_id";
  const ownerId = "callOutId" in owner ? owner.callOutId : owner.additionalWorkId;
  const { count } = await admin.from("amc_work_photos").select("id", { count: "exact", head: true }).eq(column, ownerId);
  if ((count ?? 0) >= PHOTOS_PER_RECORD) throw new ContractError(`At most ${PHOTOS_PER_RECORD} photos.`, 409);
  const id = randomUUID();
  const path = `${column === "call_out_id" ? "call-outs" : "additional-works"}/${ownerId}/${id}.${PHOTO_EXTENSION[type]}`;
  const { error: upload } = await admin.storage.from(AMC_DOCUMENTS_BUCKET).upload(path, input.bytes, { contentType: type, upsert: false });
  if (upload) throw new ContractError(`Could not store the photo: ${upload.message}`, 500);
  const { error } = await admin.from("amc_work_photos").insert({
    id,
    [column]: ownerId,
    kind: input.kind,
    storage_path: path,
    content_type: type,
    byte_size: input.bytes.byteLength,
    file_sha256: createHash("sha256").update(input.bytes).digest("hex"),
    caption: input.caption,
    uploaded_by: actor.id,
  });
  if (error) {
    await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([path]);
    throw fail(error);
  }
  return { id };
}

export async function removeWorkPhoto(admin: Admin, owner: { callOutId: string } | { additionalWorkId: string }, photoId: string) {
  const column = "callOutId" in owner ? "call_out_id" : "additional_work_id";
  const ownerId = "callOutId" in owner ? owner.callOutId : owner.additionalWorkId;
  const { data, error } = await admin.from("amc_work_photos").select("id, storage_path").eq("id", photoId).eq(column, ownerId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Photo not found.", 404);
  const { error: delError } = await admin.from("amc_work_photos").delete().eq("id", photoId);
  if (delError) throw fail(delError);
  await admin.storage.from(AMC_DOCUMENTS_BUCKET).remove([String(data.storage_path)]);
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* Allowances on a contract (DEV-409)                                  */
/* ------------------------------------------------------------------ */

export interface AllowanceRow extends AllowanceBalance {
  entitlementId: string;
  serviceLabel: string;
  entitlementType: string;
  nearZero: boolean;
}

export async function contractAllowances(admin: Admin, contractId: string, config: AmcConfig) {
  let contract: CallOutContract;
  try {
    contract = await loadCallOutContract(admin, contractId);
  } catch (error) {
    if (error instanceof ContractError && error.status === 503) return { migrated: false, allowances: [], movements: [] };
    throw error;
  }
  const { data: moves } = await admin
    .from("amc_entitlement_usage")
    .select("id, entitlement_id, kind, quantity, occurred_at, source, notes, reservation_id, corrects_usage_id, call_out_id, created_at, call_out:amc_call_outs!amc_entitlement_usage_call_out_id_fkey(call_out_no)")
    .eq("contract_id", contractId)
    .order("created_at", { ascending: false })
    .limit(300);
  const labels = new Map(contract.entitlements.map((e) => [e.id, e.serviceLabel]));
  return {
    migrated: true,
    allowances: contract.entitlements
      .filter((e) => e.entitlementType !== "informational")
      .map((e): AllowanceRow => {
        const b = allowanceBalance(e);
        return { entitlementId: e.id, serviceLabel: e.serviceLabel, entitlementType: e.entitlementType, ...b, nearZero: nearZero(b, config.allowances.warningRemaining) };
      }),
    movements: ((moves ?? []) as unknown as Row[]).map((m) => ({
      id: String(m.id),
      serviceLabel: labels.get(String(m.entitlement_id)) ?? "",
      kind: String(m.kind),
      quantity: Number(m.quantity),
      occurredAt: String(m.occurred_at),
      source: String(m.source),
      notes: str(m.notes),
      callOutNo: str(one(m.call_out)?.call_out_no),
      createdAt: String(m.created_at),
    })),
  };
}

/* ------------------------------------------------------------------ */
/* The sweep (job "call_outs")                                         */
/* ------------------------------------------------------------------ */

/** SLA at risk or missed on a call out not yet attended (BRD 6.2): the owner and the supervisors hear once. */
export async function runCallOutSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const result = { atRisk: 0, missed: 0, skipped: null as string | null };
  const { data, error } = await admin
    .from("amc_call_outs")
    .select(CALL_OUT_COLUMNS)
    .in("status", ["logged", "scheduled"])
    .is("attended_at", null)
    .is("sla_at_risk_notified_at", null)
    .limit(300);
  if (error) {
    if (notMigrated(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  const supervisors = callOutSupervisors(config);
  for (const row of (data ?? []) as unknown as Row[]) {
    const c = mapCallOut(row, config, now);
    if (c.slaState !== "at_risk" && c.slaState !== "missed") continue;
    const { data: claimed } = await admin
      .from("amc_call_outs")
      .update({ sla_at_risk_notified_at: now.toISOString(), ...(c.slaState === "missed" ? { sla_met: false } : {}) })
      .eq("id", c.id)
      .is("sla_at_risk_notified_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const due = slaDueAt(c)!;
    await notifyUsers(admin, {
      event: "call_out_sla_at_risk",
      userIds: [c.ownerId, ...supervisors].filter((v): v is string => Boolean(v)),
      title: `${c.slaState === "missed" ? "SLA missed" : "SLA at risk"}: call out ${c.callOutNo} (${CALL_OUT_PRIORITY_LABELS[c.priority]})`,
      body: `${c.customerName}, ${c.propertyLabel}: attend by ${new Date(due).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })}.`,
      link: `/extensions/amc-contracts/call-outs?open=${c.id}`,
      entityType: "call_out",
      entityId: c.id,
      contractId: c.contractId,
      dedupeKey: `call_out_sla_at_risk:${c.id}`,
    });
    if (c.slaState === "missed") result.missed += 1;
    else result.atRisk += 1;
  }
  return result;
}
