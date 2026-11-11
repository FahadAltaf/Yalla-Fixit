/**
 * AMC operational and commercial reports and the management dashboard
 * (BRD v0.3 5.15, 6.9; Phase 12: DEV-411, 412, 414). Pure aggregations
 * over rows the server has already scoped to what the caller may see, so
 * the screens, the CSV/Excel exports and the tests read the same numbers.
 */

const dayMs = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / dayMs);
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const monthOf = (iso: string) => iso.slice(0, 7);
const inRange = (iso: string | null, from: string, to: string) => Boolean(iso) && iso!.slice(0, 10) >= from && iso!.slice(0, 10) <= to;

/* ------------------------------------------------------------------ */
/* Operational (DEV-411)                                               */
/* ------------------------------------------------------------------ */

export const DONE_VISIT = ["completed", "completed_with_additional_work", "partially_completed"] as const;
const OPEN_VISIT = ["not_scheduled", "scheduled", "rescheduled", "confirmed", "pending_access", "in_progress", "submitted"];

export interface VisitFact {
  id: string;
  contractId: string;
  status: string;
  windowStart: string;
  windowEnd: string;
  /** When the work was done (job sheet completion, else closure). */
  doneAt: string | null;
}

/** Schedule adherence: visits done in the period, inside their service window or not. */
export function adherence(visits: VisitFact[], from: string, to: string) {
  const done = visits.filter((v) => (DONE_VISIT as readonly string[]).includes(v.status) && inRange(v.doneAt, from, to));
  const within = done.filter((v) => {
    const d = v.doneAt!.slice(0, 10);
    return d >= v.windowStart && d <= v.windowEnd;
  });
  const late = done.filter((v) => v.doneAt!.slice(0, 10) > v.windowEnd).length;
  return { done: done.length, within: within.length, early: done.length - within.length - late, late, percent: pct(within.length, done.length) };
}

export const REASON_GROUPS = ["client", "internal", "material", "access", "partial"] as const;
export type ReasonGroup = (typeof REASON_GROUPS)[number];

/** Visits due (window open), overdue (window passed), pending access, and not completed by reason group. */
export function visitBacklog(visits: VisitFact[], lines: Array<{ visitId: string; outcomeGroup: string | null }>, today: string) {
  const open = visits.filter((v) => OPEN_VISIT.includes(v.status));
  const byGroup = Object.fromEntries(REASON_GROUPS.map((g) => [g, 0])) as Record<ReasonGroup, number>;
  const notDone = new Set(visits.filter((v) => v.status === "not_completed" || v.status === "partially_completed").map((v) => v.id));
  for (const l of lines) if (notDone.has(l.visitId) && l.outcomeGroup && l.outcomeGroup in byGroup) byGroup[l.outcomeGroup as ReasonGroup] += 1;
  return {
    due: open.filter((v) => v.windowStart <= today && v.windowEnd >= today).length,
    overdue: open.filter((v) => v.windowEnd < today).length,
    upcoming: open.filter((v) => v.windowStart > today).length,
    pendingAccess: visits.filter((v) => v.status === "pending_access").length,
    notCompleted: visits.filter((v) => v.status === "not_completed").length,
    byReasonGroup: byGroup,
  };
}

export interface CallOutFact {
  priority: "emergency" | "non_emergency";
  status: string;
  coverage: "covered" | "chargeable";
  slaMet: boolean | null;
  dueAt: string | null;
  attendedAt: string | null;
  misuse: boolean;
  reportedAt: string;
}

