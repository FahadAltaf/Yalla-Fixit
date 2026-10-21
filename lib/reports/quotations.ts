import { addDaysToDateString, zonedDateString } from "@/lib/scheduling/org-time";

/**
 * The quotation pipeline (BRD 5.2 B1; DEV-442): per status, how many, how
 * much and how long they have sat there; which have sat too long (N7) and
 * which are about to lapse with no answer (N8).
 *
 * Statuses are the BRD's seven. Their mapping onto FSM's values is D-13;
 * until it is confirmed, FSM's own names map one to one where they match,
 * "New" is "Not sent", and any value not listed keeps its own name as an
 * extra group, so nothing is hidden.
 *
 * Days in status count calendar days in the org's zone. The day a status
 * started is known exactly when the sync saw the change; for quotations
 * that already had it when the sync started, the matching FSM timestamp
 * stands in (created, approved, rejected, expired), else the last change
 * time, and the figure is marked as estimated.
 *
 * Value is the quotation's pre-tax Sub_Total, as in the invoicing queue
 * (D-05).
 */

export type StatusKey = "notSent" | "sent" | "approved" | "converted" | "rejected" | "revised" | "expired";

export const QUOTATION_STATUSES: ReadonlyArray<{
  key: StatusKey;
  label: string;
  fsm: readonly string[];
  /** Still waiting on someone: ageing and expiry apply. */
  open: boolean;
  /** Waiting on the client's answer: the expiry warning applies (N8). */
  awaitingClient: boolean;
}> = [
  { key: "notSent", label: "Not sent", fsm: ["New", "Not Sent"], open: true, awaitingClient: true },
  { key: "sent", label: "Sent", fsm: ["Sent"], open: true, awaitingClient: true },
  { key: "approved", label: "Approved", fsm: ["Approved"], open: true, awaitingClient: false },
  { key: "converted", label: "Converted to work order", fsm: ["Converted to Work Order"], open: false, awaitingClient: false },
  { key: "rejected", label: "Rejected", fsm: ["Rejected", "Declined"], open: false, awaitingClient: false },
  { key: "revised", label: "Revised", fsm: ["Revised"], open: false, awaitingClient: false },
  { key: "expired", label: "Expired", fsm: ["Expired"], open: false, awaitingClient: false },
];

export type QuotationRecord = {
  id: string;
  number: string | null;
  status: string | null;
  value: number;
  ownerName: string | null;
  ownerEmail: string | null;
  clientName: string | null;
  createdAt: string | null;
  expiryDate: string | null;
  statusChangedAt: string | null;
  statusSinceEstimated: boolean;
  approvedAt: string | null;
  rejectedAt: string | null;
  expiredAt: string | null;
};

export type AgeingLimits = { notSent: number; sent: number; approved: number };

export type QuotationRow = QuotationRecord & {
  /** A StatusKey, or "other:<FSM value>" for a value not mapped yet. */
  statusKey: string;
  statusLabel: string;
  open: boolean;
  statusSince: string | null;
  statusSinceExact: boolean;
  daysInStatus: number | null;
  ageingLimit: number | null;
  /** Over its status's limit (N7). */
  breached: boolean;
  daysToExpiry: number | null;
  /** Within the warning window with no answer from the client (N8). */
  expiring: boolean;
  /** Validity has ended but FSM still shows it waiting. */
  pastValidity: boolean;
  createdDate: string | null;
};

export const VALUE_BANDS = [
  { key: "under_5k", label: "Under AED 5,000", min: 0, max: 5_000 },
  { key: "5k_20k", label: "AED 5,000 – 20,000", min: 5_000, max: 20_000 },
  { key: "20k_50k", label: "AED 20,000 – 50,000", min: 20_000, max: 50_000 },
  { key: "50k_plus", label: "AED 50,000 and over", min: 50_000, max: Infinity },
] as const;

export type ValueBandKey = (typeof VALUE_BANDS)[number]["key"];

export function valueBandOf(value: number): ValueBandKey {
  return (VALUE_BANDS.find((b) => value >= b.min && value < b.max) ?? VALUE_BANDS[0]).key;
}

export function statusOf(fsmStatus: string | null): { key: string; label: string; open: boolean; awaitingClient: boolean } {
  const raw = (fsmStatus ?? "").trim();
  const known = QUOTATION_STATUSES.find((s) => s.fsm.some((v) => v.toLowerCase() === raw.toLowerCase()));
  if (known) return { key: known.key, label: known.label, open: known.open, awaitingClient: known.awaitingClient };
  const label = raw || "No status";
  return { key: `other:${label}`, label, open: false, awaitingClient: false };
}

/** Whole calendar days from one org-zone date to another, never negative. */
export function calendarDays(fromDate: string, toDate: string): number {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function signedDays(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000);
}

/** When the quotation entered its current status, and whether that is exact. */
export function statusSince(q: QuotationRecord, key: string): { at: string | null; exact: boolean } {
  if (!q.statusSinceEstimated && q.statusChangedAt) return { at: q.statusChangedAt, exact: true };
  const lifecycle: Record<string, string | null> = {
    notSent: q.createdAt,
    approved: q.approvedAt,
    rejected: q.rejectedAt,
    expired: q.expiredAt,
  };
  const at = lifecycle[key];
  if (at) return { at, exact: true };
  return { at: q.statusChangedAt ?? q.createdAt, exact: false };
}

