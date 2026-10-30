import { addDaysToDateString } from "@/lib/scheduling/org-time";

import { EVENT_KIND_LABELS, type ComplianceEventKind, type EventOutcome, type TechnicianCompliance } from "./compliance";

/**
 * Compliance disputes and the compliance messages (BRD 5.2 B4, §6.1, §6.2,
 * §6.8; DEV-449, 450). The flow, as the BRD draws it: miss recorded (N9),
 * statement at month close (E2, N11), disputes until the cut-off (N12),
 * final report to HR (E3).
 *
 *  - A technician disputes one missed check-in with a reason, up to the
 *    cut-off day (the 25th of the next month, that day included; TC14:
 *    the 26th is refused). Most technicians are not portal users, so a
 *    supervisor or coordinator may raise it for them.
 *  - A named reviewer (Settings → Reporting) accepts it, which waives the
 *    miss with a waiver reason, or rejects it, saying why.
 *  - N9 and N10 are worked out on settled days only (before today): a
 *    check-in may still arrive late today, and a late check-in counts.
 *
 * Pure: no database, no clock.
 */

export type DisputeDecision = {
  outcome: "accepted" | "rejected";
  waiverReason: string | null;
  note: string | null;
  decidedBy: string;
  decidedAt: string;
};

export type Dispute = {
  id: string;
  eventKey: string;
  technicianFsmId: string;
  kind: ComplianceEventKind;
  month: string;
  date: string;
  dueAt: string | null;
  appointmentNumber: string | null;
  reason: string;
  onBehalf: boolean;
  raisedBy: string;
  raisedAt: string;
  decision: DisputeDecision | null;
};

export type DisputeStatus = "open" | "accepted" | "rejected";

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  open: "To decide",
  accepted: "Accepted (waived)",
  rejected: "Rejected",
};

export const disputeStatus = (d: Pick<Dispute, "decision">): DisputeStatus => d.decision?.outcome ?? "open";

/** Why this check-in cannot be disputed now, or null when it can. */
export function disputeRefusal(input: {
  event: Pick<EventOutcome, "state"> | undefined;
  phase: { disputesAllowed: boolean; cutoffDate: string };
  finalized: boolean;
  alreadyDisputed: boolean;
}): string | null {
  if (input.finalized) return "This month is finalised; no change is possible.";
  if (!input.phase.disputesAllowed) return `Disputes for this month closed on ${input.phase.cutoffDate}.`;
  if (!input.event) return "This check-in is not one that was owed in the month.";
  if (input.event.state === "performed") return "This check-in was recorded; there is nothing to dispute.";
  if (input.event.state === "waived") return "This check-in is already waived.";
  if (input.alreadyDisputed) return "This check-in is already disputed.";
  return null;
}

// ---------------------------------------------------------------------
// Settled figures (N9, N10)
// ---------------------------------------------------------------------

/** Compliance over the days before today: what can no longer change by a late check-in. */
export function settledCompliance(events: EventOutcome[], today: string): { required: number; performed: number; missed: number; percent: number | null } {
  let performed = 0;
  let missed = 0;
  for (const e of events) {
    if (e.date >= today) continue;
    if (e.state === "performed") performed += 1;
    else if (e.state === "missed") missed += 1;
  }
  const required = performed + missed;
  return { required, performed, missed, percent: required ? (performed / required) * 100 : null };
}

// ---------------------------------------------------------------------
// The plan: who is told what, today
// ---------------------------------------------------------------------

export const COMPLIANCE_ALERT_EVENTS = {
  miss: "reports.compliance_missed",
  belowThreshold: "reports.compliance_below_threshold",
  statementReady: "reports.compliance_statement_ready",
  statement: "reports.compliance_statement",
  dispute: "reports.compliance_dispute",
  hrReport: "reports.compliance_hr_report",
} as const;

export type CompliancePerson = {
  fsmId: string;
  name: string;
  userId: string | null;
  email: string | null;
  /** The team leader's portal account, for N10. */
  teamLeaderUserId: string | null;
};

export type PlannedMessage = {
  event: string;
  dedupeKey: string;
  technicianFsmId: string | null;
  title: string;
  body: string;
  link: string;
};

