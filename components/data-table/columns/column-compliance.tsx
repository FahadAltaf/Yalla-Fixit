"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Gavel, MessageSquareWarning, Users } from "lucide-react";

import { FlagBadge } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Explained, helpHeader, type Help } from "@/components/data-table/columns/column-utilization";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { EVENT_KIND_LABELS, type ComplianceEventKind } from "@/lib/reports/compliance";
import { DISPUTE_STATUS_LABELS, dayName, type DisputeStatus } from "@/lib/reports/compliance-disputes";
import type {
  AttendanceRow,
  AttendanceSummaryRow,
  ComplianceDisputeRow,
  ComplianceEventRow,
  ComplianceRow,
} from "@/lib/server/reports/compliance";
import { durationLabel, useViewerZone, viewerDateTime, viewerTime, zoneLabel } from "@/lib/reports/viewer-time";

/**
 * Columns for the P7 reports (app compliance, daily attendance), built
 * like the P6 ones: identity first, numbers right-aligned.
 */

/** Compliance to one decimal, never rounded up to the threshold in words (TC13). */
export const compliancePct = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `${(Math.floor(value * 10) / 10).toFixed(1)}%`;
const aed = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : `AED ${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const hrs = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? "—" : `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("en-US")} h`;

function headerOf(label: string) {
  const Header = () => <div>{label}</div>;
  Header.displayName = `Header(${label})`;
  return Header;
}
const num = (children: React.ReactNode, strong = false) => (
  <div className={strong ? "text-sm font-medium tabular-nums" : "text-sm tabular-nums"}>{children}</div>
);
/* In the viewer's timezone; with its date when that is not the row's day (a check-out next morning). */
const time = (iso: string | null, day?: string) => viewerTime(iso, day);

/** A column heading naming the viewer's timezone, e.g. "Check-in · out (GMT+4)". */
function ZoneHeader({ label }: { label: string }) {
  const zone = useViewerZone();
  return (
    <div title={`Times in your timezone, ${zone.timeZone}`}>
      {label} <span className="text-muted-foreground font-normal">({zone.label})</span>
    </div>
  );
}
const zoneHeader = (label: string) => {
  const Header = () => <ZoneHeader label={label} />;
  Header.displayName = `ZoneHeader(${label})`;
  return Header;
};

// ---------------------------------------------------------------------
// Compliance: by technician
// ---------------------------------------------------------------------

export type ComplianceRules = { thresholdPercent: number | null; penaltyPerMissAed: number; monthlyCapAed: number };

/*
  Hover help (29 Oct), as on Utilization: a heading says what the column is
  and where it comes from; a value shows its own sum with the row's figures.
*/
const COMPLIANCE_HELP: Record<string, Help> = {
  required: {
    title: "Check-ins needed",
    lines: [
      "Every working day: check in and check out for the shift. Every appointment they are on: check in and check out.",
      "So a day with three appointments needs eight.",
      "Nothing is needed on rest days, public holidays, days on leave, after a leaving date, or for cancelled appointments. Waived ones are taken off.",
    ],
  },
  performed: {
    title: "Check-ins done",
    lines: ["Check-ins the technician actually made in the Zoho FSM app. Late ones still count."],
  },
  missed: { title: "Check-ins missed", lines: ["Needed but not made in the FSM app, and not waived."] },
  waived: {
    title: "Check-ins waived",
    lines: ["Missed check-ins a supervisor or coordinator excused with a reason (or an accepted dispute). They no longer count against the technician."],
  },
  compliance: { title: "Compliance", lines: ["Check-ins done ÷ check-ins needed, as a percentage."] },
  beforeCap: { title: "Penalty before the cap", lines: ["Only when compliance is below the threshold: each missed check-in × the penalty per miss."] },
  payable: { title: "Penalty payable", lines: ["The penalty, but never more than the monthly cap. HR decides whether to apply it; the portal deducts nothing."] },
  owed: {
    title: "Due so far (shift · appointment)",
    lines: ["How many check-ins have come due this month, before anything is waived: shift ones, then appointment ones."],
  },
};

/*
  Each kind of check-in in plain words (29 Oct: "human readable"): what the
  technician did, or did not do, and the sum that makes the figure.
*/
type Measure = "required" | "performed" | "missed" | "waived";
const KIND_WORDS: Array<{ kind: ComplianceEventKind; of: "day" | "appointment"; did: string; didNot: string; needed: string }> = [
  { kind: "shift_check_in", of: "day", did: "Checked in for the shift", didNot: "Did not check in for the shift", needed: "Shift check-ins" },
  { kind: "shift_check_out", of: "day", did: "Checked out of the shift", didNot: "Did not check out of the shift", needed: "Shift check-outs" },
  { kind: "appointment_check_in", of: "appointment", did: "Checked in to", didNot: "Did not check in to", needed: "Appointment check-ins" },
  { kind: "appointment_check_out", of: "appointment", did: "Checked out of", didNot: "Did not check out of", needed: "Appointment check-outs" },
];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The lines under a figure: one per kind of check-in, then the sum. */
function breakdownLines(r: ComplianceRow, measure: Measure): string[] {
  const b = r.breakdown;
  if (!b) return ["This month is finalised: only its totals were kept, not the split by kind."];
  const lines: string[] = [];
  const parts: number[] = [];
  for (const k of KIND_WORDS) {
    const c = b.kinds[k.kind];
    if (!c.owed) continue;
    const owedOf = k.of === "day" ? plural(c.owed, "working day", "working days") : plural(c.owed, "appointment", "appointments");
    const onDays = (n: number) => (k.of === "day" ? `on ${n} of ${owedOf}` : `${n} of ${owedOf}`);
    if (measure === "required") {
      const needed = c.performed + c.missed;
      parts.push(needed);
      lines.push(
        `${k.needed}: ${needed}, one for each ${k.of === "day" ? "working day" : "appointment"}${c.waived ? ` (${c.owed} less ${c.waived} waived)` : ""}`,
      );
    } else {
      const n = measure === "missed" ? c.missed : measure === "performed" ? c.performed : c.waived;
      if (!n) continue;
      parts.push(n);
      const verb = measure === "missed" ? k.didNot : measure === "performed" ? k.did : `Waived: ${k.needed.toLowerCase()}`;
      lines.push(measure === "waived" ? `${verb}, ${onDays(n)}` : `${verb} ${onDays(n)}`);
    }
  }
  if (!lines.length) return ["None this month."];
  const total = parts.reduce((a, n) => a + n, 0);
  const noun = measure === "required" ? "check-ins needed" : measure === "missed" ? "missed" : measure === "performed" ? "done" : "waived";
  lines.push(parts.length > 1 ? `Total: ${parts.join(" + ")} = ${total} ${noun}` : `Total: ${total} ${noun}`);
  return lines;
}

/** Where the check-ins are read from, said once under each figure. */
const SOURCE_LINE = "From the Zoho FSM app: Attendance for shifts; the technician's own time sheet, or else the job's actual start and end, for appointments.";

export function complianceColumns(rules: ComplianceRules): ColumnDef<ComplianceRow>[] {
  const threshold = rules.thresholdPercent;
  return [
    {
      id: "technician",
      header: "Technician",
      cell: ({ row }) => (
        <div className="min-w-44">
          <IdentityCell title={row.original.name} subtitle={row.original.teamName} icon={Users} />
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "required",
      header: helpHeader("Required", COMPLIANCE_HELP.required),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Explained
            help={{
              title: `${r.required} check-ins needed this month`,
              lines: [
                ...(r.breakdown
                  ? [`${plural(r.breakdown.days, "working day", "working days")} and ${plural(r.breakdown.appointments, "appointment", "appointments")} so far:`]
                  : []),
                ...breakdownLines(r, "required"),
                `Of these, ${r.performed} done and ${r.missed} missed.`,
              ],
            }}
          >
            {num(r.required)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "performed",
      header: helpHeader("Performed", COMPLIANCE_HELP.performed),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Explained
            help={{
              title: `${r.performed} of ${r.required} check-ins done`,
              lines: [...breakdownLines(r, "performed"), "A late check-in still counts as done.", SOURCE_LINE],
            }}
          >
            {num(r.performed)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "missed",
      header: helpHeader("Missed", COMPLIANCE_HELP.missed),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Explained
            help={{
              title: `${r.missed} of ${r.required} check-ins missed`,
              lines: [
                ...breakdownLines(r, "missed"),
                `Same as ${r.required} needed − ${r.performed} done = ${r.missed}.`,
                SOURCE_LINE,
                r.missed ? "Click the row to see each one, with its date and time." : "",
              ].filter(Boolean),
            }}
          >
            {num(r.missed > 0 ? <FlagBadge tone="danger">{r.missed}</FlagBadge> : 0)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "waived",
      header: helpHeader("Waived", COMPLIANCE_HELP.waived),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.waived) return num("—");
        return (
          <Explained
            help={{
              title: `${r.waived} check-ins waived`,
              lines: [...breakdownLines(r, "waived"), "A waived check-in is not counted as needed or missed. Click the row to see the reasons."],
            }}
          >
            {num(r.waived)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "compliance",
      header: helpHeader("Compliance", COMPLIANCE_HELP.compliance),
      cell: ({ row }) => {
        const r = row.original;
        if (r.compliancePercent === null) return num("—");
        return (
          <Explained
            help={{
              title: `Compliance ${compliancePct(r.compliancePercent)}`,
              lines: [
                `${r.performed} done ÷ ${r.required} needed × 100 = ${compliancePct(r.compliancePercent)}`,
                threshold === null
                  ? "No threshold is set, so no penalty is worked out."
                  : r.belowThreshold
                    ? `That is below the ${threshold}% threshold, so a penalty applies.`
                    : `That is at or above the ${threshold}% threshold, so there is no penalty.`,
              ],
            }}
          >
            {num(r.belowThreshold ? <FlagBadge tone="danger">{compliancePct(r.compliancePercent)} · below</FlagBadge> : compliancePct(r.compliancePercent), true)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "beforeCap",
      header: helpHeader("Penalty before cap", COMPLIANCE_HELP.beforeCap),
      cell: ({ row }) => {
        const r = row.original;
        if (r.penaltyBeforeCapAed === null) return num("—");
        return (
          <Explained
            help={{
              title: `${aed(r.penaltyBeforeCapAed)} before the cap`,
              lines: [
                r.belowThreshold
                  ? `${r.missed} missed check-ins × ${aed(rules.penaltyPerMissAed)} each = ${aed(r.penaltyBeforeCapAed)}`
                  : `Compliance ${compliancePct(r.compliancePercent)} is at or above ${threshold}%, so there is no penalty.`,
              ],
            }}
          >
            {num(aed(r.penaltyBeforeCapAed))}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "payable",
      header: helpHeader("Payable", COMPLIANCE_HELP.payable),
      cell: ({ row }) => {
        const r = row.original;
        if (r.penaltyPayableAed === null) return num("—");
        return (
          <Explained
            help={{
              title: `${aed(r.penaltyPayableAed)} payable`,
              lines: [
                !r.belowThreshold
                  ? "No penalty: compliance is at or above the threshold."
                  : (r.penaltyBeforeCapAed ?? 0) > rules.monthlyCapAed
                  ? `${aed(r.penaltyBeforeCapAed)} is more than the ${aed(rules.monthlyCapAed)} monthly cap, so ${aed(r.penaltyPayableAed)}.`
                  : `${aed(r.penaltyBeforeCapAed)} is within the ${aed(rules.monthlyCapAed)} monthly cap, so all of it.`,
                "HR decides whether to apply it; the portal deducts nothing.",
              ],
            }}
          >
            {num(aed(r.penaltyPayableAed), true)}
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "owed",
      header: helpHeader("Owed (shift · appointment)", COMPLIANCE_HELP.owed),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <Explained
            help={{
              title: `${r.owedShift + r.owedAppointment} check-ins due so far`,
              lines: [
                `Shift: ${r.owedShift} (checking in and out of their shifts)`,
                `Appointments: ${r.owedAppointment} (checking in and out of their appointments)`,
                `Total: ${r.owedShift} + ${r.owedAppointment} = ${r.owedShift + r.owedAppointment}, before anything is waived.`,
              ],
            }}
          >
            <div className="text-muted-foreground text-sm tabular-nums">
              {r.owedShift} · {r.owedAppointment}
            </div>
          </Explained>
        );
      },
      enableSorting: false,
    },
  ];
}

/* BRD B4's HR report: required, performed, missed, waived, compliance %, penalty before cap and payable after it. */
export const COMPLIANCE_EXPORT_COLUMNS = [
  { key: "technician", label: "Technician" },
  { key: "team", label: "Team" },
  { key: "required", label: "Required" },
  { key: "performed", label: "Performed" },
  { key: "missed", label: "Missed" },
  { key: "waived", label: "Waived" },
  { key: "compliance", label: "Compliance %" },
  { key: "below", label: "Below threshold" },
  { key: "beforeCap", label: "Penalty before cap (AED)" },
  { key: "payable", label: "Payable after cap (AED)" },
];

export function complianceExportRow(r: ComplianceRow) {
  return {
    technician: r.name,
    team: r.teamName,
    required: r.required,
    performed: r.performed,
    missed: r.missed,
    waived: r.waived,
    compliance: r.compliancePercent === null ? null : Math.round(r.compliancePercent * 1000) / 1000,
    below: r.belowThreshold === null ? "" : r.belowThreshold ? "Yes" : "No",
    beforeCap: r.penaltyBeforeCapAed,
    payable: r.penaltyPayableAed,
  };
}

// ---------------------------------------------------------------------
// Compliance: the check-ins underneath
// ---------------------------------------------------------------------

const STATE_LABELS = { performed: "Performed", missed: "Missed", waived: "Waived" } as const;
const STATE_TONE = { performed: "muted", missed: "danger", waived: "warning" } as const;

const EVENT_HELP: Record<string, Help> = {
  event: {
    title: "What was needed",
    lines: [
      "Each row is one thing the technician had to do in the Zoho FSM app.",
      "Every working day: check in for the shift, and check out of it.",
      "Every appointment they are on: check in to it, and check out of it.",
    ],
  },
  due: {
    title: "Due",
    lines: [
      "Shift: the shift start or end set in Scheduling (Settings: day and night shift times).",
      "Appointment: its scheduled start or end in FSM. In your timezone.",
    ],
  },
  outcome: { title: "Outcome", lines: ["Performed: recorded in FSM, late or not. Missed: nothing recorded and not waived. Waived: removed with a reason."] },
  recorded: {
    title: "Recorded",
    lines: [
      "Shift: FSM Attendance's first check-in or last check-out of that shift day.",
      "Appointment: their own FSM time sheet on it, else the appointment's actual start or end.",
    ],
  },
  waiver: { title: "Waiver", lines: ["The reason and who waived it: a supervisor or coordinator, an outage for everyone, or an accepted dispute."] },
  dispute: { title: "Dispute", lines: ["Raised by the technician, or for them, until the cut-off day; decided by the named reviewers."] },
};

/* "Check out of appointment AP-4336", "Check in for the shift": what the row asked of them, in words. */
const neededLabel = (r: Pick<ComplianceEventRow, "kind" | "appointmentNumber">) =>
  ({
    shift_check_in: "Check in for the shift",
    shift_check_out: "Check out of the shift",
    appointment_check_in: `Check in to ${r.appointmentNumber ?? "the appointment"}`,
    appointment_check_out: `Check out of ${r.appointmentNumber ?? "the appointment"}`,
  })[r.kind];
const neededDetail = (r: Pick<ComplianceEventRow, "kind" | "date">) =>
  r.kind.startsWith("shift")
    ? `Shift on ${dayName(r.date)}: at the shift ${r.kind === "shift_check_in" ? "start" : "end"}`
    : `Appointment on ${dayName(r.date)}: at its scheduled ${r.kind === "appointment_check_in" ? "start" : "end"}`;

const lateBy = (row: ComplianceEventRow) =>
  row.recordedAt && row.dueAt ? Math.round((Date.parse(row.recordedAt) - Date.parse(row.dueAt)) / 60_000) : null;

/** The event columns, with a selection column for waiving when the person may waive. */
const DISPUTE_TONE: Record<DisputeStatus, "warning" | "muted" | "danger"> = { open: "warning", accepted: "muted", rejected: "danger" };

export function DisputeBadge({ status }: { status: DisputeStatus }) {
  return <FlagBadge tone={DISPUTE_TONE[status]}>{DISPUTE_STATUS_LABELS[status]}</FlagBadge>;
}

export function complianceEventColumns(
  selection?: {
    selected: Set<string>;
    toggle: (key: string) => void;
  },
  /* A supervisor or coordinator raising a dispute for the technician (DEV-449). */
  onDispute?: (row: ComplianceEventRow) => void,
): ColumnDef<ComplianceEventRow>[] {
  const columns: ColumnDef<ComplianceEventRow>[] = [
    {
      id: "technician",
      header: "Technician",
      cell: ({ row }) => <IdentityCell title={row.original.technicianName} subtitle={null} icon={Users} />,
      enableSorting: false,
    },
    {
      id: "event",
      header: helpHeader("What was needed", EVENT_HELP.event),
      cell: ({ row }) => (
        <div className="min-w-44">
          <p className="text-sm font-medium">{neededLabel(row.original)}</p>
          <p className="text-muted-foreground text-xs">{neededDetail(row.original)}</p>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "due",
      header: helpHeader("Due", EVENT_HELP.due),
      cell: ({ row }) => {
        const r = row.original;
        const what = r.appointmentId
          ? `${r.kind === "appointment_check_in" ? "Scheduled start" : "Scheduled end"} of ${r.appointmentNumber ?? "the appointment"} in FSM.`
          : `${r.kind === "shift_check_in" ? "Shift start" : "Shift end"} for the shift day ${r.date}, as set in Scheduling.`;
        return (
          <Explained help={{ title: r.dueAt ? `Due ${viewerDateTime(r.dueAt)}` : `Due on ${r.date}`, lines: [what] }}>
            <IconText icon={CalendarDays} muted>
              {r.dueAt ? viewerDateTime(r.dueAt) : r.date}
            </IconText>
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "state",
      header: helpHeader("Outcome", EVENT_HELP.outcome),
      cell: ({ row }) => {
        const r = row.original;
        const late = lateBy(r);
        const lines =
          r.state === "performed"
            ? [
                `Recorded ${viewerDateTime(r.recordedAt)}${late !== null ? (late > 0 ? `, ${late} min after it was due` : late < 0 ? `, ${-late} min before it was due` : ", on time") : ""}.`,
                "A late check-in still counts as performed.",
              ]
            : r.state === "waived"
              ? [`Waived: ${r.waiverReason ?? "—"}, by ${r.waivedBy ?? "—"}${r.waivedAt ? `, ${viewerDateTime(r.waivedAt)}` : ""}.`, "Left out of required and performed."]
              : [
                  r.appointmentId
                    ? "No time sheet of theirs and no actual time on the appointment in FSM."
                    : "No FSM Attendance check-in or check-out on this shift day.",
                  "Counts in required, not in performed, until waived or a dispute is accepted.",
                ];
        return (
          <Explained help={{ title: STATE_LABELS[r.state], lines }}>
            <FlagBadge tone={STATE_TONE[r.state]}>{STATE_LABELS[r.state]}</FlagBadge>
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "recorded",
      header: helpHeader("Recorded", EVENT_HELP.recorded),
      cell: ({ row }) => {
        const r = row.original;
        if (!r.recordedAt) return <span className="text-muted-foreground text-sm">—</span>;
        return (
          <Explained
            help={{
              title: `Recorded ${viewerDateTime(r.recordedAt)}`,
              lines: [
                r.appointmentId
                  ? "From their own FSM time sheet on the appointment, else the appointment's actual times."
                  : `From FSM Attendance: the ${r.kind === "shift_check_in" ? "first check-in" : "last check-out"} of shift day ${r.date}.`,
              ],
            }}
          >
            <span className="text-sm tabular-nums">{viewerDateTime(r.recordedAt)}</span>
          </Explained>
        );
      },
      enableSorting: false,
    },
    {
      id: "waiver",
      header: helpHeader("Waiver", EVENT_HELP.waiver),
      cell: ({ row }) =>
        row.original.waiverReason ? (
          <div className="min-w-36">
            <p className="text-sm">{row.original.waiverReason}</p>
            <p className="text-muted-foreground text-xs">{row.original.waivedBy}</p>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
      enableSorting: false,
    },
    {
      id: "dispute",
      header: helpHeader("Dispute", EVENT_HELP.dispute),
      cell: ({ row }) =>
        row.original.dispute ? (
          <DisputeBadge status={row.original.dispute.status} />
        ) : onDispute && row.original.state === "missed" ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              onDispute(row.original);
            }}
          >
            <MessageSquareWarning className="size-3.5" />
            Raise
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">—</span>
        ),
      enableSorting: false,
    },
  ];
  if (!selection) return columns;
  return [
    {
      id: "select",
      header: () => null,
      cell: ({ row }) =>
        row.original.state === "missed" ? (
          <div onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selection.selected.has(row.original.key)}
              onCheckedChange={() => selection.toggle(row.original.key)}
              aria-label={`Select the ${EVENT_KIND_LABELS[row.original.kind].toLowerCase()} for ${row.original.technicianName}`}
            />
          </div>
        ) : null,
      enableSorting: false,
    },
    ...columns,
  ];
}

// ---------------------------------------------------------------------
// Compliance: disputes (DEV-449)
// ---------------------------------------------------------------------

const DISPUTE_HELP: Record<string, Help> = {
  reason: {
    title: "Reason",
    lines: ["What the technician says happened, as they or a supervisor or coordinator raised it, with who raised it and when."],
  },
  status: {
    title: "Status",
    lines: [
      "To decide: waiting for a reviewer named in Settings → Reporting. Accepted: the miss is waived. Rejected: the miss stands.",
      "A month cannot be finalised while one is still to decide.",
    ],
  },
  decision: { title: "Decision", lines: ["Accepted with the waiver reason, or rejected with why; who decided and when. Decided once."] },
};

export function complianceDisputeColumns(onDecide?: (row: ComplianceDisputeRow) => void): ColumnDef<ComplianceDisputeRow>[] {
  return [
    {
      id: "technician",
      header: "Technician",
      cell: ({ row }) => <IdentityCell title={row.original.technicianName} subtitle={null} icon={Users} />,
      enableSorting: false,
    },
    {
      id: "event",
      header: "Missed",
      cell: ({ row }) => (
        <div className="min-w-44">
          <p className="text-sm font-medium">{neededLabel(row.original)}</p>
          <p className="text-muted-foreground text-xs">Due {row.original.dueAt ? viewerDateTime(row.original.dueAt) : row.original.date}</p>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "reason",
      header: helpHeader("Reason", DISPUTE_HELP.reason),
      cell: ({ row }) => (
        <div className="max-w-80 min-w-48">
          <p className="text-sm whitespace-pre-line">{row.original.reason}</p>
          <p className="text-muted-foreground text-xs">
            {row.original.onBehalf ? `Raised for them by ${row.original.raisedBy}` : `Raised by ${row.original.raisedBy}`}, {viewerDateTime(row.original.raisedAt)}
          </p>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "status",
      header: helpHeader("Status", DISPUTE_HELP.status),
      cell: ({ row }) => <DisputeBadge status={row.original.status} />,
      enableSorting: false,
    },
    {
      id: "decision",
      header: helpHeader("Decision", DISPUTE_HELP.decision),
      cell: ({ row }) => {
        const d = row.original.decision;
        if (d) {
          return (
            <div className="max-w-72 min-w-40">
              <p className="text-sm">{d.outcome === "accepted" ? `Waived: ${d.waiverReason}` : (d.note ?? "Rejected")}</p>
              {d.outcome === "accepted" && d.note ? <p className="text-sm">{d.note}</p> : null}
              <p className="text-muted-foreground text-xs">
                {d.decidedBy}, {viewerDateTime(d.decidedAt)}
              </p>
            </div>
          );
        }
        return onDecide ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={(e) => {
              e.stopPropagation();
              onDecide(row.original);
            }}
          >
            <Gavel className="size-3.5" />
            Decide
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">Waiting for a reviewer</span>
        );
      },
      enableSorting: false,
    },
  ];
}

// ---------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------

const DAY_LABELS: Record<AttendanceRow["status"], string> = {
  working: "Working",
  leave: "Leave",
  holiday: "Public holiday",
  rest_day: "Rest day",
  left: "After leaving",
};

export const ATTENDANCE_DAY_COLUMNS: ColumnDef<AttendanceRow>[] = [
  {
    id: "technician",
    header: "Technician",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell title={row.original.name} subtitle={row.original.teamName} icon={Users} />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "date",
    /* The shift day, in Dubai: a night shift's morning check-out stays on the evening it started (as FSM's Date field). */
    header: () => <div title="The shift day (Dubai), as the Date field in Zoho FSM">Shift day</div>,
    cell: ({ row }) => <IconText icon={CalendarDays}>{row.original.date}</IconText>,
    enableSorting: false,
  },
  {
    id: "day",
    header: "Day",
    cell: ({ row }) => {
      const r = row.original;
      const label = r.status === "leave" ? `Leave${r.leaveCategory ? ` · ${r.leaveCategory}` : ""}` : DAY_LABELS[r.status];
      return r.status === "working" ? (
        <span className="text-sm">
          {label}
          {r.partLeave ? <span className="text-muted-foreground"> · part leave{r.leaveCategory ? ` (${r.leaveCategory})` : ""}</span> : null}
        </span>
      ) : (
        <FlagBadge tone="muted">{label}</FlagBadge>
      );
    },
    enableSorting: false,
  },
  {
    id: "shift",
    header: zoneHeader("Shift"),
    cell: ({ row }) => {
      const r = row.original;
      if (r.status !== "working") return <span className="text-sm">—</span>;
      return (
        <div className="min-w-28">
          <p className="text-sm tabular-nums">
            {time(r.shiftStart, r.date)} – {time(r.shiftEnd, r.date)}
          </p>
          {r.widenedForJobs ? (
            <p
              className="text-muted-foreground text-xs"
              title={`Shift ${time(r.windowStart, r.date)} – ${time(r.windowEnd, r.date)}, widened to the day's scheduled jobs (as on the Scheduling board)`}
            >
              widened for jobs
            </p>
          ) : null}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "checks",
    header: zoneHeader("Check-in · out"),
    cell: ({ row }) =>
      row.original.measured ? (
        <div className="min-w-32">
          <p className="text-sm tabular-nums">
            {time(row.original.checkIn, row.original.date)} · {time(row.original.checkOut, row.original.date)}
          </p>
          {/* BRD B5: hours present. A check-out the next day shows here as a long day, not as minutes. */}
          {row.original.checkIn ? (
            <p className="text-muted-foreground text-xs">
              {row.original.checkOut ? `${durationLabel(row.original.presentMinutes ?? 0)} present` : "no check-out"}
            </p>
          ) : null}
        </div>
      ) : (
        <span className="text-muted-foreground text-sm" title="FSM's shift check-ins cannot be read yet">
          Not available
        </span>
      ),
    enableSorting: false,
  },
  {
    id: "flags",
    header: "Flags",
    cell: ({ row }) => {
      const r = row.original;
      if (!r.measured) return <span className="text-muted-foreground text-sm">—</span>;
      const flags = [
        r.absent ? (
          <FlagBadge key="a" tone="danger">
            Absent{r.restDayMissing ? " · rest day not set" : ""}
          </FlagBadge>
        ) : null,
        r.workedWithoutCheckIn ? <FlagBadge key="w">Worked, no check-in</FlagBadge> : null,
        r.late ? <FlagBadge key="l">Late {r.lateMinutes} min</FlagBadge> : null,
        r.early ? <FlagBadge key="e">Left early</FlagBadge> : null,
        r.outsideShift ? <FlagBadge key="o">Outside shift</FlagBadge> : null,
        r.noCheckOut ? (
          <FlagBadge key="n" tone="muted">
            No check-out
          </FlagBadge>
        ) : null,
      ].filter(Boolean);
      return flags.length ? <div className="flex flex-wrap gap-1">{flags}</div> : <span className="text-muted-foreground text-sm">—</span>;
    },
    enableSorting: false,
  },
  {
    id: "jobs",
    header: zoneHeader("Work in FSM"),
    cell: ({ row }) =>
      row.original.jobs ? (
        <div className="min-w-32">
          <p className="text-sm tabular-nums">
            {time(row.original.firstJobAt, row.original.date)} – {row.original.jobOpen ? "not finished" : time(row.original.lastJobAt, row.original.date)}
          </p>
          <p className="text-muted-foreground text-xs">
            {row.original.ownJobs === row.original.jobs
              ? `${row.original.jobs} ${row.original.jobs === 1 ? "appointment" : "appointments"}`
              : row.original.ownJobs
                ? `${row.original.jobs} appointments, ${row.original.ownJobs} started by them`
                : `On ${row.original.jobs === 1 ? "a crew" : `${row.original.jobs} crews`}, started by someone else`}
          </p>
        </div>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    enableSorting: false,
  },
];

