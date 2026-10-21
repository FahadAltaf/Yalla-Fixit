import type { CapacityResult } from "./capacity";
import type { UnflaggedRow } from "./exceptions";
import type { QuotationRow } from "./quotations";

/**
 * The daily report alerts (BRD 6.2), worked out from the report rows and
 * the alerts still open. Pure: the runner sends and resolves.
 *
 *  N7  "{quotation} ({client}, AED {v}) in {status} for {d} days, over the
 *      {t}-day limit." To the ageing-alert recipients (Behrouz, managers).
 *      Once per quotation per stretch in a status; stops when the status
 *      changes.
 *  N8  "{quotation} expires in {d} days with no response." To the
 *      quotation's owner. Once per validity date; stops on expiry or an
 *      answer (the status moves on).
 *  N13 "{work order} for {client} completed {d} days ago, not marked Ready
 *      to be Invoiced." To the coordinator (the quotation's owner until
 *      D-18). Once per work order; stops when flagged or queued.
 *  N14 "{date}: {team} has {b} h booked against {a} h available." To the
 *      over-booking recipients (coordinators). Optional in the BRD. Once per
 *      team and day when the day first becomes over-booked; stops when it
 *      no longer is, or the day leaves the horizon.
 *
 * The dedupe key carries what makes an alert new, so a run every hour
 * sends nothing twice, and a key that no longer matches means the alert
 * is over.
 *
 * An alert is for crossing a limit, not for being past it: N7 and N13 go
 * out only when the limit was crossed within the last CROSSING_WINDOW_DAYS.
 * Without that, the first run would send one alert for every quotation
 * and work order that went past its limit before the portal existed
 * (hundreds, seen 21 Oct). That backlog is still in the reports,
 * highlighted; the plan counts it.
 */

export const CROSSING_WINDOW_DAYS = 7;

export const ALERT_EVENTS = {
  quotationAged: "reports.quotation_aged",
  quotationExpiring: "reports.quotation_expiring",
  workOrderUnflagged: "reports.work_order_unflagged",
  capacityOverbooked: "reports.capacity_overbooked",
} as const;

export type OpenAlert = { event: string; entityId: string; dedupeKey: string };

export type PlannedAlert = {
  event: string;
  entityType: "fsm_estimate" | "fsm_work_order" | "capacity_day";
  entityId: string;
  dedupeKey: string;
  title: string;
  body: string;
  link: string;
  /** "recipients" = a list in Reporting Settings; an email = the owner or coordinator. */
  to: { kind: "recipients"; list: "quotations" | "capacity" } | { kind: "person"; email: string | null; name: string | null };
};

const aed = (value: number) => `AED ${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const quote = (r: { number: string | null }) => (r.number ? `Quotation ${r.number}` : "A quotation");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function agedKey(r: QuotationRow) {
  return `quote-aged:${r.id}:${r.statusKey}:${r.statusSince ?? ""}`;
}
export function expiringKey(r: QuotationRow) {
  return `quote-expiry:${r.id}:${r.expiryDate ?? ""}`;
}
export function unflaggedKey(r: UnflaggedRow) {
  return `wo-unflagged:${r.workOrderId}`;
}
export function overbookedKey(r: { teamKey: string; date: string }) {
  return `capacity-over:${r.teamKey}:${r.date}`;
}

const hoursText = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10} h`;

