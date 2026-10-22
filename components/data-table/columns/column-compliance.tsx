"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Users } from "lucide-react";

import { FlagBadge } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Checkbox } from "@/components/ui/checkbox";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { EVENT_KIND_LABELS } from "@/lib/reports/compliance";
import type { AttendanceRow, AttendanceSummaryRow, ComplianceEventRow, ComplianceRow } from "@/lib/server/reports/compliance";
import { formatZonedDateTime, formatZonedTime } from "@/lib/scheduling/org-time";

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

function right(label: string) {
  const Header = () => <div className="text-right">{label}</div>;
  Header.displayName = `Header(${label})`;
  return Header;
}
const num = (children: React.ReactNode, strong = false) => (
  <div className={strong ? "text-right text-sm font-medium tabular-nums" : "text-right text-sm tabular-nums"}>{children}</div>
);
const time = (iso: string | null) => (iso ? formatZonedTime(iso) : "—");

// ---------------------------------------------------------------------
// Compliance: by technician
// ---------------------------------------------------------------------

export const COMPLIANCE_COLUMNS: ColumnDef<ComplianceRow>[] = [
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
  { id: "required", header: right("Required"), cell: ({ row }) => num(row.original.required), enableSorting: false },
  { id: "performed", header: right("Performed"), cell: ({ row }) => num(row.original.performed), enableSorting: false },
  {
    id: "missed",
    header: right("Missed"),
    cell: ({ row }) => num(row.original.missed > 0 ? <FlagBadge tone="danger">{row.original.missed}</FlagBadge> : 0),
    enableSorting: false,
  },
  { id: "waived", header: right("Waived"), cell: ({ row }) => num(row.original.waived || "—"), enableSorting: false },
  {
    id: "compliance",
    header: right("Compliance"),
    cell: ({ row }) => {
      const r = row.original;
      if (r.compliancePercent === null) return num("—");
      return num(
        r.belowThreshold ? <FlagBadge tone="danger">{compliancePct(r.compliancePercent)} · below</FlagBadge> : compliancePct(r.compliancePercent),
        true,
      );
    },
    enableSorting: false,
  },
  { id: "beforeCap", header: right("Penalty before cap"), cell: ({ row }) => num(aed(row.original.penaltyBeforeCapAed)), enableSorting: false },
  { id: "payable", header: right("Payable"), cell: ({ row }) => num(aed(row.original.penaltyPayableAed), true), enableSorting: false },
  {
    id: "owed",
    header: right("Owed (shift · appointment)"),
    cell: ({ row }) => (
      <div className="text-muted-foreground text-right text-sm tabular-nums">
        {row.original.owedShift} · {row.original.owedAppointment}
      </div>
    ),
    enableSorting: false,
  },
];

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

