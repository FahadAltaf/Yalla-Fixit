import type { SupabaseClient } from "@supabase/supabase-js";

import { approversForLevel, type AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import {
  FINAL_OUTCOMES,
  RENEWAL_OUTCOME_LABELS,
  daysUntil,
  escalate,
  expiryNotice,
  renewalStage,
  renewedOutcome,
  type RenewalOutcome,
  type RenewalOutcomeInput,
  type RenewalStage,
} from "@/lib/amc/renewal-outcomes";
import { recordAmcAudit } from "@/lib/server/amc/audit";
import { loadContractRows } from "@/lib/server/amc/business";
import { setContractStatus } from "@/lib/server/amc/contract-state";
import { ContractError, isMissingTable } from "@/lib/server/amc/contracts";
import { notifyUsers } from "@/lib/server/amc/notifications";
import { recordStatusChange } from "@/lib/server/amc/status-history";
import { closeAmcTodos, openAmcTodo } from "@/lib/server/amc/todos";

/**
 * Renewals on the server (Phase 13: DEV-415, 416, to-do 7). The renewals
 * due view, the outcome, last year's summary beside the draft, and the
 * daily sweep: expiry notices at 60 and 30 days, the reminder and to-do at
 * the lead time (owner, and management when configured), escalation when
 * idle, renewed and lapsed outcomes recorded, and scheduled terminations
 * carried out on their date.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Actor = { id: string | null; label: string | null };
type Who = { userId: string; canApprove: boolean };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const NOT_MIGRATED = "Renewal outcomes are not set up on this database yet (migration 20261012140000).";
const missingColumn = (e: { code?: string } | null | undefined) => e?.code === "42703" || e?.code === "PGRST204";

/** Management for renewals: the level 2 approvers, else level 1. */
export function renewalManagement(config: AmcConfig): string[] {
  const l2 = approversForLevel(config, 2);
  return l2.length ? l2 : approversForLevel(config, 1);
}

/* ------------------------------------------------------------------ */
/* Last year, beside the renewal draft (DEV-416)                       */
/* ------------------------------------------------------------------ */

export async function pastYearSummary(admin: Admin, contractId: string) {
  const [visits, callOuts, works, ents] = await Promise.all([
    admin.from("amc_visits").select("status").eq("contract_id", contractId).neq("status", "cancelled"),
    admin.from("amc_call_outs").select("priority, coverage, status").eq("contract_id", contractId).neq("status", "cancelled"),
    admin.from("amc_additional_works").select("status, total").eq("contract_id", contractId),
    admin.from("amc_contract_entitlements").select("service_label, entitlement_type, included_quantity, used_quantity").eq("contract_id", contractId).order("sort_order"),
  ]);
  const v = (visits.data ?? []) as Row[];
  const c = (callOuts.data ?? []) as Row[];
  const w = (works.data ?? []) as Row[];
  const done = ["completed", "completed_with_additional_work", "partially_completed"];
  const sum = (rows: Row[], statuses: string[]) => Math.round(rows.filter((r) => statuses.includes(String(r.status))).reduce((s, r) => s + Number(r.total ?? 0), 0) * 100) / 100;
  return {
    visits: { planned: v.length, done: v.filter((x) => done.includes(String(x.status))).length, notCompleted: v.filter((x) => x.status === "not_completed").length },
    callOuts: {
      total: c.length,
      emergency: c.filter((x) => x.priority === "emergency").length,
      chargeable: c.filter((x) => x.coverage === "chargeable").length,
    },
    additionalWork: { count: w.length, approved: sum(w, ["approved", "scheduled", "completed", "invoiced", "paid"]), paid: sum(w, ["paid"]) },
    allowances: ((ents.data ?? []) as Row[])
      .filter((e) => e.entitlement_type === "visits" || e.entitlement_type === "hours")
      .map((e) => ({ service: String(e.service_label), included: Number(e.included_quantity ?? 0), used: Number(e.used_quantity ?? 0) })),
  };
}

export type PastYearSummary = Awaited<ReturnType<typeof pastYearSummary>>;

/* ------------------------------------------------------------------ */
/* The renewals due view (DEV-415)                                     */
/* ------------------------------------------------------------------ */

const RENEWAL_COLUMNS = "id, contract_number, renewal_outcome, renewal_outcome_reason, renewal_outcome_at, renewal_reminded_at, renewal_escalated_at, renewal_activity_at";

export interface RenewalDueRow {
  contractId: string;
  number: string;
  customerName: string;
  propertyLabel: string;
  status: string;
  endDate: string;
  daysLeft: number;
  grandTotal: number;
  suggestedTotal: number;
  stage: RenewalStage;
  outcome: RenewalOutcome | null;
  outcomeReason: string | null;
  renewalProposal: { id: string; proposalNumber: string; status: string } | null;
  renewedByContractId: string | null;
  remindedAt: string | null;
  escalatedAt: string | null;
  accountManagers: string[];
}

export async function renewalsDue(admin: Admin, who: Who, config: AmcConfig, now = new Date()) {
  const today = todayInDubai(now);
  const rows = (await loadContractRows(admin, who)).filter((r) => ["active", "on_hold", "expired"].includes(r.status));
  const extra = new Map<string, Row>();
  let migrated = true;
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await admin.from("amc_contracts").select(RENEWAL_COLUMNS).in("id", rows.slice(i, i + 200).map((r) => r.id));
    if (error) {
      if (missingColumn(error)) migrated = false;
      else throw new ContractError(error.message, 400);
      break;
    }
    for (const d of (data ?? []) as Row[]) extra.set(String(d.id), d);
  }
  const rules = { leadDays: config.renewals.leadDays, idleEscalationDays: config.renewals.idleEscalationDays };
  const due: RenewalDueRow[] = rows
    .map((r) => {
      const d = extra.get(r.id) ?? {};
      const outcome = (str(d.renewal_outcome) as RenewalOutcome | null) ?? null;
      const stage = renewalStage(
        { status: r.status, endDate: r.endDate, renewedByContractId: r.renewedByContractId, outcome, remindedAt: str(d.renewal_reminded_at), activityAt: str(d.renewal_activity_at) },
        today,
        rules,
      );
      return {
        contractId: r.id,
        number: str(d.contract_number) ?? r.proposalNumber,
        customerName: r.customerName,
        propertyLabel: r.propertyLabel,
        status: r.status,
        endDate: r.endDate,
        daysLeft: daysUntil(today, r.endDate),
        grandTotal: r.grandTotal,
        suggestedTotal: escalate(r.grandTotal, config.renewals.escalationPercent),
        stage,
        outcome,
        outcomeReason: str(d.renewal_outcome_reason),
        renewalProposal: r.renewalProposal,
        renewedByContractId: r.renewedByContractId,
        remindedAt: str(d.renewal_reminded_at),
        escalatedAt: str(d.renewal_escalated_at),
        accountManagers: [...r.accountManagers],
      };
    })
    /* Due and idle, ended without a renewal in the last 90 days, and settled ones that ended in the last 30 (to see the outcome). */
    .filter((r) => (r.stage !== "not_due" && r.stage !== "settled" ? r.daysLeft >= -90 : r.stage === "settled" && r.daysLeft >= -30 && r.daysLeft <= config.renewals.leadDays))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  return { migrated, today, leadDays: config.renewals.leadDays, escalationPercent: config.renewals.escalationPercent, rows: due };
}