/** Call outs by priority: SLA met or missed, still open, covered or chargeable, misuse. */
export function callOutStats(callOuts: CallOutFact[], now: Date) {
  const row = (priority: CallOutFact["priority"]) => {
    const list = callOuts.filter((c) => c.priority === priority && c.status !== "cancelled");
    const missed = list.filter((c) => c.slaMet === false || (!c.attendedAt && c.dueAt && Date.parse(c.dueAt) < now.getTime())).length;
    const met = list.filter((c) => c.slaMet === true).length;
    return {
      priority,
      total: list.length,
      met,
      missed,
      open: list.filter((c) => !["closed", "cancelled"].includes(c.status)).length,
      covered: list.filter((c) => c.coverage === "covered").length,
      chargeable: list.filter((c) => c.coverage === "chargeable").length,
      misuse: list.filter((c) => c.misuse).length,
      metPercent: pct(met, met + missed),
    };
  };
  return [row("emergency"), row("non_emergency")];
}

export interface ContractFact {
  id: string;
  number: string;
  customerName: string;
  propertyLabel: string;
  status: string;
  startDate: string;
  endDate: string;
  grandTotal: number;
  category: "residential" | "commercial" | null;
  signedAt: string | null;
  renewedByContractId: string | null;
  renewalProposalStatus: string | null;
}

/**
 * Contracts at risk of ending incomplete: in force, with planned visits
 * still to do, and either a visit already overdue or more visits left
 * than half-months before the end.
 */
export function contractsAtRisk(contracts: ContractFact[], visits: VisitFact[], today: string) {
  return contracts
    .filter((c) => c.status === "active" && c.endDate >= today)
    .map((c) => {
      const mine = visits.filter((v) => v.contractId === c.id);
      const remaining = mine.filter((v) => OPEN_VISIT.includes(v.status)).length;
      const overdue = mine.filter((v) => OPEN_VISIT.includes(v.status) && v.windowEnd < today).length;
      const daysLeft = daysBetween(today, c.endDate);
      const reasons: string[] = [];
      if (overdue) reasons.push(`${overdue} visit${overdue === 1 ? "" : "s"} overdue`);
      if (remaining > Math.max(1, Math.floor(daysLeft / 15))) reasons.push(`${remaining} visits left with ${daysLeft} days to go`);
      return { contractId: c.id, number: c.number, customerName: c.customerName, propertyLabel: c.propertyLabel, endDate: c.endDate, daysLeft, remaining, overdue, reasons };
    })
    .filter((r) => r.reasons.length > 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export interface VisitStatusFact {
  /** The month the visit belongs to (its target date). */
  month: string;
  status: string;
  technicianIds: string[];
  attempts: number;
}

const visitCounts = (list: VisitStatusFact[]) => ({
  total: list.length,
  done: list.filter((v) => v.status === "completed" || v.status === "completed_with_additional_work").length,
  partial: list.filter((v) => v.status === "partially_completed").length,
  notCompleted: list.filter((v) => v.status === "not_completed").length,
  open: list.filter((v) => OPEN_VISIT.includes(v.status)).length,
  attempts: list.reduce((s, v) => s + v.attempts, 0),
});

/** BRD 6.9: visits by status per month, with the confirmation attempts made. */
export function visitsByMonth(visits: VisitStatusFact[]) {
  const months = [...new Set(visits.map((v) => v.month))].sort();
  return months.map((month) => ({ month, ...visitCounts(visits.filter((v) => v.month === month)) }));
}

/** BRD 6.9: visits by status per technician (a visit counts for each technician on its crew). */
export function visitsByTechnician(visits: VisitStatusFact[], names: Map<string, string>) {
  const ids = [...new Set(visits.flatMap((v) => v.technicianIds))];
  return ids
    .map((id) => ({ fsmId: id, name: names.get(id) ?? id, ...visitCounts(visits.filter((v) => v.technicianIds.includes(id))) }))
    .sort((a, b) => b.total - a.total);
}

export interface BusyFact {
  technicianId: string;
  start: string;
  end: string;
}

/** Technician utilisation: AMC time booked against the working hours in the period. */
export function utilisation(
  technicians: Array<{ fsmId: string; name: string }>,
  blocks: BusyFact[],
  workingDays: number,
  hoursPerDay = 8,
) {
  const available = workingDays * hoursPerDay * 60;
  return technicians
    .map((t) => {
      const minutes = blocks.filter((b) => b.technicianId === t.fsmId).reduce((m, b) => m + Math.max(0, (Date.parse(b.end) - Date.parse(b.start)) / 60_000), 0);
      return { fsmId: t.fsmId, name: t.name, bookedHours: round2(minutes / 60), availableHours: round2(available / 60), percent: pct(minutes, available), jobs: blocks.filter((b) => b.technicianId === t.fsmId).length };
    })
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
}

/** Working days from `from` to `to` (inclusive), given the weekend and holidays. */
export function workingDaysIn(from: string, to: string, weekendDays: number[], holidays: string[]): number {
  let n = 0;
  for (let d = from; d <= to; d = new Date(Date.parse(`${d}T00:00:00Z`) + dayMs).toISOString().slice(0, 10)) {
    if (!weekendDays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && !holidays.includes(d)) n += 1;
  }
  return n;
}

export interface AllowanceFact {
  contractId: string;
  number: string;
  customerName: string;
  serviceLabel: string;
  entitlementType: string;
  included: number | null;
  used: number;
  reserved: number;
}

/** Allowance use per contract and service, the busiest first. */
export function allowanceUse(rows: AllowanceFact[], chargeableCallOuts: Map<string, number>) {
  return rows
    .filter((r) => r.entitlementType === "visits" || r.entitlementType === "hours")
    .map((r) => ({
      ...r,
      remaining: r.included === null ? null : round2(Math.max(0, r.included - r.used - r.reserved)),
      percent: r.included ? pct(r.used, r.included) : null,
      chargeableCallOuts: chargeableCallOuts.get(r.contractId) ?? 0,
    }))
    .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));
}

