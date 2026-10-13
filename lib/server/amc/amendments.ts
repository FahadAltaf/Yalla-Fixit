import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AMENDMENT_LABELS,
  amendmentProblem,
  canDecide,
  proRataRefund,
  terminationEffective,
  type AmendmentAction,
  type AmendmentKind,
  type AmendmentRequest,
  type AmendmentStatus,
} from "@/lib/amc/amendments";
import { servicesForProperty } from "@/components/dashboard/extensions/amc/amc-settings";
import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { addMonths, todayInDubai } from "@/lib/amc/contracts";
import { addDays, firstWorkingDay } from "@/lib/amc/ppm";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { getProperty } from "@/lib/server/amc/business";
import { setContractStatus } from "@/lib/server/amc/contract-state";
import { ContractError, isMissingTable, loadContract } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { priceSubmission } from "@/lib/server/amc/pricing";
import { cancelVisitsFrom, touchRenewal } from "@/lib/server/amc/renewals";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { recordStatusChange } from "@/lib/server/amc/status-history";

/**
 * Contract amendments on the server (Phase 13: DEV-417). Requested with a
 * reason by whoever operates the contract; approved or rejected by an AMC
 * approver who is not the requester; then applied, which is when the
 * contract changes. Every step is in the status history.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const NOT_MIGRATED = "Amendments are not set up on this database yet (migration 20261012140000).";
function fail(error: { code?: string; message: string }): ContractError {
  if (isMissingTable(error) || error.code === "42703" || error.code === "PGRST204") return new ContractError(NOT_MIGRATED, 503);
  return new ContractError(error.message, error.code === "23514" || error.code === "23505" ? 409 : 400);
}

export interface AmendmentRecord {
  id: string;
  kind: AmendmentKind;
  status: AmendmentStatus;
  reason: string;
  details: Row;
  effectiveOn: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  appliedAt: string | null;
  resultSubmissionId: string | null;
}

export async function listAmendments(admin: Admin, contractId: string): Promise<{ migrated: boolean; amendments: AmendmentRecord[] }> {
  const { data, error } = await admin
    .from("amc_contract_amendments")
    .select("id, kind, status, reason, details, effective_on, requested_by, requested_at, decided_by, decided_at, decision_comment, applied_at, result_submission_id")
    .eq("contract_id", contractId)
    .order("requested_at", { ascending: false });
  if (error) {
    if (fail(error).status === 503) return { migrated: false, amendments: [] };
    throw fail(error);
  }
  const rows = (data ?? []) as Row[];
  const people = [...new Set(rows.flatMap((r) => [str(r.requested_by), str(r.decided_by)]).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (people.length) {
    const { data: users } = await admin.from("user_profile").select("id, full_name, email").in("id", people);
    for (const u of (users ?? []) as Row[]) names.set(String(u.id), str(u.full_name) ?? str(u.email) ?? "—");
  }
  return {
    migrated: true,
    amendments: rows.map((r) => ({
      id: String(r.id),
      kind: r.kind as AmendmentKind,
      status: r.status as AmendmentStatus,
      reason: String(r.reason),
      details: (r.details ?? {}) as Row,
      effectiveOn: str(r.effective_on),
      requestedBy: str(r.requested_by),
      requestedByName: names.get(String(r.requested_by)) ?? null,
      requestedAt: String(r.requested_at),
      decidedByName: names.get(String(r.decided_by)) ?? null,
      decidedAt: str(r.decided_at),
      decisionComment: str(r.decision_comment),
      appliedAt: str(r.applied_at),
      resultSubmissionId: str(r.result_submission_id),
    })),
  };
}

/** What a request records beside its reason: the dates, and for a termination the refund it would mean. */
async function detailsFor(admin: Admin, contractId: string, input: AmendmentRequest): Promise<{ details: Row; effectiveOn: string | null }> {
  switch (input.kind) {
    case "scope_change":
      return { details: { mode: input.mode }, effectiveOn: input.effectiveOn };
    case "property_change": {
      const p = await getProperty(admin, input.propertyId);
      return { details: { propertyId: p.id, propertyLabel: [p.label, p.address].filter(Boolean).join(", "), community: p.community ?? null }, effectiveOn: input.effectiveOn };
    }
    case "hold":
      return { details: { until: input.until ?? null }, effectiveOn: input.effectiveOn };
    case "resume":
      return { details: {}, effectiveOn: input.effectiveOn };
    case "transfer":
      return { details: { to: input.to, clientId: input.clientId ?? null }, effectiveOn: input.effectiveOn };
    case "early_termination": {
      const { contract } = await loadContract(admin, contractId);
      const effectiveOn = terminationEffective(input.noticeOn, input.effectiveOn ?? null);
      const received = await receivedSoFar(admin, contractId);
      /* The refund if the reason is accepted as valid; the approver decides. */
      const ifValid = proRataRefund({ grandTotal: contract.grandTotal, received, startDate: contract.startDate, endDate: contract.endDate, effectiveOn, validReason: true });
      return { details: { noticeOn: input.noticeOn, received, refundIfValid: ifValid.refund, servedDays: ifValid.servedDays, totalDays: ifValid.totalDays }, effectiveOn };
    }
    case "cancellation":
      return { details: {}, effectiveOn: todayInDubai() };
  }
}