export const ATTENDANCE_DAY_EXPORT_COLUMNS = [
  { key: "technician", label: "Technician" },
  { key: "team", label: "Team" },
  { key: "date", label: "Date" },
  { key: "day", label: "Day" },
  { key: "leave", label: "Leave type" },
  { key: "shiftStart", label: "Shift start" },
  { key: "shiftEnd", label: "Shift end" },
  { key: "checkIn", label: "Check-in" },
  { key: "checkOut", label: "Check-out" },
  { key: "present", label: "Hours present" },
  { key: "late", label: "Late" },
  { key: "early", label: "Left early" },
  { key: "outside", label: "Outside shift" },
  { key: "absent", label: "Absent" },
  { key: "workedNoCheckIn", label: "Worked, no check-in" },
  { key: "noCheckOut", label: "No check-out" },
  { key: "restDayMissing", label: "Rest day not set" },
  { key: "firstJob", label: "First job start (FSM)" },
  { key: "lastJob", label: "Last job end (FSM)" },
  { key: "jobs", label: "Appointments" },
  { key: "timeZone", label: "Times in" },
];

export function attendanceDayExportRow(r: AttendanceRow) {
  const at = (iso: string | null) => (iso ? viewerDateTime(iso) : null);
  return {
    technician: r.name,
    team: r.teamName,
    date: r.date,
    day: DAY_LABELS[r.status],
    leave: r.leaveCategory,
    shiftStart: at(r.shiftStart),
    shiftEnd: at(r.shiftEnd),
    checkIn: r.measured ? at(r.checkIn) : "Not available",
    checkOut: r.measured ? at(r.checkOut) : null,
    present: r.presentMinutes === null ? null : Math.round((r.presentMinutes / 60) * 100) / 100,
    late: r.measured ? (r.late ? `${r.lateMinutes} min` : "") : null,
    early: r.measured ? (r.early ? "Yes" : "") : null,
    outside: r.measured ? (r.outsideShift ? "Yes" : "") : null,
    absent: r.measured ? (r.absent ? "Yes" : "") : null,
    workedNoCheckIn: r.measured ? (r.workedWithoutCheckIn ? "Yes" : "") : null,
    noCheckOut: r.measured ? (r.noCheckOut ? "Yes" : "") : null,
    restDayMissing: r.restDayMissing ? "Yes" : "",
    firstJob: at(r.firstJobAt),
    lastJob: r.jobOpen ? "Not finished in FSM" : at(r.lastJobAt),
    jobs: r.jobs,
    timeZone: zoneLabel(),
  };
}