export function buildQuotationRows(
  records: QuotationRecord[],
  options: { today: string; limits: AgeingLimits; expiryWarningDays: number; timeZone?: string },
): QuotationRow[] {
  return records.map((q) => {
    const status = statusOf(q.status);
    const since = statusSince(q, status.key);
    const daysInStatus = since.at ? calendarDays(zonedDateString(since.at, options.timeZone), options.today) : null;
    const ageingLimit = status.key in options.limits ? options.limits[status.key as keyof AgeingLimits] : null;
    const daysToExpiry = q.expiryDate ? signedDays(options.today, q.expiryDate) : null;
    const waiting = status.awaitingClient && daysToExpiry !== null;
    return {
      ...q,
      statusKey: status.key,
      statusLabel: status.label,
      open: status.open,
      statusSince: since.at,
      statusSinceExact: since.exact,
      daysInStatus,
      ageingLimit,
      breached: ageingLimit !== null && daysInStatus !== null && daysInStatus > ageingLimit,
      daysToExpiry,
      expiring: waiting && daysToExpiry! >= 0 && daysToExpiry! <= options.expiryWarningDays,
      pastValidity: waiting && daysToExpiry! < 0,
      createdDate: q.createdAt ? zonedDateString(q.createdAt, options.timeZone) : null,
    };
  });
}

export type QuotationFilters = {
  /** Created between these org-zone dates, inclusive. */
  from?: string;
  to?: string;
  owner?: string;
  client?: string;
  band?: string;
  /** A status key; "open" for every open status. */
  status?: string;
  /** "breached", "expiring" or "past_validity". */
  flag?: string;
  q?: string;
};

/** Everything except the status, so the status cards show what the other filters leave. */
export function filterQuotations(rows: QuotationRow[], f: QuotationFilters, options: { ignoreStatus?: boolean } = {}) {
  const needle = (f.q ?? "").trim().toLowerCase();
  return rows.filter((r) => {
    if (f.from && (!r.createdDate || r.createdDate < f.from)) return false;
    if (f.to && (!r.createdDate || r.createdDate > f.to)) return false;
    if (f.owner && r.ownerName !== f.owner) return false;
    if (f.client && r.clientName !== f.client) return false;
    if (f.band && valueBandOf(r.value) !== f.band) return false;
    if (!options.ignoreStatus && f.status) {
      if (f.status === "open" ? !r.open : r.statusKey !== f.status) return false;
    }
    if (f.flag === "breached" && !r.breached) return false;
    if (f.flag === "expiring" && !r.expiring) return false;
    if (f.flag === "past_validity" && !r.pastValidity) return false;
    if (needle) {
      const hay = `${r.number ?? ""} ${r.clientName ?? ""} ${r.ownerName ?? ""}`.toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export type StatusSummary = {
  key: string;
  label: string;
  open: boolean;
  count: number;
  value: number;
  /** Mean days in status; null when no row has a start time. */
  averageDays: number | null;
  ageingLimit: number | null;
  breached: number;
  expiring: number;
};

/** One entry per BRD status (zeros included) plus any unmapped FSM value present. */
export function summariseByStatus(rows: QuotationRow[], limits: AgeingLimits): StatusSummary[] {
  const groups = new Map<string, StatusSummary & { daysTotal: number; daysCount: number }>();
  const ensure = (key: string, label: string, open: boolean) => {
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        label,
        open,
        count: 0,
        value: 0,
        averageDays: null,
        ageingLimit: key in limits ? limits[key as keyof AgeingLimits] : null,
        breached: 0,
        expiring: 0,
        daysTotal: 0,
        daysCount: 0,
      };
      groups.set(key, g);
    }
    return g;
  };
  for (const s of QUOTATION_STATUSES) ensure(s.key, s.label, s.open);
  for (const r of rows) {
    const g = ensure(r.statusKey, r.statusLabel, r.open);
    g.count += 1;
    g.value += r.value;
    if (r.daysInStatus !== null) {
      g.daysTotal += r.daysInStatus;
      g.daysCount += 1;
    }
    if (r.breached) g.breached += 1;
    if (r.expiring) g.expiring += 1;
  }
  return [...groups.values()].map(({ daysTotal, daysCount, ...g }) => ({
    ...g,
    value: Math.round(g.value * 100) / 100,
    averageDays: daysCount ? Math.round((daysTotal / daysCount) * 10) / 10 : null,
  }));
}

/** Longest-waiting first; closed statuses after open ones. */
export function sortQuotationRows(rows: QuotationRow[]): QuotationRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(b.open) - Number(a.open) ||
      Number(b.breached) - Number(a.breached) ||
      (b.daysInStatus ?? -1) - (a.daysInStatus ?? -1) ||
      (a.number ?? "").localeCompare(b.number ?? ""),
  );
}

/** Dates for a preset range ending today. */
export function lastDays(today: string, days: number): { from: string; to: string } {
  return { from: addDaysToDateString(today, -(days - 1)), to: today };
}