async function receivedSoFar(admin: Admin, contractId: string): Promise<number> {
  const { data } = await admin.from("amc_instalments").select("received_amount").eq("contract_id", contractId);
  return Math.round(((data ?? []) as Row[]).reduce((s, r) => s + Number(r.received_amount ?? 0), 0) * 100) / 100;
}

export async function requestAmendment(admin: Admin, contractId: string, input: AmendmentRequest, actor: Actor, config: AmcConfig) {
  const { contract } = await loadContract(admin, contractId);
  const problem = amendmentProblem(input.kind, contract.status);
  if (problem) throw new ContractError(problem, 409);
  const { data: open } = await admin.from("amc_contract_amendments").select("id").eq("contract_id", contractId).eq("kind", input.kind).in("status", ["requested", "approved"]).limit(1);
  if (open?.length) throw new ContractError(`A ${AMENDMENT_LABELS[input.kind].toLowerCase()} is already waiting on this contract.`, 409);
  const { details, effectiveOn } = await detailsFor(admin, contractId, input);
  const { data, error } = await admin
    .from("amc_contract_amendments")
    .insert({ contract_id: contractId, kind: input.kind, reason: input.reason, details, effective_on: effectiveOn, requested_by: actor.id })
    .select("id")
    .single<Row>();
  if (error) throw fail(error);
  const id = String(data.id);
  await recordStatusChange(admin, { entityType: "amendment", entityId: id, from: null, to: "requested", reason: input.reason, actor, details: { contractId, kind: input.kind } });
  const number = contract.lifecycle?.contractNumber ?? contract.proposalNumber;
  const approvers = approversForLevel(config, 1).filter((u) => u !== actor.id);
  await notifyUsers(admin, {
    event: "amendment_requested",
    userIds: approvers.length ? approvers : approversForLevel(config, 2).filter((u) => u !== actor.id),
    title: `${AMENDMENT_LABELS[input.kind]} to approve: AMC ${number}`,
    body: `${contract.customerName}: ${input.reason.slice(0, 200)}`,
    link: `/extensions/amc-contracts/${contractId}?tab=amendments`,
    entityType: "amendment",
    entityId: id,
    contractId,
    dedupeKey: `amendment_requested:${id}`,
  });
  return { id };
}

async function loadAmendment(admin: Admin, contractId: string, amendmentId: string): Promise<Row> {
  const { data, error } = await admin.from("amc_contract_amendments").select("*").eq("id", amendmentId).eq("contract_id", contractId).maybeSingle<Row>();
  if (error) throw fail(error);
  if (!data) throw new ContractError("Amendment not found.", 404);
  return data;
}

