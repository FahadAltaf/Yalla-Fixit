import { addDaysToDateString, zonedDateString } from "@/lib/scheduling/org-time";

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
  /** When the item reached its current status; the aged rule reads it for Pending. */
  statusChangedAt?: string;
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

/* ------------------------------------------------------------------ */
/* The metrics page's window (7, 30, 90 days or 12 months).            */
/* ------------------------------------------------------------------ */

export type ActivityPoint = {
  /** First day of the bucket, YYYY-MM-DD in the org's zone. */
  day: string;
  label: string;
  enteredValue: number;
  enteredCount: number;
  invoicedValue: number;
  invoicedCount: number;
};

export type PeriodMetrics = {
  days: number;
  from: string;
  to: string;
  /** Daily buckets up to 31 days, weekly beyond. */
  bucket: "day" | "week";
  activity: ActivityPoint[];
  entered: { count: number; value: number };
  /** Invoices recorded in the window; trend is the value against the window before, in %. */
  invoiced: { count: number; value: number; trend: number | null };
  averageDaysToInvoice: number | null;
  daysToInvoiceByUser: { user: string; invoices: number; averageDays: number }[];
  variance: { invoices: number; withVariance: number; total: number; absoluteTotal: number };
  /** Pending longer than the aged setting (BRD §6.6), now: not a measure of the window. */
  aged: { count: number; value: number; afterDays: number };
};

const LABEL = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayLabel = (date: string) => LABEL.format(new Date(`${date}T00:00:00Z`));

/** Monday of the week a date falls in. */
function weekStart(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
  return addDaysToDateString(date, 1 - weekday);
}

/**
 * The figures that measure a period: what entered the queue and what was
 * invoiced in the last `days` days (today included, Asia/Dubai), against
 * the same length of time before it. The aged count is current.
 */
export function computePeriodMetrics(input: {
  items: MetricItem[];
  invoices: MetricInvoice[];
  now: Date;
  days: number;
  agedAfterDays: number;
  timeZone?: string;
}): PeriodMetrics {
  const { items, invoices, now, days, agedAfterDays, timeZone } = input;
  const to = zonedDateString(now, timeZone);
  const from = addDaysToDateString(to, 1 - days);
  const previousFrom = addDaysToDateString(from, -days);
  const bucket: PeriodMetrics["bucket"] = days > 31 ? "week" : "day";
  const keyOf = (date: string) => (bucket === "week" ? weekStart(date) : date);
  const dateOf = (iso: string) => zonedDateString(iso, timeZone);
  const inWindow = (date: string) => date >= from && date <= to;

  const points = new Map<string, ActivityPoint>();
  for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
    const key = keyOf(date);
    if (!points.has(key)) {
      points.set(key, { day: key, label: dayLabel(key < from ? from : key), enteredValue: 0, enteredCount: 0, invoicedValue: 0, invoicedCount: 0 });
    }
  }

  let enteredCount = 0;
  let enteredValue = 0;
  for (const item of items) {
    const date = dateOf(item.enteredAt);
    if (!inWindow(date)) continue;
    enteredCount += 1;
    enteredValue += item.value;
    const point = points.get(keyOf(date))!;
    point.enteredCount += 1;
    point.enteredValue = round2(point.enteredValue + item.value);
  }

  const byId = new Map(items.map((i) => [i.id, i]));
  const current = invoices.filter((inv) => inWindow(dateOf(inv.recordedAt)));
  const previousValue = invoices
    .filter((inv) => {
      const date = dateOf(inv.recordedAt);
      return date >= previousFrom && date < from;
    })
    .reduce((sum, inv) => sum + inv.amount, 0);
  for (const inv of current) {
    const point = points.get(keyOf(dateOf(inv.recordedAt)))!;
    point.invoicedCount += 1;
    point.invoicedValue = round2(point.invoicedValue + inv.amount);
  }
  const invoicedValue = round2(current.reduce((sum, inv) => sum + inv.amount, 0));

  const spans = current
    .filter((inv) => byId.has(inv.queueItemId))
    .map((inv) => ({
      user: inv.recordedByLabel ?? "Unknown",
      days: (Date.parse(inv.recordedAt) - Date.parse(byId.get(inv.queueItemId)!.enteredAt)) / DAY_MS,
    }));
  const users = [...new Set(spans.map((s) => s.user))];
  const variances = current.map((inv) => round2(inv.amount - inv.queueValue));

  const aged = items.filter(
    (i) => i.status === "pending" && daysBetween(i.statusChangedAt ?? i.enteredAt, now) >= agedAfterDays,
  );

  return {
    days,
    from,
    to,
    bucket,
    activity: [...points.values()],
    entered: { count: enteredCount, value: round2(enteredValue) },
    invoiced: {
      count: current.length,
      value: invoicedValue,
      trend: previousValue > 0 ? Math.round(((invoicedValue - previousValue) / previousValue) * 100) : null,
    },
    averageDaysToInvoice: spans.length ? round1(spans.reduce((a, s) => a + s.days, 0) / spans.length) : null,
    daysToInvoiceByUser: users
      .map((user) => {
        const mine = spans.filter((s) => s.user === user);
        return { user, invoices: mine.length, averageDays: round1(mine.reduce((a, s) => a + s.days, 0) / mine.length) };
      })
      .sort((a, b) => b.invoices - a.invoices || a.user.localeCompare(b.user)),
    variance: {
      invoices: current.length,
      withVariance: variances.filter((v) => v !== 0).length,
      total: round2(variances.reduce((a, b) => a + b, 0)),
      absoluteTotal: round2(variances.reduce((a, b) => a + Math.abs(b), 0)),
    },
    aged: { count: aged.length, value: round2(aged.reduce((sum, i) => sum + i.value, 0)), afterDays: agedAfterDays },
  };
}