/** Access failures by community: trades not done for want of access (BRD 5.11 access group, and client no-access). */
export function accessFailures(rows: Array<{ community: string | null; outcomeGroup: string | null; outcomeReason: string | null }>) {
  const counts = new Map<string, { community: string; access: number; noAccessGiven: number }>();
  for (const r of rows) {
    const isAccess = r.outcomeGroup === "access";
    const isNoAccess = r.outcomeGroup === "client" && r.outcomeReason === "No access given";
    if (!isAccess && !isNoAccess) continue;
    const key = r.community?.trim() || "Not recorded";
    const c = counts.get(key) ?? { community: key, access: 0, noAccessGiven: 0 };
    if (isAccess) c.access += 1;
    else c.noAccessGiven += 1;
    counts.set(key, c);
  }
  return [...counts.values()].map((c) => ({ ...c, total: c.access + c.noAccessGiven })).sort((a, b) => b.total - a.total);
}

/* ------------------------------------------------------------------ */
/* Commercial (DEV-412)                                                */
/* ------------------------------------------------------------------ */

export interface EnquiryFact {
  enquiredAt: string;
  source: string;
  ownerName: string;
  stage: string;
  lostReason: string | null;
}

/** Enquiries by source, owner and month, with conversion and lost reasons (BRD 6.9). */
export function enquiryFunnel(enquiries: EnquiryFact[]) {
  const group = (key: (e: EnquiryFact) => string) => {
    const m = new Map<string, { key: string; total: number; won: number; lost: number; open: number }>();
    for (const e of enquiries) {
      const k = key(e) || "—";
      const g = m.get(k) ?? { key: k, total: 0, won: 0, lost: 0, open: 0 };
      g.total += 1;
      if (e.stage === "Won") g.won += 1;
      else if (e.stage === "Lost") g.lost += 1;
      else g.open += 1;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, conversion: pct(g.won, g.won + g.lost) })).sort((a, b) => b.total - a.total);
  };
  const lost = new Map<string, number>();
  for (const e of enquiries) if (e.stage === "Lost") lost.set(e.lostReason?.trim() || "Not given", (lost.get(e.lostReason?.trim() || "Not given") ?? 0) + 1);
  return {
    total: enquiries.length,
    bySource: group((e) => e.source),
    byOwner: group((e) => e.ownerName),
    byMonth: group((e) => monthOf(e.enquiredAt)).sort((a, b) => a.key.localeCompare(b.key)),
    lostReasons: [...lost.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
  };
}

