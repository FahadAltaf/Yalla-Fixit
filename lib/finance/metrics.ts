/**
 * Invoicing controls (BRD §5.1 Step 8, §6.9; DEV-441), and the queue's
 * summary strip (§6.4). Pure: the server reads the rows, this does the
 * arithmetic, and the tests check it with exact figures.
 */

export type MetricItem = {
  id: string;
  status: "pending" | "in_progress" | "query_raised" | "on_hold" | "excluded" | "invoiced";
  value: number;
  enteredAt: string;
  holdReason?: string | null;
};

export type MetricInvoice = {
  queueItemId: string;
  amount: number;
  queueValue: number;
  recordedAt: string;
  recordedByLabel: string | null;
};

export type MetricExclusion = { queueItemId: string; reason: string; decision: string | null };

const OPEN = new Set(["pending", "in_progress", "query_raised", "on_hold"]);
const DAY_MS = 86_400_000;

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Whole days between two instants, never negative. */
export function daysBetween(from: string, to: string | Date): number {
  const end = typeof to === "string" ? Date.parse(to) : to.getTime();
  return Math.max(0, Math.floor((end - Date.parse(from)) / DAY_MS));
}

export type QueueSummary = {
  pending: { count: number; value: number };
  inProgress: { count: number; value: number };
  queryRaised: { count: number; value: number };
  onHold: { count: number; value: number };
  excluded: { count: number; value: number };
  invoiced: { count: number; value: number };
  /** Mean days from entering the queue to the invoice being recorded. Null with no invoices yet. */
  averageDaysToInvoice: number | null;
};

export function summarise(items: MetricItem[], invoices: MetricInvoice[]): QueueSummary {
  const bucket = (status: MetricItem["status"]) => {
    const rows = items.filter((i) => i.status === status);
    return { count: rows.length, value: round2(rows.reduce((sum, i) => sum + i.value, 0)) };
  };
  const entered = new Map(items.map((i) => [i.id, i.enteredAt]));
  const spans = invoices
    .filter((inv) => entered.has(inv.queueItemId))
    .map((inv) => (Date.parse(inv.recordedAt) - Date.parse(entered.get(inv.queueItemId) as string)) / DAY_MS);
  return {
    pending: bucket("pending"),
    inProgress: bucket("in_progress"),
    queryRaised: bucket("query_raised"),
    onHold: bucket("on_hold"),
    excluded: bucket("excluded"),
    invoiced: bucket("invoiced"),
    averageDaysToInvoice: spans.length ? round1(spans.reduce((a, b) => a + b, 0) / spans.length) : null,
  };
}

export const AGEING_BANDS = [
  { key: "0-7", label: "0–7 days", min: 0, max: 7 },
  { key: "8-14", label: "8–14 days", min: 8, max: 14 },
  { key: "15-30", label: "15–30 days", min: 15, max: 30 },
  { key: "31+", label: "Over 30 days", min: 31, max: Infinity },
] as const;

export type QueueMetrics = {
  openValue: number;
  ageing: { key: string; label: string; count: number; value: number }[];
  daysToInvoice: {
    average: number | null;
    byUser: { user: string; invoices: number; averageDays: number }[];
  };
  onHold: { id: string; value: number; reason: string; days: number }[];
  excludedByReason: { reason: string; count: number; value: number }[];
  variance: { invoices: number; withVariance: number; total: number; absoluteTotal: number };
};

export function computeQueueMetrics(
  items: MetricItem[],
  invoices: MetricInvoice[],
  exclusions: MetricExclusion[],
  now: Date,
): QueueMetrics {
  const open = items.filter((i) => OPEN.has(i.status));
  const byId = new Map(items.map((i) => [i.id, i]));

  const ageing = AGEING_BANDS.map((band) => {
    const rows = open.filter((i) => {
      const days = daysBetween(i.enteredAt, now);
      return days >= band.min && days <= band.max;
    });
    return { key: band.key, label: band.label, count: rows.length, value: round2(rows.reduce((s, i) => s + i.value, 0)) };
  });

  const spans = invoices
    .filter((inv) => byId.has(inv.queueItemId))
    .map((inv) => ({
      user: inv.recordedByLabel ?? "Unknown",
      days: (Date.parse(inv.recordedAt) - Date.parse(byId.get(inv.queueItemId)!.enteredAt)) / DAY_MS,
    }));
  const users = [...new Set(spans.map((s) => s.user))].sort();

  const excludedReasons = new Map<string, { count: number; value: number }>();
  for (const ex of exclusions.filter((e) => e.decision === "verified")) {
    const item = byId.get(ex.queueItemId);
    if (!item) continue;
    const entry = excludedReasons.get(ex.reason) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value = round2(entry.value + item.value);
    excludedReasons.set(ex.reason, entry);
  }

  const variances = invoices.map((inv) => round2(inv.amount - inv.queueValue));

  return {
    openValue: round2(open.reduce((s, i) => s + i.value, 0)),
    ageing,
    daysToInvoice: {
      average: spans.length ? round1(spans.reduce((a, s) => a + s.days, 0) / spans.length) : null,
      byUser: users.map((user) => {
        const mine = spans.filter((s) => s.user === user);
        return { user, invoices: mine.length, averageDays: round1(mine.reduce((a, s) => a + s.days, 0) / mine.length) };
      }),
    },
    onHold: items
      .filter((i) => i.status === "on_hold")
      .map((i) => ({ id: i.id, value: i.value, reason: i.holdReason ?? "", days: daysBetween(i.enteredAt, now) })),
    excludedByReason: [...excludedReasons.entries()]
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.value - a.value),
    variance: {
      invoices: invoices.length,
      withVariance: variances.filter((v) => v !== 0).length,
      total: round2(variances.reduce((a, b) => a + b, 0)),
      absoluteTotal: round2(variances.reduce((a, b) => a + Math.abs(b), 0)),
    },
  };
}