async function move(admin: Admin, row: Row, to: AmendmentStatus, changes: Row, actor: Actor, reason: string | null) {
  const from = String(row.status);
  const { data, error } = await admin
    .from("amc_contract_amendments")
    .update({ ...changes, status: to, updated_at: new Date().toISOString() })
    .eq("id", String(row.id))
    .eq("status", from)
    .select("id");
  if (error) throw fail(error);
  if (!data?.length) throw new ContractError("Someone else changed this amendment. Reload it.", 409);
  await recordStatusChange(admin, { entityType: "amendment", entityId: String(row.id), from, to, reason, actor, details: { contractId: String(row.contract_id), kind: String(row.kind) } });
}

export async function performAmendmentAction(
  admin: Admin,
  contractId: string,
  amendmentId: string,
  action: AmendmentAction,
  actor: Actor,
  rights: { canApprove: boolean; canOperate: boolean },
  config: AmcConfig,
) {
  const row = await loadAmendment(admin, contractId, amendmentId);
  const kind = row.kind as AmendmentKind;
  const now = new Date().toISOString();
  switch (action.action) {
    case "approve":
    case "reject": {
      if (row.status !== "requested") throw new ContractError("Only a request waiting for approval can be decided.", 409);
      if (!rights.canApprove) throw new ContractError("Only an AMC approver decides amendments.", 403);
      if (!canDecide(str(row.requested_by), actor.id ?? "")) throw new ContractError("You asked for this amendment, so someone else must decide it.", 403);
      const details = { ...((row.details ?? {}) as Row) };
      if (action.action === "approve" && kind === "early_termination") details.validReason = Boolean(action.validReason);
      await move(admin, row, action.action === "approve" ? "approved" : "rejected", { decided_by: actor.id, decided_at: now, decision_comment: action.comment ?? null, details }, actor, action.comment ?? null);
      if (row.requested_by) {
        await notifyUsers(admin, {
          event: action.action === "approve" ? "amendment_approved" : "amendment_rejected",
          userIds: [String(row.requested_by)],
          title: `${AMENDMENT_LABELS[kind]} ${action.action === "approve" ? "approved" : "rejected"}`,
          body: action.comment ?? (action.action === "approve" ? "It can be applied now." : ""),
          link: `/extensions/amc-contracts/${contractId}?tab=amendments`,
          entityType: "amendment",
          entityId: amendmentId,
          contractId,
          dedupeKey: `amendment_decided:${amendmentId}`,
        });
      }
      return { ok: true as const };
    }
    case "withdraw": {
      if (!["requested", "approved"].includes(String(row.status))) throw new ContractError("Only an open request can be withdrawn.", 409);
      if (row.requested_by !== actor.id && !rights.canApprove) throw new ContractError("Only the requester or an approver withdraws it.", 403);
      await move(admin, row, "withdrawn", {}, actor, null);
      return { ok: true as const };
    }
    case "apply": {
      if (row.status !== "approved") throw new ContractError("Only an approved amendment can be applied.", 409);
      if (!rights.canOperate && !rights.canApprove) throw new ContractError("You cannot change this contract.", 403);
      const result = await applyAmendment(admin, contractId, row, actor, config);
      await move(admin, row, "applied", { applied_by: actor.id, applied_at: now, ...(result.submissionId ? { result_submission_id: result.submissionId } : {}), details: { ...((row.details ?? {}) as Row), ...result.details } }, actor, null);
      await recordAmcAudit(admin, { entityType: "contract", entityId: contractId, eventType: `amendment_applied_${kind}`, actorId: actor.id, actorLabel: actor.label, justification: String(row.reason), payload: { amendmentId, ...result.details } });
      return { ok: true as const, ...result };
    }
  }
}

/* ------------------------------------------------------------------ */
/* Applying                                                            */
/* ------------------------------------------------------------------ */