export type ComplianceAlertPlan = {
  /** N9: to the technician. */
  misses: Array<PlannedMessage & { userId: string }>;
  /** N10: to the technician, their team leader and the supervisors. */
  belowThreshold: Array<PlannedMessage & { userIds: string[] }>;
  /** N11 (in-app) and E2 (email), for last month's statement. */
  statements: Array<{ person: CompliancePerson; compliance: TechnicianCompliance; n11: PlannedMessage; e2: PlannedMessage }>;
  /** N11 of a month whose disputes have closed: no longer shown. */
  resolveStatementsOf: string | null;
  /** Misses the technician could not be told of: no portal account. */
  unreachable: number;
};

/** "2026-10" → "October 2026". */
export function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "2026-10-28" → "28 Oct". */
export function dayName(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

const pct = (value: number | null) => (value === null ? "—" : `${Math.round(value * 10) / 10}%`);

export const eventLabel = (e: { kind: ComplianceEventKind; appointmentNumber: string | null }) =>
  e.appointmentNumber ? `${EVENT_KIND_LABELS[e.kind].toLowerCase()} of ${e.appointmentNumber}` : EVENT_KIND_LABELS[e.kind].toLowerCase();

/** N9 looks back this many settled days, so a first run does not send a month of misses at once. */
export const MISS_LOOKBACK_DAYS = 3;
/** A shift's check-out may come hours after midnight: a miss is told once its due time is this far past. */
const SETTLE_MS = 4 * 3_600_000;

export const MY_COMPLIANCE_PATH = "/my-compliance";

export function planComplianceAlerts(input: {
  today: string;
  now: string;
  thresholdPercent: number | null;
  people: Map<string, CompliancePerson>;
  /** This month, worked out to now. */
  current: { month: string; results: TechnicianCompliance[] };
  /** Last month, while its disputes are open (N11, E2); null otherwise. */
  previous: { month: string; cutoffDate: string; results: TechnicianCompliance[] } | null;
  /** The month whose disputes closed most recently, to stop showing its N11. */
  closedMonth: string | null;
  supervisorUserIds: string[];
}): ComplianceAlertPlan {
  const now = Date.parse(input.now);
  const earliest = addDaysToDateString(input.today, -MISS_LOOKBACK_DAYS);
  const plan: ComplianceAlertPlan = { misses: [], belowThreshold: [], statements: [], resolveStatementsOf: input.closedMonth, unreachable: 0 };

  for (const r of input.current.results) {
    const person = input.people.get(r.technicianFsmId);
    if (!person) continue;
    const settled = settledCompliance(r.events, input.today);

    /* N9: "You missed the {event} on {date}. Compliance this month: {c}%." */
    for (const e of r.events) {
      if (e.state !== "missed" || e.date >= input.today || e.date < earliest) continue;
      if (e.dueAt && Date.parse(e.dueAt) + SETTLE_MS > now) continue;
      if (!person.userId) {
        plan.unreachable += 1;
        continue;
      }
      plan.misses.push({
        event: COMPLIANCE_ALERT_EVENTS.miss,
        dedupeKey: `n9:${e.key}`,
        technicianFsmId: r.technicianFsmId,
        userId: person.userId,
        title: "Missed check-in",
        body: `You missed the ${eventLabel(e)} on ${dayName(e.date)}. Compliance this month: ${pct(settled.percent)}.`,
        link: `${MY_COMPLIANCE_PATH}?month=${input.current.month}`,
      });
    }

    /* N10: "{technician}'s compliance dropped to {c}%." Once a month, on first falling below. */
    if (input.thresholdPercent !== null && settled.required > 0 && settled.performed * 100 < input.thresholdPercent * settled.required) {
      const userIds = [...new Set([person.userId, person.teamLeaderUserId, ...input.supervisorUserIds].filter((v): v is string => Boolean(v)))];
      if (userIds.length) {
        plan.belowThreshold.push({
          event: COMPLIANCE_ALERT_EVENTS.belowThreshold,
          dedupeKey: `n10:${r.technicianFsmId}:${input.current.month}`,
          technicianFsmId: r.technicianFsmId,
          userIds,
          title: "Compliance below threshold",
          body: `${person.name}'s compliance dropped to ${pct(settled.percent)} (threshold ${input.thresholdPercent}%).`,
          link: `/reports/compliance?month=${input.current.month}&view=events&technician=${encodeURIComponent(r.technicianFsmId)}&state=all`,
        });
      }
    }
  }

  /* N11 and E2 at month close: one statement per technician who owed anything. */
  if (input.previous) {
    const { month, cutoffDate } = input.previous;
    for (const r of input.previous.results) {
      const person = input.people.get(r.technicianFsmId);
      if (!person || r.required + r.waived === 0) continue;
      const link = `${MY_COMPLIANCE_PATH}?month=${month}`;
      plan.statements.push({
        person,
        compliance: r,
        n11: {
          event: COMPLIANCE_ALERT_EVENTS.statementReady,
          dedupeKey: `n11:${r.technicianFsmId}:${month}`,
          technicianFsmId: r.technicianFsmId,
          title: "Compliance statement ready",
          body: `Your statement for ${monthName(month)} is ready. Disputes close on ${dayName(cutoffDate)}.`,
          link,
        },
        e2: {
          event: COMPLIANCE_ALERT_EVENTS.statement,
          dedupeKey: `e2:${r.technicianFsmId}:${month}`,
          technicianFsmId: r.technicianFsmId,
          title: `Your app compliance statement for ${monthName(month)}`,
          body: `${r.performed} of ${r.required} check-ins performed (${pct(r.compliancePercent)}), ${r.missed} missed, ${r.waived} waived. Disputes close on ${dayName(cutoffDate)}.`,
          link,
        },
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------
// The emails (BRD §6.1)
// ---------------------------------------------------------------------

const aed = (value: number | null) => (value === null ? "—" : `AED ${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const esc = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type EmailParts = {
  eyebrow: string;
  heading: string;
  greeting?: string;
  paragraphs: string[];
  details: Array<{ label: string; value: string }>;
  cta: { label: string; url: string };
  footnote?: string;
};

/**
 * E2: "Required, performed, missed, waived, compliance %, penalty before
 * and after cap. Each miss with date and event. How to dispute and the
 * deadline." The penalty shows only below the threshold.
 */
export function statementEmail(input: {
  month: string;
  cutoffDate: string;
  name: string;
  compliance: TechnicianCompliance;
  thresholdPercent: number | null;
  appUrl: string;
}): EmailParts {
  const r = input.compliance;
  const misses = r.events.filter((e) => e.state === "missed");
  const list = misses.length
    ? `<p><strong>Missed check-ins</strong></p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse">${misses
        .map(
          (e) =>
            `<tr><td style="padding:4px 8px;border-top:1px solid #eee;white-space:nowrap">${esc(dayName(e.date))}</td><td style="padding:4px 8px;border-top:1px solid #eee">${esc(eventLabel(e))}</td></tr>`,
        )
        .join("")}</table>`
    : "<p>No missed check-ins this month.</p>";
  const penalty =
    input.thresholdPercent === null
      ? []
      : r.belowThreshold
        ? [
            { label: "Penalty before cap", value: aed(r.penaltyBeforeCapAed) },
            { label: "Penalty after cap", value: aed(r.penaltyPayableAed) },
          ]
        : [{ label: "Penalty", value: `None (at or above ${input.thresholdPercent}%)` }];
  return {
    eyebrow: "App compliance",
    heading: `Your statement for ${monthName(input.month)}`,
    greeting: `Hello ${input.name},`,
    paragraphs: [
      `<p>Your check-ins in the Zoho FSM app for ${esc(monthName(input.month))}: every shift and every appointment needs a check-in and a check-out.</p>`,
      list,
      `<p><strong>To dispute a missed check-in</strong>, tell your supervisor or coordinator, or raise it in the portal, by <strong>${esc(dayName(input.cutoffDate))}</strong>. After that day no change is possible.</p>`,
    ],
    details: [
      { label: "Required", value: String(r.required) },
      { label: "Performed", value: String(r.performed) },
      { label: "Missed", value: String(r.missed) },
      { label: "Waived", value: String(r.waived) },
      { label: "Compliance", value: pct(r.compliancePercent) },
      ...penalty,
    ],
    cta: { label: "See my statement", url: `${input.appUrl}${MY_COMPLIANCE_PATH}?month=${input.month}` },
    footnote: "Penalties are worked out by the portal and decided by HR. Nothing is deducted by the portal.",
  };
}

export type StatementRow = {
  fsmId: string;
  name: string;
  teamName: string;
  required: number;
  performed: number;
  missed: number;
  waived: number;
  compliancePercent: number | null;
  belowThreshold: boolean | null;
  penaltyBeforeCapAed: number | null;
  penaltyPayableAed: number | null;
};

/** E3: "One row per technician with the same figures, team totals, link to detail." From the frozen statements. */
export function hrReportEmail(input: { month: string; rows: StatementRow[]; thresholdPercent: number | null; appUrl: string }): EmailParts {
  const cell = "padding:4px 6px;border-top:1px solid #eee";
  const num = `${cell};text-align:right`;
  const header = ["Technician", "Required", "Performed", "Missed", "Waived", "Compliance", "Penalty", "Payable"]
    .map((h, i) => `<th style="padding:4px 6px;text-align:${i ? "right" : "left"};color:#6b7280">${h}</th>`)
    .join("");
  const line = (r: Pick<StatementRow, "required" | "performed" | "missed" | "waived" | "compliancePercent" | "penaltyBeforeCapAed" | "penaltyPayableAed">, label: string, bold = false) =>
    `<tr${bold ? ' style="font-weight:600"' : ""}><td style="${cell}">${esc(label)}</td><td style="${num}">${r.required}</td><td style="${num}">${r.performed}</td><td style="${num}">${r.missed}</td><td style="${num}">${r.waived}</td><td style="${num}">${pct(r.compliancePercent)}</td><td style="${num}">${aed(r.penaltyBeforeCapAed)}</td><td style="${num}">${aed(r.penaltyPayableAed)}</td></tr>`;

  const teams = new Map<string, StatementRow[]>();
  for (const r of input.rows) teams.set(r.teamName, [...(teams.get(r.teamName) ?? []), r]);
  const total = (rows: StatementRow[]) => {
    const required = rows.reduce((a, r) => a + r.required, 0);
    const performed = rows.reduce((a, r) => a + r.performed, 0);
    const money = (pick: (r: StatementRow) => number | null) => (input.thresholdPercent === null ? null : rows.reduce((a, r) => a + (pick(r) ?? 0), 0));
    return {
      required,
      performed,
      missed: rows.reduce((a, r) => a + r.missed, 0),
      waived: rows.reduce((a, r) => a + r.waived, 0),
      compliancePercent: required ? (performed / required) * 100 : null,
      penaltyBeforeCapAed: money((r) => r.penaltyBeforeCapAed),
      penaltyPayableAed: money((r) => r.penaltyPayableAed),
    };
  };
  const body = [...teams]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([team, rows]) =>
        rows
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((r) => line(r, r.name))
          .join("") + line(total(rows), `${team}: total`, true),
    )
    .join("");
  const all = total(input.rows);
  return {
    eyebrow: "App compliance",
    heading: `App compliance report for ${monthName(input.month)}`,
    paragraphs: [
      `<p>The figures are final: disputes have closed and the month is finalised. The portal calculates; HR decides how penalties are applied.</p>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:12px;border-collapse:collapse"><tr>${header}</tr>${body}${line(all, "All technicians", true)}</table>`,
    ],
    details: [
      { label: "Technicians", value: String(input.rows.length) },
      { label: "Compliance", value: pct(all.compliancePercent) },
      { label: "Below threshold", value: input.thresholdPercent === null ? "—" : String(input.rows.filter((r) => r.belowThreshold).length) },
      { label: "Penalties payable", value: aed(all.penaltyPayableAed) },
    ],
    cta: { label: "Open the compliance report", url: `${input.appUrl}/reports/compliance?month=${input.month}` },
  };
}
