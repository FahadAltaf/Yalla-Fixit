import type { SupabaseClient } from "@supabase/supabase-js";

import type { AmcConfig } from "@/lib/amc/config";
import { todayInDubai } from "@/lib/amc/contracts";
import { approvalLevelName, discountApprovalLevel } from "@/lib/amc/proposal-rules";
import {
  accessFailures,
  adherence,
  ageing,
  allowanceUse,
  callOutStats,
  chequesByStatus,
  collections,
  contractsAtRisk,
  discountsByLevel,
  enquiryFunnel,
  proposalConversion,
  renewalOutcomes,
  renewalWindows,
  signedValue,
  utilisation,
  visitBacklog,
  workRevenue,
  workingDaysIn,
  type AllowanceFact,
  type BusyFact,
  type CallOutFact,
  type ContractFact,
  type VisitFact,
} from "@/lib/amc/reports";
import { loadContractRows } from "@/lib/server/amc/business";

/**
 * The operational and commercial reports and the management dashboard on
 * the server (Phase 12: DEV-411, 412, 414). Everything is scoped to the
 * contracts the caller may see (approvers and AMC Operations see all;
 * others their own), read in pages of 200 contract ids, and aggregated by
 * lib/amc/reports.ts. A table that is not migrated yet reads as empty, so
 * the reports work on a database part-way through the AMC migrations.
 */

type Admin = SupabaseClient;
type Row = Record<string, unknown>;
type Who = { userId: string; canApprove: boolean };
export type Period = { from: string; to: string };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const one = (v: unknown): Row | null => (Array.isArray(v) ? ((v[0] as Row | undefined) ?? null) : ((v as Row | null) ?? null));
const strings = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
const dayEnd = (d: string) => `${d}T23:59:59.999+04:00`;
const dayStart = (d: string) => `${d}T00:00:00+04:00`;

/** The filters a report adds to a query (the builder's own types recurse too deep to name). */
interface Filter {
  gte(column: string, value: string): Filter;
  lte(column: string, value: string): Filter;
  eq(column: string, value: string): Filter;
}

/** Rows of a table for these contracts, 200 ids at a time; empty when the table or a column is not there yet. */
async function forContracts(admin: Admin, table: string, columns: string, ids: string[], extra?: (q: Filter) => Filter): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const base = admin.from(table).select(columns).in("contract_id", ids.slice(i, i + 200)).limit(5000);
    const q = (extra ? extra(base as unknown as Filter) : base) as unknown as PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
    const { data, error } = await q;
    if (error) {
      console.warn(`[amc:insights] ${table} skipped:`, error.message);
      return [];
    }
    out.push(...((data ?? []) as unknown as Row[]));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The contracts in view                                               */
/* ------------------------------------------------------------------ */

interface Scope {
  contracts: ContractFact[];
  ids: string[];
  entitlements: AllowanceFact[];
  community: Map<string, string | null>;
}