async function applyAmendment(admin: Admin, contractId: string, row: Row, actor: Actor, config: AmcConfig): Promise<{ details: Row; submissionId?: string }> {
  const kind = row.kind as AmendmentKind;
  const details = (row.details ?? {}) as Row;
  const reason = String(row.reason);
  const today = todayInDubai();
  const { contract } = await loadContract(admin, contractId);
  const problem = amendmentProblem(kind, contract.status);
  if (problem) throw new ContractError(problem, 409);

  switch (kind) {
    case "hold":
      await setContractStatus(admin, contractId, contract.status, "on_hold", { status_reason: reason }, actor, reason);
      return { details: { heldFrom: str(row.effective_on) ?? today } };

    case "resume": {
      await setContractStatus(admin, contractId, contract.status, "active", { status_reason: null }, actor, reason);
      const replanned = await replanAfterHold(admin, contractId, actor, config);
      return { details: { replanned } };
    }

    case "property_change": {
      const p = await getProperty(admin, String(details.propertyId));
      const property = { ...(contract.property as Row), propertyAddress: p.address ?? p.label, propertyDetail: p.label, community: p.community ?? null };
      const { error } = await admin
        .from("amc_contracts")
        .update({ property_id: p.id, property_label: [p.label, p.address].filter(Boolean).join(", "), property, updated_at: new Date().toISOString() })
        .eq("id", contractId);
      if (error) throw fail(error);
      return { details: { from: contract.propertyLabel, to: details.propertyLabel } };
    }

    case "transfer": {
      const to = (details.to ?? {}) as Row;
      const customer = { ...(contract.customer as Row), customerName: to.customerName, customerEmail: to.customerEmail ?? null, customerPhone: to.customerPhone ?? null, role: to.role };
      const { error } = await admin
        .from("amc_contracts")
        .update({ customer, customer_name: String(to.customerName), ...(str(details.clientId) ? { customer_id: details.clientId } : {}), updated_at: new Date().toISOString() })
        .eq("id", contractId);
      if (error) throw fail(error);
      return { details: { from: contract.customerName, to: to.customerName } };
    }

    case "early_termination": {
      const effectiveOn = String(row.effective_on);
      const received = await receivedSoFar(admin, contractId);
      const refund = proRataRefund({ grandTotal: contract.grandTotal, received, startDate: contract.startDate, endDate: contract.endDate, effectiveOn, validReason: Boolean(details.validReason) });
      const { error } = await admin
        .from("amc_contracts")
        .update({ termination_notice_on: details.noticeOn, termination_effective_on: effectiveOn, termination_refund: refund.refund, updated_at: new Date().toISOString() })
        .eq("id", contractId);
      if (error) throw fail(error);
      /* On or after its date it takes effect now; otherwise the daily renewals job carries it out. */
      if (effectiveOn <= today) {
        await setContractStatus(admin, contractId, contract.status, "terminated", { status_reason: reason }, actor, reason);
        await cancelVisitsFrom(admin, contractId, effectiveOn, "Contract terminated");
      }
      return { details: { effectiveOn, refund: refund.refund, received, servedDays: refund.servedDays, totalDays: refund.totalDays } };
    }

    case "cancellation": {
      const nowIso = new Date().toISOString();
      await setContractStatus(admin, contractId, contract.status, "cancelled", { cancelled_at: nowIso, cancelled_by: actor.id, cancellation_reason: reason, status_reason: reason }, actor, reason);
      await cancelVisitsFrom(admin, contractId, "0001-01-01", "Contract cancelled");
      return { details: {} };
    }

    case "scope_change": {
      const effectiveOn = String(row.effective_on);
      const submissionId = await draftForScopeChange(admin, contractId, String(details.mode) as "add_services" | "replace_contract", effectiveOn, actor);
      /* A full new contract replaces this one from the effective date (no refund: the new one takes over). */
      if (details.mode === "replace_contract") {
        const { error } = await admin
          .from("amc_contracts")
          .update({ termination_notice_on: today, termination_effective_on: effectiveOn < today ? today : effectiveOn, termination_refund: 0, updated_at: new Date().toISOString() })
          .eq("id", contractId);
        if (error) throw fail(error);
      }
      await touchRenewal(admin, contractId);
      return { details: { proposalCreated: true }, submissionId };
    }
  }
}