export const ATTENDANCE_SUMMARY_COLUMNS: ColumnDef<AttendanceSummaryRow>[] = [
  {
    id: "technician",
    header: "Technician",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell title={row.original.name} subtitle={row.original.teamName} icon={Users} />
      </div>
    ),
    enableSorting: false,
  },
  { id: "shiftDays", header: headerOf("Shift days"), cell: ({ row }) => num(row.original.shiftDays), enableSorting: false },
  { id: "jobDays", header: headerOf("Days with work"), cell: ({ row }) => num(row.original.jobDays), enableSorting: false },
  { id: "leaveDays", header: headerOf("Leave days"), cell: ({ row }) => num(row.original.leaveDays || "—"), enableSorting: false },
  { id: "present", header: headerOf("Present"), cell: ({ row }) => num(row.original.presentDays || "—"), enableSorting: false },
  { id: "late", header: headerOf("Late"), cell: ({ row }) => num(row.original.lateDays || "—"), enableSorting: false },
  { id: "early", header: headerOf("Left early"), cell: ({ row }) => num(row.original.earlyDays || "—"), enableSorting: false },
  { id: "outside", header: headerOf("Outside shift"), cell: ({ row }) => num(row.original.outsideShiftDays || "—"), enableSorting: false },
  { id: "absent", header: headerOf("Absent"), cell: ({ row }) => num(row.original.absentDays || "—"), enableSorting: false },
  {
    id: "workedNoCheckIn",
    header: headerOf("Worked, no check-in"),
    cell: ({ row }) => num(row.original.workedWithoutCheckInDays || "—"),
    enableSorting: false,
  },
  { id: "hours", header: headerOf("Hours present"), cell: ({ row }) => num(row.original.presentMinutes ? hrs(row.original.presentMinutes) : "—"), enableSorting: false },
];