async function scope(admin: Admin, who: Who): Promise<Scope> {
  const rows = await loadContractRows(admin, who);
  const ids = rows.map((r) => r.id);
  /* The number, signing date and category, which the shared contract rows do not carry. */
  const details = new Map<string, Row>();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const first = await admin.from("amc_contracts").select("id, contract_number, signed_at, unit_type, property").in("id", chunk);
    /* contract_number arrives with 20261007160000. */
    const rows = first.error ? (await admin.from("amc_contracts").select("id, signed_at, unit_type, property").in("id", chunk)).data : first.data;
    for (const d of (rows ?? []) as Row[]) details.set(String(d.id), d);
  }
  const ents = await forContracts(admin, "amc_contract_entitlements", "contract_id, service_label, entitlement_type, included_quantity, used_quantity, reserved_quantity", ids);
  const entRows = ents.length ? ents : await forContracts(admin, "amc_contract_entitlements", "contract_id, service_label, entitlement_type, included_quantity, used_quantity", ids);
  const contracts: ContractFact[] = rows.map((r) => {
    const d = details.get(r.id) ?? {};
    const property = (d.property ?? {}) as Row;
    const category = str(property.propertyCategory) ?? (d.unit_type === "office" ? "commercial" : d.unit_type ? "residential" : null);
    return {
      id: r.id,
      number: str(d.contract_number) ?? r.proposalNumber,
      customerName: r.customerName,
      propertyLabel: r.propertyLabel,
      status: r.status,
      startDate: r.startDate,
      endDate: r.endDate,
      grandTotal: r.grandTotal,
      category: category === "commercial" ? "commercial" : category === "residential" ? "residential" : null,
      signedAt: str(d.signed_at),
      renewedByContractId: r.renewedByContractId,
      renewalProposalStatus: r.renewalProposalStatus,
    };
  });
  const byId = new Map(contracts.map((c) => [c.id, c]));
  return {
    contracts,
    ids,
    entitlements: entRows.map((e) => ({
      contractId: String(e.contract_id),
      number: byId.get(String(e.contract_id))?.number ?? "",
      customerName: byId.get(String(e.contract_id))?.customerName ?? "",
      serviceLabel: String(e.service_label ?? ""),
      entitlementType: String(e.entitlement_type),
      included: e.included_quantity === null ? null : Number(e.included_quantity),
      used: Number(e.used_quantity ?? 0),
      reserved: Number(e.reserved_quantity ?? 0),
    })),
    community: new Map(
      rows.map((r) => {
        const property = ((details.get(r.id) ?? {}).property ?? {}) as Row;
        return [r.id, str(property.community) ?? str(property.area) ?? null];
      }),
    ),
  };
}

async function visitFacts(admin: Admin, ids: string[]): Promise<VisitFact[]> {
  let rows = await forContracts(admin, "amc_visits", "id, contract_id, status, window_start, window_end, closed_at, sheet:amc_visit_job_sheets(completed_at)", ids);
  if (!rows.length) rows = await forContracts(admin, "amc_visits", "id, contract_id, status, window_start, window_end", ids);
  return rows.map((v) => ({
    id: String(v.id),
    contractId: String(v.contract_id),
    status: String(v.status),
    windowStart: String(v.window_start),
    windowEnd: String(v.window_end),
    doneAt: str(one(v.sheet)?.completed_at) ?? str(v.closed_at),
  }));
}

async function callOutFacts(admin: Admin, ids: string[], period: Period | null): Promise<Array<CallOutFact & { contractId: string }>> {
  const rows = await forContracts(
    admin,
    "amc_call_outs",
    "contract_id, priority, status, coverage, sla_met, sla_attend_due_at, sla_schedule_due_at, attended_at, misuse_flag, reported_at",
    ids,
    period ? (q) => q.gte("reported_at", dayStart(period.from)).lte("reported_at", dayEnd(period.to)) : undefined,
  );
  return rows.map((c) => ({
    contractId: String(c.contract_id),
    priority: c.priority as CallOutFact["priority"],
    status: String(c.status),
    coverage: c.coverage as CallOutFact["coverage"],
    slaMet: c.sla_met === null || c.sla_met === undefined ? null : Boolean(c.sla_met),
    dueAt: str(c.sla_attend_due_at) ?? str(c.sla_schedule_due_at),
    attendedAt: str(c.attended_at),
    misuse: Boolean(c.misuse_flag),
    reportedAt: String(c.reported_at),
  }));
}

