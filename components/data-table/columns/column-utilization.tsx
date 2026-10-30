"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Users, Wrench } from "lucide-react";

import { FlagBadge, NamesCell } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CapacityRow } from "@/lib/reports/capacity";
import { CHARGEABILITY_LABELS, HOURS_SOURCE_LABELS, type AppointmentDetail, type HoursSource, type TechnicianUtilization } from "@/lib/reports/utilization";
import type { CapacityBooking } from "@/lib/server/reports/planning";
import { viewerDateString, viewerDateTime, viewerTime } from "@/lib/reports/viewer-time";
import { cn } from "@/lib/utils";

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

function headerOf(label: string) {
  const Header = () => <div>{label}</div>;
  Header.displayName = `Header(${label})`;
  return Header;
}
const num = (children: React.ReactNode, strong = false) => (
  <div className={strong ? "text-sm font-medium tabular-nums" : "text-sm tabular-nums"}>{children}</div>
);

/*
  Hover help (28 Oct): a column's header says what it is and where its data
  comes from; a value shows its own sum with the row's figures.
*/
export type Help = { title: string; lines: string[] };

export function Explained({ help, children, className = "w-fit" }: { help: Help; children: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("cursor-help", className)}>{children}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="max-w-80">
        <p className="font-medium">{help.title}</p>
        {help.lines.map((line) => (
          <p key={line} className="mt-0.5 opacity-80">
            {line}
          </p>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}

export function helpHeader(label: string, help: Help) {
  const Header = () => (
    <Explained help={help}>
      <span className="decoration-muted-foreground/60 underline decoration-dotted underline-offset-4">{label}</span>
    </Explained>
  );
  Header.displayName = `Header(${label})`;
  return Header;
}

/* What each column is, and where its figures come from. */
export const COLUMN_HELP: Record<string, Help> = {
  available: {
    title: "Available hours",
    lines: [
      "Each working day × the technician's hours a day (8; 12 for Data Center technicians; or their own), less leave. Rest days and public holidays count nothing.",
      "No rest day entered yet: 6 of every 7 days count (one day off a week).",
      "Hours a day, rest days, holidays and portal leave: the portal. Time off: Zoho FSM.",
    ],
  },
  job: {
    title: "Job hours",
    lines: [
      "Each technician's own time on Completed and Cannot Complete appointments: their FSM time sheet; else the appointment's actual times trimmed to their own check-in and check-out; else the appointment's times.",
      "Each day counts up to what was available that day; the rest is overtime. Overlapping jobs count once.",
    ],
  },
  time: { title: "Time utilization", lines: ["Job hours ÷ available hours."] },
  chargeable: {
    title: "Chargeable hours",
    lines: [
      "Job hours on work with a value: the quotation's total is above zero or, with no quotation, the work order has a value.",
      "AMC and in-contract work (Work Type AMC PPM, or an AMC contract reference) is never chargeable.",
      "Quotations and work orders: Zoho FSM.",
    ],
  },
  commercial: { title: "Commercial utilization", lines: ["Chargeable hours ÷ available hours."] },
  outside: {
    title: "Overtime",
    lines: [
      "Job time beyond the hours available that day, and any work on a rest day, public holiday or leave.",
      "Shown on its own, not in either percentage.",
    ],
  },
  travel: {
    title: "Travel",
    lines: [
      "Time on trips the technician logged in Zoho FSM (Trips), start to end.",
      "Shown as hours and as a share of the day: travel ÷ available hours. Never part of either utilization (BRD B2).",
    ],
  },
  completeness: {
    title: "Data complete",
    lines: [
      "Completed appointments with both an actual start and an actual end in Zoho FSM ÷ all completed appointments.",
      "One without actual times is left out of job hours rather than counted as zero. Hover a row for where its hours came from.",
    ],
  },
  variance: {
    title: "Actual vs scheduled",
    lines: ["The appointments' actual time less their scheduled time, added up. Plus: longer than booked; minus: shorter.", "Both from Zoho FSM."],
  },
};

const h1 = (minutes: number) => Math.round((minutes / 60) * 10) / 10;

/** BRD B2: travel as a share of the day, i.e. of available hours; null with none available. */
export const travelShare = (r: { travelMinutes?: number; availableMinutes: number }) =>
  r.availableMinutes > 0 ? Math.round(((r.travelMinutes ?? 0) / r.availableMinutes) * 1000) / 10 : null;

/* "12 from own time sheets, 30 from own check-ins, 3 unverified". */
const sourcesLine = (from: Record<HoursSource, number>) =>
  (Object.keys(HOURS_SOURCE_LABELS) as HoursSource[])
    .filter((k) => from[k] > 0)
    .map((k) => `${from[k]} from ${HOURS_SOURCE_LABELS[k]}`)
    .join(", ");

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
  {
    id: "available",
    header: helpHeader("Available", COLUMN_HELP.available),
    cell: ({ row }) => {
      const r = row.original;
      const full = r.shiftDays * r.dailyMinutes;
      return (
        <Explained
          help={{
            title: `${hrs(r.availableMinutes)} available`,
            lines: [
              r.shiftDays ? `${r.shiftDays} working days × ${h1(r.dailyMinutes)} h a day = ${hrs(full)}` : "No working days in the dates.",
              r.leaveMinutes ? `Less ${hrs(r.leaveMinutes)} of leave = ${hrs(full - r.leaveMinutes)}` : "No leave in the dates.",
              r.restDaysAssumed ? `No rest day entered: × 6/7 (one day off a week) = ${hrs(r.availableMinutes)}` : "Rest days as entered in Scheduling.",
              r.shiftAssumed ? "No shift set for this technician: the day shift is assumed." : "",
            ].filter(Boolean),
          }}
        >
          {num(hrs(r.availableMinutes))}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "job",
    header: helpHeader("Job hours", COLUMN_HELP.job),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Explained
          help={{
            title: `${hrs(r.jobMinutes)} of job time counted`,
            lines: [
              `${r.appointments} ${r.appointments === 1 ? "appointment" : "appointments"}: ${sourcesLine(r.hoursFrom) || "none"}.`,
              `${hrs(r.jobMinutes + r.overtimeMinutes)} worked (overlaps once) − ${hrs(r.overtimeMinutes)} overtime = ${hrs(r.jobMinutes)} counted.`,
            ],
          }}
        >
          {num(hrs(r.jobMinutes))}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "time",
    header: helpHeader("Time %", COLUMN_HELP.time),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Explained help={{ title: `Time utilization ${pct(r.timePercent)}`, lines: [`${hrs(r.jobMinutes)} job ÷ ${hrs(r.availableMinutes)} available = ${pct(r.timePercent)}`] }}>
          {num(pct(r.timePercent), true)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "chargeable",
    header: helpHeader("Chargeable", COLUMN_HELP.chargeable),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Explained
          help={{
            title: `${hrs(r.chargeableMinutes)} chargeable`,
            lines: [
              `Of the ${hrs(r.jobMinutes)} job hours, ${hrs(r.chargeableMinutes)} were on work with a value in FSM.`,
              `${hrs(Math.max(0, r.jobMinutes - r.chargeableMinutes))} were on AMC work, a zero quotation or work with no value: time only.`,
            ],
          }}
        >
          {num(hrs(r.chargeableMinutes))}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "commercial",
    header: helpHeader("Commercial %", COLUMN_HELP.commercial),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Explained
          help={{ title: `Commercial utilization ${pct(r.commercialPercent)}`, lines: [`${hrs(r.chargeableMinutes)} chargeable ÷ ${hrs(r.availableMinutes)} available = ${pct(r.commercialPercent)}`] }}
        >
          {num(pct(r.commercialPercent), true)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "outside",
    header: helpHeader("Overtime", COLUMN_HELP.outside),
    cell: ({ row }) => {
      const r = row.original;
      if (!(r.overtimeMinutes > 0)) return num("—");
      return (
        <Explained
          help={{
            title: `${hrs(r.overtimeMinutes)} overtime`,
            lines: [
              `${hrs(r.jobMinutes + r.overtimeMinutes)} worked (overlaps once) − ${hrs(r.jobMinutes)} within the hours available each day = ${hrs(r.overtimeMinutes)}`,
              `A working day here is ${h1(r.dailyMinutes)} h${r.restDaysAssumed ? ", × 6/7 while no rest day is entered" : ""}.`,
            ],
          }}
        >
          {num(hrs(r.overtimeMinutes))}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "travel",
    header: helpHeader("Travel", COLUMN_HELP.travel),
    cell: ({ row }) => {
      const r = row.original;
      if (!r.travelTrips) return num("—");
      return (
        <Explained
          help={{
            title: `${hrs(r.travelMinutes ?? 0)} travel`,
            lines: [
              `${r.travelTrips} ${r.travelTrips === 1 ? "trip" : "trips"} in FSM: ${hrs(r.travelMinutes ?? 0)}.`,
              `${hrs(r.travelMinutes ?? 0)} ÷ ${hrs(r.availableMinutes)} available = ${pct(travelShare(r))} of the day.`,
            ],
          }}
        >
          <div className="text-sm tabular-nums">
            {hrs(r.travelMinutes ?? 0)}
            <span className="text-muted-foreground"> · {pct(travelShare(r))}</span>
          </div>
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "completeness",
    header: helpHeader("Data complete", COLUMN_HELP.completeness),
    cell: ({ row }) => {
      const r = row.original;
      if (r.completenessPercent === null) return num("—");
      return (
        <Explained
          help={{
            title: `Data complete ${pct(r.completenessPercent)}`,
            lines: [`${r.withActualTimes} of ${r.completed} completed ${r.completed === 1 ? "appointment has" : "appointments have"} both actual times = ${pct(r.completenessPercent)}`],
          }}
        >
          {r.completenessPercent < 100 ? <FlagBadge>{pct(r.completenessPercent)}</FlagBadge> : <span className="text-sm tabular-nums">100%</span>}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "variance",
    header: helpHeader("Actual vs scheduled", COLUMN_HELP.variance),
    cell: ({ row }) => {
      const r = row.original;
      if (!r.scheduledMinutes) return num("—");
      const sign = r.varianceMinutes > 0 ? "+" : "";
      return (
        <Explained
          help={{
            title: `${sign}${hrs(r.varianceMinutes)} ${r.varianceMinutes > 0 ? "longer" : "shorter"} than booked`,
            lines: [`${hrs(r.actualMinutes)} actual − ${hrs(r.scheduledMinutes)} scheduled = ${sign}${hrs(r.varianceMinutes)}`],
          }}
        >
          {num(`${sign}${hrs(r.varianceMinutes)}`)}
        </Explained>
      );
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
  { key: "outside", label: "Overtime (h)" },
  { key: "travel", label: "Travel (h)" },
  { key: "travelShare", label: "Travel % of available" },
  { key: "trips", label: "Trips" },
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
    outside: hoursNumber(r.overtimeMinutes),
    travel: hoursNumber(r.travelMinutes ?? 0),
    travelShare: travelShare(r),
    trips: r.travelTrips ?? 0,
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

const CHARGEABILITY_TONE = { chargeable: "muted", contract: "muted", zero_value: "warning", no_value: "muted" } as const;

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
      return <NamesCell names={row.original.technicianNames} />;
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
          {viewerDateTime(r.actualStart!)} – {viewerTime(r.actualEnd!, viewerDateString(r.actualStart!))}
        </IconText>
      );
    },
    enableSorting: false,
  },
  { id: "hours", header: headerOf("Hours"), cell: ({ row }) => num(hrs(row.original.actualMinutes), true), enableSorting: false },
  {
    id: "variance",
    header: headerOf("vs scheduled"),
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
      return <NamesCell names={r.technicianNames} />;
    },
    enableSorting: false,
  },
  {
    id: "scheduled",
    header: "Scheduled",
    cell: ({ row }) =>
      row.original.scheduledStart ? (
        <IconText icon={CalendarDays}>
          {viewerDateTime(row.original.scheduledStart)}
          {row.original.scheduledEnd ? ` – ${viewerTime(row.original.scheduledEnd, viewerDateString(row.original.scheduledStart))}` : ""}
        </IconText>
      ) : (
        <span className="text-muted-foreground text-sm">—</span>
      ),
    enableSorting: false,
  },
  { id: "hours", header: headerOf("Hours"), cell: ({ row }) => num(`${row.original.hours} h`, true), enableSorting: false },
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