export interface ProposalFact {
  status: string;
  createdAt: string;
  finalPrice: number;
  discountPercent: number;
  category: "residential" | "commercial" | null;
}

const SENT = ["proposal_sent", "proposal_rejected", "proposal_approved", "contract_sent", "signed"];
const ACCEPTED = ["proposal_approved", "contract_sent", "signed"];

/** Proposals and conversion: how many reached the client, were accepted, signed. */
export function proposalConversion(proposals: ProposalFact[]) {
  const count = (statuses: string[]) => proposals.filter((p) => statuses.includes(p.status)).length;
  const sent = count(SENT);
  const accepted = count(ACCEPTED);
  const signed = count(["signed"]);
  return {
    created: proposals.length,
    inApproval: count(["awaiting_approval", "sent_back"]),
    sent,
    accepted,
    rejected: count(["proposal_rejected"]),
    signed,
    acceptanceRate: pct(accepted, sent),
    signedRate: pct(signed, sent),
    value: round2(proposals.reduce((s, p) => s + p.finalPrice, 0)),
    signedValue: round2(proposals.filter((p) => p.status === "signed").reduce((s, p) => s + p.finalPrice, 0)),
  };
}

/** Discounts by approval level (the configured thresholds decide the level). */
export function discountsByLevel(proposals: ProposalFact[], levelOf: (discountPercent: number) => number, levelName: (level: number) => string) {
  const rows = new Map<number, { level: number; name: string; count: number; value: number; discountSum: number }>();
  for (const p of proposals) {
    const level = p.discountPercent > 0 ? levelOf(p.discountPercent) : -1;
    const r = rows.get(level) ?? { level, name: level === -1 ? "No discount" : level === 0 ? "Within the coordinator's limit" : levelName(level), count: 0, value: 0, discountSum: 0 };
    r.count += 1;
    r.value += p.finalPrice;
    r.discountSum += p.discountPercent;
    rows.set(level, r);
  }
  return [...rows.values()]
    .map((r) => ({ level: r.level, name: r.name, count: r.count, value: round2(r.value), averageDiscount: r.count ? round2(r.discountSum / r.count) : 0 }))
    .sort((a, b) => a.level - b.level);
}