async function busyBlocks(admin: Admin, ids: string[], period: Period): Promise<BusyFact[]> {
  const inPeriod = (q: Filter) => q.gte("scheduled_start", dayStart(period.from)).lte("scheduled_start", dayEnd(period.to));
  const [visits, calls] = await Promise.all([
    forContracts(admin, "amc_visits", "scheduled_start, scheduled_end, technician_ids, status", ids, inPeriod),
    forContracts(admin, "amc_call_outs", "scheduled_start, scheduled_end, technician_ids, status", ids, inPeriod),
  ]);
  const out: BusyFact[] = [];
  for (const r of [...visits, ...calls]) {
    if (!r.scheduled_start || !r.scheduled_end || r.status === "cancelled") continue;
    for (const t of strings(r.technician_ids)) out.push({ technicianId: t, start: String(r.scheduled_start), end: String(r.scheduled_end) });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Operational (DEV-411)                                               */
/* ------------------------------------------------------------------ */

export async function operationalReport(admin: Admin, who: Who, period: Period, config: AmcConfig, now = new Date()) {
  const today = todayInDubai(now);
  const s = await scope(admin, who);
  const [visits, lines, callOuts, blocks, { data: techs }] = await Promise.all([
    visitFacts(admin, s.ids),
    forContracts(admin, "amc_visit_lines", "visit_id, contract_id, outcome_group, outcome_reason", s.ids),
    callOutFacts(admin, s.ids, period),
    busyBlocks(admin, s.ids, period),
    admin.from("technician_reference").select("fsm_resource_id, display_name").eq("is_active", true).order("display_name"),
  ]);
  const chargeable = new Map<string, number>();
  for (const c of callOuts) if (c.coverage === "chargeable") chargeable.set(c.contractId, (chargeable.get(c.contractId) ?? 0) + 1);
  const workingDays = workingDaysIn(period.from, period.to, config.calendar.weekendDays, config.calendar.holidays.map((h) => h.date));
  return {
    period,
    today,
    adherence: adherence(visits, period.from, period.to),
    backlog: visitBacklog(
      visits,
      lines.map((l) => ({ visitId: String(l.visit_id), outcomeGroup: str(l.outcome_group) })),
      today,
    ),
    callOuts: callOutStats(callOuts, now),
    atRisk: contractsAtRisk(s.contracts, visits, today),
    utilisation: utilisation(
      ((techs ?? []) as Row[]).map((t) => ({ fsmId: String(t.fsm_resource_id), name: String(t.display_name ?? t.fsm_resource_id) })),
      blocks,
      workingDays,
    ).filter((t) => t.jobs > 0 || who.canApprove),
    workingDays,
    allowances: allowanceUse(s.entitlements, chargeable),
    accessFailures: accessFailures(
      lines.map((l) => ({ community: s.community.get(String(l.contract_id)) ?? null, outcomeGroup: str(l.outcome_group), outcomeReason: str(l.outcome_reason) })),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Commercial (DEV-412)                                                */
/* ------------------------------------------------------------------ */

export async function commercialReport(admin: Admin, who: Who, period: Period, config: AmcConfig, now = new Date()) {
  const today = todayInDubai(now);
  const s = await scope(admin, who);

  let enq = admin
    .from("amc_enquiries")
    .select("enquired_at, source, stage, lost_reason, owner_id")
    .gte("enquired_at", dayStart(period.from))
    .lte("enquired_at", dayEnd(period.to))
    .limit(5000);
  if (!who.canApprove) enq = enq.eq("owner_id", who.userId);
  let props = admin
    .from("amc_submissions")
    .select("status, created_at, final_price, discount_percent, property")
    .gte("created_at", dayStart(period.from))
    .lte("created_at", dayEnd(period.to))
    .limit(5000);
  if (!who.canApprove) props = props.eq("owner_id", who.userId);
  const [{ data: enquiries }, { data: proposals }, instalments, payments, cheques, works] = await Promise.all([
    enq,
    props,
    forContracts(admin, "amc_instalments", "contract_id, due_date, total, received_amount, status", s.ids),
    forContracts(admin, "amc_payments", "amount, received_on, voided_at", s.ids, (q) => q.gte("received_on", period.from).lte("received_on", period.to)),
    forContracts(admin, "amc_cheques", "status, amount", s.ids),
    forContracts(admin, "amc_additional_works", "status, total, created_at", s.ids, (q) => q.gte("created_at", dayStart(period.from)).lte("created_at", dayEnd(period.to))),
  ]);
  const ownerIds = [...new Set(((enquiries ?? []) as Row[]).map((e) => str(e.owner_id)).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (ownerIds.length) {
    const { data } = await admin.from("user_profile").select("id, full_name, email").in("id", ownerIds);
    for (const u of (data ?? []) as Row[]) names.set(String(u.id), str(u.full_name) ?? str(u.email) ?? "—");
  }
  const proposalFacts = ((proposals ?? []) as Row[]).map((p) => {
    const property = (p.property ?? {}) as Row;
    const cat = str(property.propertyCategory);
    return {
      status: String(p.status),
      createdAt: String(p.created_at),
      finalPrice: Number(p.final_price ?? 0),
      discountPercent: Number(p.discount_percent ?? 0),
      category: cat === "commercial" ? ("commercial" as const) : cat === "residential" ? ("residential" as const) : null,
    };
  });
  return {
    period,
    today,
    enquiries: enquiryFunnel(
      ((enquiries ?? []) as Row[]).map((e) => ({
        enquiredAt: String(e.enquired_at),
        source: String(e.source ?? ""),
        ownerName: names.get(String(e.owner_id)) ?? "Unassigned",
        stage: String(e.stage),
        lostReason: str(e.lost_reason),
      })),
    ),
    proposals: proposalConversion(proposalFacts),
    discounts: discountsByLevel(
      proposalFacts,
      (d) => discountApprovalLevel(config.approvals, d),
      (level) => approvalLevelName(config.approvals, level),
    ),
    signedValue: signedValue(s.contracts, period.from, period.to),
    ageing: ageing(
      instalments.map((i) => ({ contractId: String(i.contract_id), dueDate: String(i.due_date), total: Number(i.total ?? 0), received: Number(i.received_amount ?? 0), status: String(i.status) })),
      today,
    ),
    collections: collections(
      payments.map((p) => ({ receivedOn: String(p.received_on), amount: Number(p.amount ?? 0), voided: Boolean(p.voided_at) })),
      period.from,
      period.to,
    ),
    cheques: chequesByStatus(cheques.map((c) => ({ status: String(c.status), amount: Number(c.amount ?? 0) }))),
    additionalWork: workRevenue(works.map((w) => ({ status: String(w.status), total: Number(w.total ?? 0), createdAt: String(w.created_at) }))),
    renewals: renewalOutcomes(s.contracts, period.from, period.to),
  };
}

/* ------------------------------------------------------------------ */
/* The management dashboard (DEV-414)                                  */
/* ------------------------------------------------------------------ */

export async function managementDashboard(admin: Admin, who: Who, config: AmcConfig, now = new Date()) {
  const today = todayInDubai(now);
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;
  const s = await scope(admin, who);

  let enq = admin.from("amc_enquiries").select("stage").not("stage", "in", "(Won,Lost)").limit(5000);
  if (!who.canApprove) enq = enq.eq("owner_id", who.userId);
  let props = admin.from("amc_submissions").select("status").neq("status", "signed").limit(5000);
  if (!who.canApprove) props = props.eq("owner_id", who.userId);
  const [{ data: enquiries }, { data: proposals }, { data: approvals }, visits, callOuts, sheets, instalments, payments, works, blocks, { count: techCount }] = await Promise.all([
    enq,
    props,
    admin.from("amc_approval_steps").select("id, approver_ids").eq("status", "pending").limit(2000),
    visitFacts(admin, s.ids),
    callOutFacts(admin, s.ids, null),
    forContracts(admin, "amc_visit_job_sheets", "status", s.ids, (q) => q.eq("status", "submitted")),
    forContracts(admin, "amc_instalments", "contract_id, due_date, total, received_amount, status", s.ids),
    forContracts(admin, "amc_payments", "amount, received_on, voided_at", s.ids, (q) => q.gte("received_on", monthStart)),
    forContracts(admin, "amc_additional_works", "status, total", s.ids, (q) => q.eq("status", "shared")),
    busyBlocks(admin, s.ids, { from: today, to: weekEnd }),
    admin.from("technician_reference").select("fsm_resource_id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const stageCounts = (rows: Row[], key: string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(String(r[key]), (m.get(String(r[key])) ?? 0) + 1);
    return [...m.entries()].map(([k, n]) => ({ key: k, count: n })).sort((a, b) => b.count - a.count);
  };
  const open = callOuts.filter((c) => !["closed", "cancelled"].includes(c.status));
  const owed = ageing(
    instalments.map((i) => ({ contractId: String(i.contract_id), dueDate: String(i.due_date), total: Number(i.total ?? 0), received: Number(i.received_amount ?? 0), status: String(i.status) })),
    today,
  );
  const backlog = visitBacklog(visits, [], today);
  const hoursBooked = blocks.reduce((m, b) => m + (Date.parse(b.end) - Date.parse(b.start)) / 3_600_000, 0);
  const workingDays = workingDaysIn(today, weekEnd, config.calendar.weekendDays, config.calendar.holidays.map((h) => h.date));
  const activeTechs = techCount ?? 0;
  return {
    today,
    pipeline: {
      openEnquiries: (enquiries ?? []).length,
      enquiriesByStage: stageCounts((enquiries ?? []) as Row[], "stage"),
      proposalsByStatus: stageCounts((proposals ?? []) as Row[], "status"),
    },
    contracts: {
      byStatus: stageCounts(s.contracts as unknown as Row[], "status"),
      active: s.contracts.filter((c) => c.status === "active").length,
      activeValue: Math.round(s.contracts.filter((c) => c.status === "active").reduce((t, c) => t + c.grandTotal, 0) * 100) / 100,
    },
    approvals: {
      pendingProposalSteps: ((approvals ?? []) as Row[]).filter((a) => who.canApprove || strings(a.approver_ids).includes(who.userId)).length,
      jobSheetsAwaitingReview: sheets.length,
    },
    delivery: {
      visitsDueThisWeek: visits.filter((v) => v.windowStart <= weekEnd && v.windowEnd >= today && !["completed", "completed_with_additional_work", "partially_completed", "not_completed", "cancelled"].includes(v.status)).length,
      overdueVisits: backlog.overdue,
      pendingAccess: backlog.pendingAccess,
      openCallOuts: open.length,
      openEmergencies: open.filter((c) => c.priority === "emergency").length,
      slaMissed: open.filter((c) => !c.attendedAt && c.dueAt && Date.parse(c.dueAt) < now.getTime()).length,
    },
    workforce: {
      activeTechnicians: activeTechs,
      bookedHoursNext7Days: Math.round(hoursBooked * 10) / 10,
      utilisationNext7Days: activeTechs && workingDays ? Math.round((hoursBooked / (activeTechs * workingDays * 8)) * 1000) / 10 : null,
    },
    commercial: {
      signedThisMonth: Math.round(s.contracts.filter((c) => c.signedAt && c.signedAt.slice(0, 10) >= monthStart).reduce((t, c) => t + c.grandTotal, 0) * 100) / 100,
      collectedThisMonth: Math.round(payments.filter((p) => !p.voided_at).reduce((t, p) => t + Number(p.amount ?? 0), 0) * 100) / 100,
      overdue: Math.round(owed.filter((b) => b.bucket !== "Not due").reduce((t, b) => t + b.amount, 0) * 100) / 100,
      quotationsAwaitingClient: works.length,
      quotationsAwaitingValue: Math.round(works.reduce((t, w) => t + Number(w.total ?? 0), 0) * 100) / 100,
    },
    renewals: renewalWindows(s.contracts, today),
  };
}
