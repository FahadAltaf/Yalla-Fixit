"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Users, Wrench } from "lucide-react";

import { FlagBadge } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import type { CapacityRow } from "@/lib/reports/capacity";
import { CHARGEABILITY_LABELS, type AppointmentDetail, type TechnicianUtilization } from "@/lib/reports/utilization";
import type { CapacityBooking } from "@/lib/server/reports/planning";
import { formatZonedDateTime, formatZonedTime } from "@/lib/scheduling/org-time";

/**
 * Columns for the P6 reports (utilization, capacity), built like the P5
 * ones (column-reports.tsx): identity first, numbers right-aligned, order
 * fixed on the server.
 */

/** Hours to one decimal, from minutes. */
export const hrs = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? "—" : `${(Math.round((minutes / 60) * 10) / 10).toLocaleString("en-US")} h`;
export const pct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${value}%`);
const hoursNumber = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? null : Math.round((minutes / 60) * 100) / 100;

function right(label: string) {
  const Header = () => <div className="text-right">{label}</div>;
  Header.displayName = `Header(${label})`;
  return Header;
}
const num = (children: React.ReactNode, strong = false) => (
  <div className={strong ? "text-right text-sm font-medium tabular-nums" : "text-right text-sm tabular-nums"}>{children}</div>
);

// ---------------------------------------------------------------------
// Utilization: by technician
// ---------------------------------------------------------------------

export const TECHNICIAN_UTILIZATION_COLUMNS: ColumnDef<TechnicianUtilization>[] = [
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
  { id: "available", header: right("Available"), cell: ({ row }) => num(hrs(row.original.availableMinutes)), enableSorting: false },
  { id: "job", header: right("Job hours"), cell: ({ row }) => num(hrs(row.original.jobMinutes)), enableSorting: false },
  { id: "time", header: right("Time %"), cell: ({ row }) => num(pct(row.original.timePercent), true), enableSorting: false },
  { id: "chargeable", header: right("Chargeable"), cell: ({ row }) => num(hrs(row.original.chargeableMinutes)), enableSorting: false },
  { id: "commercial", header: right("Commercial %"), cell: ({ row }) => num(pct(row.original.commercialPercent), true), enableSorting: false },
  {
    id: "outside",
    header: right("Outside shift"),
    cell: ({ row }) => num(row.original.outsideShiftMinutes > 0 ? hrs(row.original.outsideShiftMinutes) : "—"),
    enableSorting: false,
  },
  {
    id: "travel",
    header: right("Travel"),
    cell: () => (
      <div className="text-muted-foreground text-right text-sm" title="Needs FSM trips, which the portal cannot read yet (B-01)">
        —
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "completeness",
    header: right("Data complete"),
    cell: ({ row }) => {
      const r = row.original;
      if (r.completenessPercent === null) return num("—");
      return (
        <div className="flex justify-end">
          {r.completenessPercent < 100 ? <FlagBadge>{pct(r.completenessPercent)}</FlagBadge> : <span className="text-sm tabular-nums">100%</span>}
        </div>
      );
    },
    enableSorting: false,
  },
  {
    id: "variance",
    header: right("Actual vs scheduled"),
    cell: ({ row }) => {
      const r = row.original;
      if (!r.scheduledMinutes) return num("—");
      const sign = r.varianceMinutes > 0 ? "+" : "";
      return num(`${sign}${hrs(r.varianceMinutes)}`);
    },
    enableSorting: false,
  },
];

export const TECHNICIAN_UTILIZATION_EXPORT_COLUMNS = [
  { key: "technician", label: "Technician" },
  { key: "team", label: "Team" },
  { key: "shiftDays", label: "Shift days" },
  { key: "leave", label: "Leave (h)" },
  { key: "available", label: "Available (h)" },
  { key: "job", label: "Job hours (h)" },
  { key: "time", label: "Time utilization %" },
  { key: "chargeable", label: "Chargeable (h)" },
  { key: "commercial", label: "Commercial utilization %" },
  { key: "outside", label: "Outside shift (h)" },
  { key: "appointments", label: "Appointments" },
  { key: "completed", label: "Completed" },
  { key: "withTimes", label: "With actual times" },
  { key: "completeness", label: "Data completeness %" },
  { key: "scheduled", label: "Scheduled (h)" },
  { key: "actual", label: "Actual (h)" },
  { key: "variance", label: "Actual − scheduled (h)" },
  { key: "shiftAssumed", label: "Shift assumed" },
];

export function technicianUtilizationExportRow(r: TechnicianUtilization) {
  return {
    technician: r.name,
    team: r.teamName,
    shiftDays: r.shiftDays,
    leave: hoursNumber(r.leaveMinutes),
    available: hoursNumber(r.availableMinutes),
    job: hoursNumber(r.jobMinutes),
    time: r.timePercent,
    chargeable: hoursNumber(r.chargeableMinutes),
    commercial: r.commercialPercent,
    outside: hoursNumber(r.outsideShiftMinutes),
    appointments: r.appointments,
    completed: r.completed,
    withTimes: r.withActualTimes,
    completeness: r.completenessPercent,
    scheduled: hoursNumber(r.scheduledMinutes),
    actual: hoursNumber(r.actualMinutes),
    variance: hoursNumber(r.varianceMinutes),
    shiftAssumed: r.shiftAssumed ? "Yes" : "",
  };
}

// ---------------------------------------------------------------------
// Utilization: the appointments underneath
// ---------------------------------------------------------------------

const CHARGEABILITY_TONE = { chargeable: "muted", zero_value: "warning", no_value: "muted" } as const;

export const UTILIZATION_APPOINTMENT_COLUMNS: ColumnDef<AppointmentDetail>[] = [
  {
    id: "appointment",
    header: "Appointment",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell
          title={row.original.number ?? "Appointment"}
          subtitle={[row.original.workOrderNumber, row.original.clientName].filter(Boolean).join(" · ") || null}
          icon={Wrench}
        />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "crew",
    header: "Technicians",
    cell: ({ row }) => {
      const names = row.original.technicianNames;
      if (!names.length) return <span className="text-muted-foreground text-sm">—</span>;
      return (
        <span className="text-sm" title={names.join(", ")}>
          {names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ")}
        </span>
      );
    },
    enableSorting: false,
  },
  {
    id: "actual",
    header: "Actual",
    cell: ({ row }) => {
      const r = row.original;
      if (r.missingActuals) return <FlagBadge tone="danger">No actual times</FlagBadge>;
      return (
        <IconText icon={CalendarDays}>
          {formatZonedDateTime(r.actualStart!)} – {formatZonedTime(r.actualEnd!)}
        </IconText>
      );
    },
    enableSorting: false,
  },
  { id: "hours", header: right("Hours"), cell: ({ row }) => num(hrs(row.original.actualMinutes), true), enableSorting: false },
  {
    id: "variance",
    header: right("vs scheduled"),
    cell: ({ row }) => {
      const v = row.original.varianceMinutes;
      if (v === null) return num("—");
      return num(`${v > 0 ? "+" : ""}${hrs(v)}`);
    },
    enableSorting: false,
  },
  {
    id: "chargeability",
    header: "Chargeable",
    cell: ({ row }) => (
      <FlagBadge tone={CHARGEABILITY_TONE[row.original.chargeability]}>{CHARGEABILITY_LABELS[row.original.chargeability]}</FlagBadge>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <span className="text-sm">{row.original.status ?? "—"}</span>,
    enableSorting: false,
  },
];

export const UTILIZATION_APPOINTMENT_EXPORT_COLUMNS = [
  { key: "appointment", label: "Appointment" },
  { key: "workOrder", label: "Work order" },
  { key: "client", label: "Client" },
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
  { key: "technicians", label: "Technicians" },
  { key: "date", label: "Date" },
  { key: "actualStart", label: "Actual start" },
  { key: "actualEnd", label: "Actual end" },
  { key: "actual", label: "Actual (h)" },
  { key: "scheduled", label: "Scheduled (h)" },
  { key: "variance", label: "Actual − scheduled (h)" },
  { key: "chargeable", label: "Chargeable" },
  { key: "counted", label: "In job hours" },
];

export function utilizationAppointmentExportRow(r: AppointmentDetail) {
  return {
    appointment: r.number,
    workOrder: r.workOrderNumber,
    client: r.clientName,
    status: r.status,
    type: r.type,
    technicians: r.technicianNames.join(", "),
    date: r.date,
    actualStart: r.actualStart,
    actualEnd: r.actualEnd,
    actual: hoursNumber(r.actualMinutes),
    scheduled: hoursNumber(r.scheduledMinutes),
    variance: hoursNumber(r.varianceMinutes),
    chargeable: CHARGEABILITY_LABELS[r.chargeability],
    counted: r.countsInJobHours ? "Yes" : "",
  };
}

// ---------------------------------------------------------------------
// Capacity: bookings
// ---------------------------------------------------------------------

export const BOOKING_COLUMNS: ColumnDef<CapacityBooking>[] = [
  {
    id: "appointment",
    header: "Appointment",
    cell: ({ row }) => (
      <div className="min-w-44">
        <IdentityCell
          title={row.original.number ?? "Appointment"}
          subtitle={[row.original.workOrderNumber, row.original.clientName].filter(Boolean).join(" · ") || null}
          icon={Wrench}
        />
      </div>
    ),
    enableSorting: false,
  },
  {
    id: "crew",
    header: "Technicians",
    cell: ({ row }) => {
      const r = row.original;
      if (r.unassigned) return <FlagBadge>Unassigned</FlagBadge>;
      return (
        <span className="text-sm" title={r.technicianNames.join(", ")}>
          {r.technicianNames.length > 3 ? `${r.technicianNames.slice(0, 3).join(", ")} +${r.technicianNames.length - 3}` : r.technicianNames.join(", ")}
        </span>
      );
    },
    enableSorting: false,
  },
  {
    id: "scheduled",
    header: "Scheduled",
    cell: ({ row }) =>
      row.original.scheduledStart ? (
        <IconText icon={CalendarDays}>
          {formatZonedDateTime(row.original.scheduledStart)}
          {row.original.scheduledEnd ? ` – ${formatZonedTime(row.original.scheduledEnd)}` : ""}
        </IconText>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    enableSorting: false,
  },
  { id: "hours", header: right("Hours"), cell: ({ row }) => num(`${row.original.hours} h`, true), enableSorting: false },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => <span className="text-sm">{row.original.status ?? "—"}</span>,
    enableSorting: false,
  },
];

export const CAPACITY_EXPORT_COLUMNS = [
  { key: "level", label: "Level" },
  { key: "name", label: "Name" },
  { key: "date", label: "Date" },
  { key: "booked", label: "Booked (h)" },
  { key: "available", label: "Available (h)" },
  { key: "status", label: "Status" },
];

const CELL_LABEL = { over: "Over-booked", spare: "Spare", ok: "", off: "Not working" } as const;

export function capacityExportRows(level: "Team" | "Technician", rows: CapacityRow[]) {
  return rows.flatMap((r) =>
    r.cells.map((c) => ({
      level,
      name: r.name,
      date: c.date,
      booked: hoursNumber(c.bookedMinutes),
      available: hoursNumber(c.availableMinutes),
      status: CELL_LABEL[c.status],
    })),
  );
}