export const ATTENDANCE_SUMMARY_EXPORT_COLUMNS = [
  { key: "technician", label: "Technician" },
  { key: "team", label: "Team" },
  { key: "shiftDays", label: "Shift days" },
  { key: "jobDays", label: "Days with work in FSM" },
  { key: "leaveDays", label: "Leave days" },
  { key: "presentDays", label: "Present days" },
  { key: "lateDays", label: "Late days" },
  { key: "earlyDays", label: "Left-early days" },
  { key: "outsideShiftDays", label: "Outside-shift days" },
  { key: "absentDays", label: "Absent days" },
  { key: "workedWithoutCheckInDays", label: "Worked, no check-in" },
  { key: "noCheckOutDays", label: "No check-out" },
  { key: "restDayMissing", label: "Rest day not set" },
  { key: "hours", label: "Hours present" },
];

export function attendanceSummaryExportRow(r: AttendanceSummaryRow) {
  return {
    technician: r.name,
    team: r.teamName,
    shiftDays: r.shiftDays,
    jobDays: r.jobDays,
    leaveDays: r.leaveDays,
    presentDays: r.presentDays,
    lateDays: r.lateDays,
    earlyDays: r.earlyDays,
    outsideShiftDays: r.outsideShiftDays,
    absentDays: r.absentDays,
    workedWithoutCheckInDays: r.workedWithoutCheckInDays,
    noCheckOutDays: r.noCheckOutDays,
    restDayMissing: r.restDayMissing ? "Yes" : "",
    hours: Math.round((r.presentMinutes / 60) * 100) / 100,
  };
}