/** Signed value by month and property category (contracts signed in the period). */
export function signedValue(contracts: ContractFact[], from: string, to: string) {
  const m = new Map<string, { month: string; residential: number; commercial: number; unknown: number; count: number }>();
  for (const c of contracts) {
    if (!inRange(c.signedAt, from, to)) continue;
    const k = monthOf(c.signedAt!);
    const r = m.get(k) ?? { month: k, residential: 0, commercial: 0, unknown: 0, count: 0 };
    r[c.category ?? "unknown"] += c.grandTotal;
    r.count += 1;
    m.set(k, r);
  }
  return [...m.values()]
    .map((r) => ({ ...r, residential: round2(r.residential), commercial: round2(r.commercial), unknown: round2(r.unknown), total: round2(r.residential + r.commercial + r.unknown) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export interface InstalmentFact {
  contractId: string;
  dueDate: string;
  total: number;
  received: number;
  status: string;
}

export const AGEING_BUCKETS = ["Not due", "0-30", "31-60", "61-90", "90+"] as const;

/** Collections and ageing: what is still owed, by days past due. */
export function ageing(instalments: InstalmentFact[], today: string) {
  const buckets = Object.fromEntries(AGEING_BUCKETS.map((b) => [b, { bucket: b, count: 0, amount: 0 }])) as Record<(typeof AGEING_BUCKETS)[number], { bucket: string; count: number; amount: number }>;
  for (const i of instalments) {
    if (["received", "written_off", "waived"].includes(i.status)) continue;
    const owed = Math.max(0, i.total - i.received);
    if (owed <= 0) continue;
    const late = daysBetween(i.dueDate, today);
    const b = late < 0 ? "Not due" : late <= 30 ? "0-30" : late <= 60 ? "31-60" : late <= 90 ? "61-90" : "90+";
    buckets[b].count += 1;
    buckets[b].amount += owed;
  }
  return AGEING_BUCKETS.map((b) => ({ ...buckets[b], amount: round2(buckets[b].amount) }));
}

/** Money received in the period, by month (payments not voided). */
export function collections(payments: Array<{ receivedOn: string; amount: number; voided: boolean }>, from: string, to: string) {
  const m = new Map<string, number>();
  for (const p of payments) if (!p.voided && inRange(p.receivedOn, from, to)) m.set(monthOf(p.receivedOn), (m.get(monthOf(p.receivedOn)) ?? 0) + p.amount);
  return [...m.entries()].map(([month, amount]) => ({ month, amount: round2(amount) })).sort((a, b) => a.month.localeCompare(b.month));
}

export function chequesByStatus(cheques: Array<{ status: string; amount: number }>) {
  const order = ["held", "deposited", "cleared", "bounced", "replaced", "returned"];
  return order.map((status) => {
    const list = cheques.filter((c) => c.status === status);
    return { status, count: list.length, amount: round2(list.reduce((s, c) => s + c.amount, 0)) };
  });
}

/** Additional-work revenue: quoted, approved, invoiced and paid, per month raised. */
export function workRevenue(works: Array<{ status: string; total: number; createdAt: string }>) {
  const sum = (statuses: string[]) => round2(works.filter((w) => statuses.includes(w.status)).reduce((s, w) => s + w.total, 0));
  return {
    raised: works.length,
    quoted: sum(["shared", "approved", "scheduled", "completed", "invoiced", "paid"]),
    approved: sum(["approved", "scheduled", "completed", "invoiced", "paid"]),
    rejected: sum(["rejected"]),
    invoiced: sum(["invoiced", "paid"]),
    paid: sum(["paid"]),
    approvalRate: pct(
      works.filter((w) => ["approved", "scheduled", "completed", "invoiced", "paid"].includes(w.status)).length,
      works.filter((w) => !["identified", "quotation_prepared", "shared"].includes(w.status)).length,
    ),
  };
}

/** Renewals of contracts ending in the period: renewed, in progress, not started. */
export function renewalOutcomes(contracts: ContractFact[], from: string, to: string) {
  const ending = contracts.filter((c) => c.endDate >= from && c.endDate <= to && c.status !== "cancelled");
  const renewed = ending.filter((c) => c.renewedByContractId).length;
  const inProgress = ending.filter((c) => !c.renewedByContractId && c.renewalProposalStatus).length;
  return { ending: ending.length, renewed, inProgress, notStarted: ending.length - renewed - inProgress, renewalRate: pct(renewed, ending.length) };
}

/* ------------------------------------------------------------------ */
/* Dashboard (DEV-414)                                                 */
/* ------------------------------------------------------------------ */

/** Renewals due in 30, 60 and 90 days, and how many have a renewal under way. */
export function renewalWindows(contracts: ContractFact[], today: string) {
  return [30, 60, 90].map((days) => {
    const list = contracts.filter((c) => c.status === "active" && !c.renewedByContractId && daysBetween(today, c.endDate) >= 0 && daysBetween(today, c.endDate) <= days);
    return {
      days,
      count: list.length,
      value: round2(list.reduce((s, c) => s + c.grandTotal, 0)),
      started: list.filter((c) => c.renewalProposalStatus).length,
    };
  });
}

/** The period a report covers: this month by default, never more than two years. */
export function reportPeriod(from: string | null, to: string | null, today: string) {
  const valid = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const end = valid(to) ?? today;
  let start = valid(from) ?? `${today.slice(0, 7)}-01`;
  if (start > end) start = end;
  if (daysBetween(start, end) > 731) start = new Date(Date.parse(`${end}T00:00:00Z`) - 731 * dayMs).toISOString().slice(0, 10);
  return { from: start, to: end };
}
