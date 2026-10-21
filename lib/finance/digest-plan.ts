/**
 * The daily Ready-to-Invoice digest (BRD §5.1 Step 6, §6.1 E1, §6.2 N1 N2;
 * DEV-439), decided here and sent by lib/server/finance/digest.ts.
 *
 *  - Once a day, at the configured time (Dubai). Before that time: nothing.
 *  - New items: entered since the last digest (or the last 24 hours, for
 *    the very first one).
 *  - Outstanding: everything still waiting on Finance, so a backlog shows.
 *  - Aged (N2): pending longer than the configured number of days.
 *  - Not sent when nothing is new and nothing is outstanding.
 */

const OPEN = new Set(["pending", "in_progress", "query_raised", "on_hold"]);
const DUBAI_OFFSET_MS = 4 * 60 * 60 * 1000;

export type DigestItem = {
  id: string;
  number: number;
  status: string;
  statusChangedAt: string;
  enteredAt: string;
  value: number;
  quotationNumber: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  completionPercent: number | null;
};

/** The Dubai calendar date (YYYY-MM-DD) and minutes past midnight of an instant. */
export function dubaiClock(now: Date): { date: string; minutes: number } {
  const local = new Date(now.getTime() + DUBAI_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** Whether the configured time (HH:MM, Dubai) has been reached today. */
export function digestDue(now: Date, digestTimeLocal: string): boolean {
  const [h, m] = digestTimeLocal.split(":").map(Number);
  return dubaiClock(now).minutes >= h * 60 + m;
}

export type DigestPlan =
  | { send: false; reason: string }
  | {
      send: true;
      date: string;
      newItems: DigestItem[];
      newValue: number;
      outstanding: { count: number; value: number };
      aged: (DigestItem & { daysPending: number })[];
    };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function planDigest(input: {
  items: DigestItem[];
  now: Date;
  lastDigestAt: string | null;
  agedAfterDays: number;
}): DigestPlan {
  const since = input.lastDigestAt ? Date.parse(input.lastDigestAt) : input.now.getTime() - 86_400_000;
  const newItems = input.items
    .filter((i) => Date.parse(i.enteredAt) > since && Date.parse(i.enteredAt) <= input.now.getTime())
    .sort((a, b) => a.number - b.number);
  const open = input.items.filter((i) => OPEN.has(i.status));
  if (newItems.length === 0 && open.length === 0) {
    return { send: false, reason: "nothing new and nothing outstanding" };
  }
  const aged = input.items
    .filter((i) => i.status === "pending")
    .map((i) => ({ ...i, daysPending: Math.floor((input.now.getTime() - Date.parse(i.statusChangedAt)) / 86_400_000) }))
    .filter((i) => i.daysPending > input.agedAfterDays)
    .sort((a, b) => b.daysPending - a.daysPending);
  return {
    send: true,
    date: dubaiClock(input.now).date,
    newItems,
    newValue: round2(newItems.reduce((s, i) => s + i.value, 0)),
    outstanding: { count: open.length, value: round2(open.reduce((s, i) => s + i.value, 0)) },
    aged,
  };
}

export const aed = (value: number) =>
  `AED ${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** E1's subject, as drafted in BRD §6.1. */
export function digestSubject(plan: Extract<DigestPlan, { send: true }>): string {
  return `Ready to invoice, ${plan.date}: ${plan.newItems.length} new, ${plan.outstanding.count} pending (${aed(plan.outstanding.value)})`;
}

/** N1's text, as drafted in BRD §6.2. */
export function digestInAppText(plan: Extract<DigestPlan, { send: true }>): string {
  return `${plan.newItems.length} new items ready to invoice, ${aed(plan.newValue)}. ${plan.outstanding.count} still pending.`;
}