/* ------------------------------------------------------------------ */
/* The outcome                                                         */
/* ------------------------------------------------------------------ */

/** Something was done about the renewal: the idle clock starts again. */
export async function touchRenewal(admin: Admin, contractId: string) {
  const { error } = await admin.from("amc_contracts").update({ renewal_activity_at: new Date().toISOString() }).eq("id", contractId);
  if (error && !missingColumn(error)) console.warn("[amc:renewals] activity not stamped:", error.message);
}

async function setOutcome(admin: Admin, contractId: string, outcome: RenewalOutcome, reason: string | null, actor: Actor, origin: "portal" | "system") {
  const { data: before, error: readError } = await admin.from("amc_contracts").select("renewal_outcome").eq("id", contractId).maybeSingle<Row>();
  if (readError) {
    if (missingColumn(readError) || isMissingTable(readError)) throw new ContractError(NOT_MIGRATED, 503);
    throw new ContractError(readError.message, 400);
  }
  const now = new Date().toISOString();
  const { error } = await admin
    .from("amc_contracts")
    .update({ renewal_outcome: outcome, renewal_outcome_reason: reason, renewal_outcome_at: now, renewal_outcome_by: actor.id, renewal_activity_at: now })
    .eq("id", contractId);
  if (error) throw new ContractError(error.message, error.code === "23514" ? 400 : 500);
  await recordStatusChange(admin, {
    entityType: "renewal",
    entityId: contractId,
    from: str(before?.renewal_outcome),
    to: outcome,
    reason,
    actor,
    origin,
  });
  if (FINAL_OUTCOMES.includes(outcome)) {
    await closeAmcTodos(admin, { entityType: "contract", entityId: contractId, kind: "renewal_due" }, { status: "done", reason: RENEWAL_OUTCOME_LABELS[outcome] }).catch(() => 0);
  }
}