/** Visits whose window passed during the hold get a fresh window from tomorrow. */
async function replanAfterHold(admin: Admin, contractId: string, actor: Actor, config: AmcConfig): Promise<number> {
  const today = todayInDubai();
  const { data } = await admin
    .from("amc_visits")
    .select("id, visit_no, target_date, window_end")
    .eq("contract_id", contractId)
    .lt("window_end", today)
    .in("status", ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access"]);
  const start = addDays(today, 1);
  const end = addDays(start, config.scheduling.serviceWindowDays - 1);
  const target = firstWorkingDay(start, end, { weekendDays: config.calendar.weekendDays, holidays: config.calendar.holidays });
  let n = 0;
  for (const v of (data ?? []) as Row[]) {
    const { error } = await admin
      .from("amc_visits")
      .update({ window_start: start, window_end: end, target_date: target, status: "not_scheduled", scheduled_start: null, scheduled_end: null, updated_at: new Date().toISOString() })
      .eq("id", String(v.id));
    if (error) continue;
    await admin.from("amc_visit_changes").insert({
      contract_id: contractId,
      visit_id: String(v.id),
      change_type: "rescheduled",
      from_date: String(v.target_date),
      to_date: target,
      reason: "Planned again after the hold",
      actor_id: actor.id,
      actor_label: actor.label,
    });
    n += 1;
  }
  return n;
}

/**
 * The proposal a scope change opens (BRD 5.16): for extra services, a new
 * draft with the same client and property and nothing ticked; to replace
 * the contract, a full draft with today's services ticked, from the
 * effective date for a new term. Both go through the normal flow.
 */
async function draftForScopeChange(admin: Admin, contractId: string, mode: "add_services" | "replace_contract", effectiveOn: string, actor: Actor): Promise<string> {
  const { contract, entitlements } = await loadContract(admin, contractId);
  const settings = await readAmcSettings(admin);
  const unitType = String(contract.property.unitType ?? contract.unitType ?? "");
  const offered = servicesForProperty(settings, unitType);
  const ticked =
    mode === "replace_contract"
      ? entitlements
          .filter((e) => offered.some((s) => s.id === e.serviceId))
          .map((e) => ({ serviceId: e.serviceId, included: true, units: e.units, frequency: e.frequency, basePrice: e.basePrice }))
      : [];
  const priced = priceSubmission({ services: ticked, discountPercent: mode === "replace_contract" ? contract.discountPercent : 0, unitType, settings });
  if (!priced.ok) throw new ContractError(priced.error, 409);
  const have = new Set(priced.services.map((s) => s.serviceId));
  const rows = [
    ...priced.services,
    ...offered
      .filter((s) => !have.has(s.id))
      .map((s) => ({ serviceId: s.id, included: false, units: 1, frequency: s.frequencyPerYear && s.frequencyPerYear >= 1 ? Math.trunc(s.frequencyPerYear) : 1, basePrice: null, price: 0 })),
  ];
  const endDate = mode === "replace_contract" ? addMonths(effectiveOn, 12) ?? contract.endDate : contract.endDate;
  const managers = [...contract.accountManagers].slice(0, 2).map((m) => ({ name: String(m?.name ?? ""), phone: String(m?.phone ?? "") }));
  while (managers.length < 2) managers.push({ name: "", phone: "" });
  const { data, error } = await admin
    .from("amc_submissions")
    .insert({
      owner_id: actor.id,
      status: "draft",
      property: { ...contract.property },
      customer: { ...contract.customer, startDate: effectiveOn, endDate, proposalNumber: "" },
      document_options: {
        optionalSections: { supplyInstallPriceList: false, additionalFixedPriceServices: false },
        priceListRows: [],
        accountManagers: managers,
        amendmentOf: { contractId, mode },
      },
      services: rows,
      discount_percent: priced.discount_percent,
      discount_amount: priced.discount_amount,
      final_price: priced.final_price,
      generated_documents: [],
      updated_at: new Date().toISOString(),
    })
    .select("id, proposal_number, customer")
    .single<{ id: string; proposal_number: string; customer: Row }>();
  if (error) throw new ContractError(error.message, 400);
  await admin.from("amc_submissions").update({ customer: { ...(data.customer ?? {}), proposalNumber: data.proposal_number } }).eq("id", data.id);
  return data.id;
}