/** The event columns, with a selection column for waiving when the person may waive. */
export function complianceEventColumns(selection?: {
  selected: Set<string>;
  toggle: (key: string) => void;
}): ColumnDef<ComplianceEventRow>[] {
  const columns: ColumnDef<ComplianceEventRow>[] = [
    {
      id: "technician",
      header: "Technician",
      cell: ({ row }) => <IdentityCell title={row.original.technicianName} subtitle={null} icon={Users} />,
      enableSorting: false,
    },
    {
      id: "event",
      header: "Check-in",
      cell: ({ row }) => (
        <div className="min-w-40">
          <p className="text-sm font-medium">{EVENT_KIND_LABELS[row.original.kind]}</p>
          <p className="text-muted-foreground text-xs">{row.original.appointmentNumber ?? (row.original.appointmentId ? "Appointment" : "Shift")}</p>
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "due",
      header: "Due",
      cell: ({ row }) => (
        <IconText icon={CalendarDays} muted>
          {row.original.dueAt ? formatZonedDateTime(row.original.dueAt) : row.original.date}
        </IconText>
      ),
      enableSorting: false,
    },
    {
      id: "state",
      header: "Outcome",
      cell: ({ row }) => <FlagBadge tone={STATE_TONE[row.original.state]}>{STATE_LABELS[row.original.state]}</FlagBadge>,
      enableSorting: false,
    },
    {
      id: "recorded",
      header: "Recorded",
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.recordedAt ? formatZonedDateTime(row.original.recordedAt) : "—"}</span>,
      enableSorting: false,
    },
    {
      id: "waiver",
      header: "Waiver",
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
    header: "Date",
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
    header: "Shift",
    cell: ({ row }) => (
      <span className="text-sm tabular-nums">
        {row.original.status === "working" ? `${time(row.original.shiftStart)} – ${time(row.original.shiftEnd)}` : "—"}
      </span>
    ),
    enableSorting: false,
  },
  {
    id: "checks",
    header: "Check-in · out",
    cell: ({ row }) =>
      row.original.measured ? (
        <span className="text-sm tabular-nums">
          {time(row.original.checkIn)} · {time(row.original.checkOut)}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm" title="FSM's shift check-ins cannot be read yet (B-01)">
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
        r.absent ? <FlagBadge key="a" tone="danger">Absent</FlagBadge> : null,
        r.late ? <FlagBadge key="l">Late {r.lateMinutes} min</FlagBadge> : null,
        r.early ? <FlagBadge key="e">Left early</FlagBadge> : null,
      ].filter(Boolean);
      return flags.length ? <div className="flex flex-wrap gap-1">{flags}</div> : <span className="text-muted-foreground text-sm">—</span>;
    },
    enableSorting: false,
  },
  {
    id: "jobs",
    header: "Work in FSM",
    cell: ({ row }) =>
      row.original.jobs ? (
        <div className="min-w-32">
          <p className="text-sm tabular-nums">
            {time(row.original.firstJobAt)} – {time(row.original.lastJobAt)}
          </p>
          <p className="text-muted-foreground text-xs">
            {row.original.jobs} {row.original.jobs === 1 ? "appointment" : "appointments"}
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
  { key: "absent", label: "Absent" },
  { key: "firstJob", label: "First job start (FSM)" },
  { key: "lastJob", label: "Last job end (FSM)" },
  { key: "jobs", label: "Appointments" },
];

export function attendanceDayExportRow(r: AttendanceRow) {
  const at = (iso: string | null) => (iso ? formatZonedDateTime(iso) : null);
  return {
    technician: r.name,
    team: r.teamName,
    date: r.date,
    day: DAY_LABELS[r.status],
    leave: r.leaveCategory,
    shiftStart: at(r.shiftStart),
    shiftEnd: at(r.shiftEnd),
    checkIn: r.measured ? at(r.checkIn) : "Not available (B-01)",
    checkOut: r.measured ? at(r.checkOut) : null,
    present: r.presentMinutes === null ? null : Math.round((r.presentMinutes / 60) * 100) / 100,
    late: r.measured ? (r.late ? `${r.lateMinutes} min` : "") : null,
    early: r.measured ? (r.early ? "Yes" : "") : null,
    absent: r.measured ? (r.absent ? "Yes" : "") : null,
    firstJob: at(r.firstJobAt),
    lastJob: at(r.lastJobAt),
    jobs: r.jobs,
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
  { id: "shiftDays", header: right("Shift days"), cell: ({ row }) => num(row.original.shiftDays), enableSorting: false },
  { id: "jobDays", header: right("Days with work"), cell: ({ row }) => num(row.original.jobDays), enableSorting: false },
  { id: "leaveDays", header: right("Leave days"), cell: ({ row }) => num(row.original.leaveDays || "—"), enableSorting: false },
  { id: "present", header: right("Present"), cell: ({ row }) => num(row.original.presentDays || "—"), enableSorting: false },
  { id: "late", header: right("Late"), cell: ({ row }) => num(row.original.lateDays || "—"), enableSorting: false },
  { id: "early", header: right("Left early"), cell: ({ row }) => num(row.original.earlyDays || "—"), enableSorting: false },
  { id: "absent", header: right("Absent"), cell: ({ row }) => num(row.original.absentDays || "—"), enableSorting: false },
  { id: "hours", header: right("Hours present"), cell: ({ row }) => num(row.original.presentMinutes ? hrs(row.original.presentMinutes) : "—"), enableSorting: false },
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
  { key: "absentDays", label: "Absent days" },
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
    absentDays: r.absentDays,
    hours: Math.round((r.presentMinutes / 60) * 100) / 100,
  };
}