export async function recordRenewalOutcome(admin: Admin, contractId: string, input: RenewalOutcomeInput, actor: Actor) {
  await setOutcome(admin, contractId, input.outcome, input.reason ?? null, actor, "portal");
  return { ok: true as const };
}

/* ------------------------------------------------------------------ */
/* The daily sweep (job "renewals")                                    */
/* ------------------------------------------------------------------ */

export async function runRenewalSweep(admin: Admin, config: AmcConfig, now = new Date()) {
  const today = todayInDubai(now);
  const result = { notices: 0, reminders: 0, escalations: 0, renewed: 0, lapsed: 0, terminated: 0, skipped: null as string | null };
  const { data, error } = await admin
    .from("amc_contracts")
    .select(
      `id, status, end_date, contract_number, proposal_number, customer_name, property_label, renewed_from_contract_id, ${RENEWAL_COLUMNS.replace("id, contract_number, ", "")}, termination_effective_on, termination_notice_on, ` +
        "submission:amc_submissions!amc_contracts_submission_id_fkey(owner_id)",
    )
    .in("status", ["active", "on_hold", "expired"])
    .lte("end_date", new Date(Date.parse(`${today}T00:00:00Z`) + Math.max(60, config.renewals.leadDays) * 86_400_000).toISOString().slice(0, 10))
    .limit(2000);
  if (error) {
    if (missingColumn(error) || isMissingTable(error)) return { ...result, skipped: "not migrated" };
    throw new Error(error.message);
  }
  const contracts = (data ?? []) as unknown as Row[];
  const ids = contracts.map((c) => String(c.id));
  /* Successors and renewal proposals for these contracts. */
  const successors = new Map<string, string>();
  const proposals = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const [{ data: next }, { data: props }] = await Promise.all([
      admin.from("amc_contracts").select("id, renewed_from_contract_id").in("renewed_from_contract_id", chunk),
      admin.from("amc_submissions").select("renewal_of_contract_id, status").in("renewal_of_contract_id", chunk),
    ]);
    for (const n of (next ?? []) as Row[]) successors.set(String(n.renewed_from_contract_id), String(n.id));
    for (const p of (props ?? []) as Row[]) proposals.set(String(p.renewal_of_contract_id), String(p.status));
  }
  const management = renewalManagement(config);
  const system: Actor = { id: null, label: "AMC renewals" };
  const rules = { leadDays: config.renewals.leadDays, idleEscalationDays: config.renewals.idleEscalationDays };

  for (const c of contracts) {
    const id = String(c.id);
    const number = String(c.contract_number ?? c.proposal_number ?? "");
    const ownerId = str(one(c.submission)?.owner_id);
    const outcome = (str(c.renewal_outcome) as RenewalOutcome | null) ?? null;
    const endDate = String(c.end_date);
    const left = daysUntil(today, endDate);
    const link = `/extensions/amc-contracts/${id}?tab=renewal`;

    /* A scheduled termination whose date has come. */
    const effective = str(c.termination_effective_on);
    if (effective && effective <= today && ["active", "on_hold"].includes(String(c.status))) {
      try {
        await setContractStatus(admin, id, String(c.status), "terminated", { status_reason: `Terminated on notice of ${String(c.termination_notice_on ?? "")}` }, system, "Early termination took effect");
        await cancelVisitsFrom(admin, id, effective, "Contract terminated");
        result.terminated += 1;
      } catch (e) {
        console.warn("[amc:renewals] termination not applied:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    /* Renewed: the outcome follows the new contract. */
    const successor = successors.get(id);
    if (successor && !outcome) {
      const [{ data: oldEnts }, { data: newEnts }] = await Promise.all([
        admin.from("amc_contract_entitlements").select("service_id, units, frequency").eq("contract_id", id),
        admin.from("amc_contract_entitlements").select("service_id, units, frequency").eq("contract_id", successor),
      ]);
      const shape = (rows: Row[] | null) => ((rows ?? []) as Row[]).map((e) => ({ serviceId: String(e.service_id), units: Number(e.units), frequency: Number(e.frequency) }));
      await setOutcome(admin, id, renewedOutcome(shape(oldEnts), shape(newEnts)), null, system, "system");
      result.renewed += 1;
      continue;
    }

    const stage = renewalStage(
      { status: String(c.status), endDate, renewedByContractId: successor ?? null, outcome, remindedAt: str(c.renewal_reminded_at), activityAt: str(c.renewal_activity_at) },
      today,
      rules,
    );
    if (stage === "settled") continue;

    /* Lapsed: ended, nothing renewed it, nobody negotiating, no live renewal proposal. */
    if (stage === "overdue") {
      const proposal = proposals.get(id);
      if (outcome !== "under_negotiation" && (!proposal || proposal === "proposal_rejected")) {
        await setOutcome(admin, id, "lapsed", "Ended without a renewal", system, "system");
        result.lapsed += 1;
      }
      continue;
    }

    /* Expiring in 60 and 30 days (BRD 6.2). */
    const notice = expiryNotice(today, endDate);
    if (notice) {
      const sent = await notifyUsers(admin, {
        event: "contract_expiring",
        userIds: [ownerId, ...(config.renewals.notifyManagement ? management : [])].filter((v): v is string => Boolean(v)),
        title: `AMC ${number} expires in ${left} day${left === 1 ? "" : "s"}`,
        body: `${String(c.customer_name ?? "")}, ${String(c.property_label ?? "")}: ends ${endDate}.`,
        link,
        entityType: "contract",
        entityId: id,
        contractId: id,
        dedupeKey: `contract_expiring:${id}:${notice}`,
      });
      if (sent) result.notices += 1;
    }

    /* The reminder and the to-do at the lead time (DEV-415, to-do 7). */
    if (stage === "due" && !c.renewal_reminded_at) {
      const { data: claimed } = await admin.from("amc_contracts").update({ renewal_reminded_at: now.toISOString() }).eq("id", id).is("renewal_reminded_at", null).select("id");
      if (!claimed?.length) continue;
      const past = await pastYearSummary(admin, id);
      const escalateAt = new Date(now.getTime() + config.renewals.idleEscalationDays * 86_400_000).toISOString();
      await openAmcTodo(
        admin,
        {
          kind: "renewal_due",
          entityType: "contract",
          entityId: id,
          dedupeKey: `renewal_due:${id}:${endDate}`,
          title: `Renewal due: AMC ${number}, ${String(c.customer_name ?? "")}`,
          description:
            `Ends ${endDate}. Last year: ${past.visits.done} of ${past.visits.planned} visits done, ${past.callOuts.total} call outs (${past.callOuts.chargeable} chargeable), ` +
            `${past.additionalWork.count} additional works (AED ${past.additionalWork.approved} approved). Open the renewal draft, send it, and record the outcome.`,
          ownerId: ownerId ?? management[0] ?? "",
          assigneeIds: [ownerId].filter((v): v is string => Boolean(v)),
          dueAt: new Date(`${endDate}T08:00:00+04:00`).toISOString(),
          escalateAt,
        },
        config,
      ).catch((e) => console.error("[amc:renewals] to-do not opened:", e instanceof Error ? e.message : e));
      await notifyUsers(admin, {
        event: "renewal_due",
        userIds: [ownerId, ...(config.renewals.notifyManagement ? management : [])].filter((v): v is string => Boolean(v)),
        title: `Renewal due: AMC ${number}`,
        body: `${String(c.customer_name ?? "")}: ends ${endDate}. Last year ${past.visits.done} visits, ${past.callOuts.total} call outs.`,
        link,
        entityType: "contract",
        entityId: id,
        contractId: id,
        dedupeKey: `renewal_due:${id}:${endDate}`,
      });
      await recordAmcAudit(admin, { entityType: "contract", entityId: id, eventType: "renewal_reminder_created", origin: "system", payload: { endDate, leadDays: config.renewals.leadDays } });
      result.reminders += 1;
      continue;
    }

    /* No renewal activity for the idle days: management hears (BRD 5.16). */
    if (stage === "idle" && !c.renewal_escalated_at) {
      const { data: claimed } = await admin.from("amc_contracts").update({ renewal_escalated_at: now.toISOString() }).eq("id", id).is("renewal_escalated_at", null).select("id");
      if (!claimed?.length) continue;
      await notifyUsers(admin, {
        event: "renewal_idle",
        userIds: management.length ? management : [ownerId].filter((v): v is string => Boolean(v)),
        title: `No renewal activity: AMC ${number}`,
        body: `${String(c.customer_name ?? "")}: ends ${endDate} (${left} days). Nothing done for ${config.renewals.idleEscalationDays} days since the reminder.`,
        link,
        entityType: "contract",
        entityId: id,
        contractId: id,
        dedupeKey: `renewal_idle:${id}:${endDate}`,
      });
      result.escalations += 1;
    }
  }
  return result;
}

/** Visits from a date on are called off (termination, cancellation). */
export async function cancelVisitsFrom(admin: Admin, contractId: string, from: string, reason: string) {
  const { error } = await admin
    .from("amc_visits")
    .update({ status: "cancelled", status_reason: reason, updated_at: new Date().toISOString() })
    .eq("contract_id", contractId)
    .gte("window_start", from)
    .in("status", ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access"]);
  if (error && !isMissingTable(error)) console.warn("[amc:renewals] visits not cancelled:", error.message);
}