export function planReportAlerts(input: {
  quotations: QuotationRow[];
  unflagged: UnflaggedRow[];
  open: OpenAlert[];
  crossingWindowDays?: number;
  /** For N13: the days after completion at which a work order is overdue. */
  unflaggedAfterDays?: number;
  /** N14: team days over-booked in the horizon. Left out = N14 not run. */
  overbooked?: CapacityResult["overbooked"];
}): { send: PlannedAlert[]; resolve: OpenAlert[]; backlog: { quotationsAged: number; workOrdersUnflagged: number } } {
  const window = input.crossingWindowDays ?? CROSSING_WINDOW_DAYS;
  const send: PlannedAlert[] = [];
  const current = new Set<string>();
  const backlog = { quotationsAged: 0, workOrdersUnflagged: 0 };

  for (const r of input.quotations) {
    /* Still past its limit: an alert already sent stays open. */
    if (r.breached) current.add(agedKey(r));
    if (r.breached && (r.daysInStatus ?? 0) - (r.ageingLimit ?? 0) > window) {
      backlog.quotationsAged += 1;
    } else if (r.breached) {
      const key = agedKey(r);
      send.push({
        event: ALERT_EVENTS.quotationAged,
        entityType: "fsm_estimate",
        entityId: r.id,
        dedupeKey: key,
        title: `${quote(r)} past its ${r.statusLabel} limit`,
        body: `${quote(r)} (${r.clientName ?? "no client"}, ${aed(r.value)}) in ${r.statusLabel} for ${plural(
          r.daysInStatus ?? 0,
          "day",
        )}, over the ${r.ageingLimit}-day limit.`,
        link: `/reports/quotations?status=${encodeURIComponent(r.statusKey)}&q=${encodeURIComponent(r.number ?? "")}`,
        to: { kind: "recipients", list: "quotations" },
      });
    }
    if (r.expiring) {
      const key = expiringKey(r);
      current.add(key);
      send.push({
        event: ALERT_EVENTS.quotationExpiring,
        entityType: "fsm_estimate",
        entityId: r.id,
        dedupeKey: key,
        title: `${quote(r)} expires ${r.daysToExpiry === 0 ? "today" : `in ${plural(r.daysToExpiry ?? 0, "day")}`}`,
        body: `${quote(r)} (${r.clientName ?? "no client"}) expires ${
          r.daysToExpiry === 0 ? "today" : `in ${plural(r.daysToExpiry ?? 0, "day")}`
        } with no response.`,
        link: `/reports/quotations?flag=expiring&q=${encodeURIComponent(r.number ?? "")}`,
        to: { kind: "person", email: r.ownerEmail, name: r.ownerName },
      });
    }
  }

  for (const r of input.unflagged) {
    if (!r.overdue) continue;
    const key = unflaggedKey(r);
    current.add(key);
    if ((r.daysSinceCompleted ?? 0) - (input.unflaggedAfterDays ?? 0) > window) {
      backlog.workOrdersUnflagged += 1;
      continue;
    }
    const wo = r.workOrderNumber ?? "A work order";
    send.push({
      event: ALERT_EVENTS.workOrderUnflagged,
      entityType: "fsm_work_order",
      entityId: r.workOrderId,
      dedupeKey: key,
      title: `${wo} not marked Ready to be Invoiced`,
      body: `${wo} for ${r.clientName ?? "the client"} completed ${plural(r.daysSinceCompleted ?? 0, "day")} ago, not marked Ready to be Invoiced.`,
      link: `/reports/exceptions?view=unflagged&q=${encodeURIComponent(r.workOrderNumber ?? "")}`,
      to: { kind: "person", email: r.coordinatorEmail, name: r.coordinatorName },
    });
  }

  for (const r of input.overbooked ?? []) {
    const key = overbookedKey(r);
    current.add(key);
    send.push({
      event: ALERT_EVENTS.capacityOverbooked,
      entityType: "capacity_day",
      entityId: `${r.teamKey}:${r.date}`,
      dedupeKey: key,
      title: `${r.teamName} over-booked on ${r.date}`,
      body: `${r.date}: ${r.teamName} has ${hoursText(r.bookedMinutes)} booked against ${hoursText(r.availableMinutes)} available.`,
      link: `/reports/capacity?team=${encodeURIComponent(r.teamKey)}&day=${r.date}`,
      to: { kind: "recipients", list: "capacity" },
    });
  }

  /* N14 alerts are only judged when capacity was worked out this run. */
  const resolve = input.open.filter(
    (o) => !current.has(o.dedupeKey) && (input.overbooked !== undefined || o.event !== ALERT_EVENTS.capacityOverbooked),
  );
  return { send, resolve, backlog };
}
