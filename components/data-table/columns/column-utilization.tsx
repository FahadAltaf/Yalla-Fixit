"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { CalendarDays, Users, Wrench } from "lucide-react";

import { FlagBadge, NamesCell } from "@/components/dashboard/reports/shared";
import { IconText } from "@/components/data-table/columns/icon-text";
import { Badge } from "@/components/ui/badge";
import { IdentityCell } from "@/components/ui/entity-avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CapacityRow } from "@/lib/reports/capacity";
import { CHARGEABILITY_LABELS, HOURS_SOURCE_LABELS, type AppointmentDetail, type HoursSource, type TechnicianUtilization } from "@/lib/reports/utilization";
import type { CapacityBooking } from "@/lib/server/reports/planning";
import { durationLabel, viewerDateString, viewerDateTime, viewerTime } from "@/lib/reports/viewer-time";
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
    title: "Expected hours",
    lines: [
      "Each week: the smaller of the technician's weekly hour limit and their hours a day (8; 12 for Data Center technicians; or their own) × the days they work a week (7 less their off days).",
      "Less a working day's share for each public holiday, and the leave taken.",
      "Off days are not fixed weekdays. A week cut by the dates expects its days less the off days, or the days worked if more.",
      "No off days entered yet: one a week. Hours a day, weekly limit, off days, holidays and portal leave: the employee's record in the portal. Time off: Zoho FSM.",
    ],
  },
  job: {
    title: "Job hours",
    lines: [
      "Each technician's own time on Completed and Cannot Complete appointments: their FSM time sheet; else the appointment's actual times trimmed to their own check-in and check-out; else the appointment's times.",
      "Every hour counts, on off days and public holidays too, so utilization can pass 100 %. Overlapping jobs count once.",
    ],
  },
  time: { title: "Time utilization", lines: ["Job hours ÷ expected hours. Above 100 %: more hours worked than expected."] },
  chargeable: {
    title: "Chargeable hours",
    lines: [
      "Job hours on work with a value: the quotation's total is above zero or, with no quotation, the work order has a value.",
      "AMC and in-contract work (Work Type AMC PPM, or an AMC contract reference) is never chargeable.",
      "Quotations and work orders: Zoho FSM.",
    ],
  },
  commercial: { title: "Commercial utilization", lines: ["Chargeable hours ÷ expected hours."] },
  outside: {
    title: "Above expected",
    lines: [
      "Each week, the job hours beyond the hours it expected, added up.",
      "Already inside both percentages (that is how they pass 100 %); shown on its own so it is easy to see.",
    ],
  },
  travel: {
    title: "Travel",
    lines: [
      "Time on trips the technician logged in Zoho FSM (Trips), start to end.",
      "Shown as hours and as a share of the day: travel ÷ expected hours. Never part of either utilization.",
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
    header: helpHeader("Expected", COLUMN_HELP.available),
    cell: ({ row }) => {
      const r = row.original;
      const workDays = Math.max(0, 7 - r.offDaysPerWeek);
      const byDays = r.dailyMinutes * workDays;
      const week = r.weeklyLimitMinutes === null ? byDays : Math.min(r.weeklyLimitMinutes, byDays);
      return (
        <Explained
          help={{
            title: `${hrs(r.availableMinutes)} expected`,
            lines: [
              `A full week: ${h1(r.dailyMinutes)} h a day × ${workDays} days (${r.offDaysPerWeek} off a week${r.restDaysAssumed ? ", none entered yet" : ""}) = ${hrs(byDays)}` +
                (r.weeklyLimitMinutes === null ? "; no weekly limit." : `; weekly limit ${hrs(r.weeklyLimitMinutes)}, so ${hrs(week)} a week.`),
              "Weeks cut by the dates expect their days less the off days, or the days worked if more.",
              r.leaveMinutes ? `Public holidays and ${hrs(r.leaveMinutes)} of leave are taken off.` : "Public holidays are taken off; no leave in the dates.",
              `= ${hrs(r.availableMinutes)} expected in the dates.`,
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
              `Every hour counts, overlapping jobs once: ${hrs(r.jobMinutes)}.`,
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
        <Explained help={{ title: `Time utilization ${pct(r.timePercent)}`, lines: [`${hrs(r.jobMinutes)} job ÷ ${hrs(r.availableMinutes)} expected = ${pct(r.timePercent)}`] }}>
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
          help={{ title: `Commercial utilization ${pct(r.commercialPercent)}`, lines: [`${hrs(r.chargeableMinutes)} chargeable ÷ ${hrs(r.availableMinutes)} expected = ${pct(r.commercialPercent)}`] }}
        >
          {num(pct(r.commercialPercent), true)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "outside",
    header: helpHeader("Above expected", COLUMN_HELP.outside),
    cell: ({ row }) => {
      const r = row.original;
      if (!(r.overtimeMinutes > 0)) return num("—");
      return (
        <Explained
          help={{
            title: `${hrs(r.overtimeMinutes)} above expected`,
            lines: [
              `Each week's job hours beyond that week's expected hours, added up: ${hrs(r.overtimeMinutes)}.`,
              "Already counted in both percentages.",
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
              `${hrs(r.travelMinutes ?? 0)} ÷ ${hrs(r.availableMinutes)} expected = ${pct(travelShare(r))} of the day.`,
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
  { key: "available", label: "Expected (h)" },
  { key: "job", label: "Job hours (h)" },
  { key: "time", label: "Time utilization %" },
  { key: "chargeable", label: "Chargeable (h)" },
  { key: "commercial", label: "Commercial utilization %" },
  { key: "outside", label: "Above expected (h)" },
  { key: "travel", label: "Travel (h)" },
  { key: "travelShare", label: "Travel % of expected" },
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

/* Why an appointment is, or is not, chargeable, in words. */
const CHARGEABILITY_WHY: Record<AppointmentDetail["chargeability"], string> = {
  chargeable: "Its quotation's total is above zero (or, with no quotation, its work order has a value in FSM), so its hours count as chargeable.",
  contract: "AMC or in-contract work: the work order has Work Type AMC PPM or an AMC contract reference in FSM. Never chargeable, whatever its value: its hours count for time utilization only.",
  zero_value: "Its quotation totals zero (an inspection or internal work), so its hours count for time utilization only.",
  no_value: "It has no quotation, and its work order has no value in FSM, so its hours count for time utilization only.",
};

/* Hover help for the appointments table (30 Oct), as on the other tables. */
const APPOINTMENT_HELP: Record<string, Help> = {
  crew: { title: "Technicians", lines: ["Everyone on the appointment in FSM: its lead and its crew. Hover a row for each person's own time on it and where it came from."] },
  actual: { title: "Actual", lines: ["When the work really started and ended, from the appointment's actual start and actual end in Zoho FSM. In your timezone."] },
  hours: { title: "Hours", lines: ["Actual end − actual start of the appointment. Each technician's own time on it can be shorter: hover the technicians."] },
  variance: { title: "vs scheduled", lines: ["Actual hours − scheduled hours. Above zero: it took longer than booked; below zero: shorter."] },
  chargeability: { title: "Chargeable", lines: ["Whether its hours count towards commercial utilization: from the quotation's total, the work order's value, and whether it is AMC work."] },
  status: { title: "Status", lines: ["The appointment's status in Zoho FSM. Completed counts in job hours; Cannot Complete counts only with both actual times."] },
};

const SOURCE_WORDS: Record<HoursSource, string> = {
  time_sheet: "their own FSM time sheet",
  attendance: "the appointment's times within their own check-in and check-out",
  appointment: "the appointment's actual times (unverified)",
};

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
    header: helpHeader("Technicians", APPOINTMENT_HELP.crew),
    cell: ({ row }) => {
      const r = row.original;
      if (!r.technicianNames.length) return <span className="text-muted-foreground text-sm">—</span>;
      const lines = r.technicianIds.map((id, i) => {
        const name = r.technicianNames[i] ?? id;
        const own = r.work?.[id];
        if (!own) return `${name}: ${r.missingActuals ? "no actual times, not counted" : `${hrs(r.actualMinutes)}, from ${SOURCE_WORDS.appointment}`}`;
        const minutes = (Date.parse(own.end) - Date.parse(own.start)) / 60_000;
        return `${name}: ${viewerTime(own.start)} – ${viewerTime(own.end, viewerDateString(own.start))} (${durationLabel(minutes)}), from ${SOURCE_WORDS[own.source]}`;
      });
      return (
        <Explained help={{ title: `${r.technicianNames.length} on this appointment`, lines }}>
          <div className="flex items-center gap-1.5 text-sm whitespace-nowrap">
            <span>{r.technicianNames[0]}</span>
            {r.technicianNames.length > 1 ? (
              <Badge variant="secondary" className="h-5 rounded-full px-1.5 tabular-nums">
                +{r.technicianNames.length - 1}
              </Badge>
            ) : null}
          </div>
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "actual",
    header: helpHeader("Actual", APPOINTMENT_HELP.actual),
    cell: ({ row }) => {
      const r = row.original;
      if (r.missingActuals) {
        return (
          <Explained
            help={{
              title: "No actual times",
              lines: ["FSM has no actual start or no actual end for this appointment, so it is left out of job hours (never counted as zero) and lowers data completeness."],
            }}
          >
            <FlagBadge tone="danger">No actual times</FlagBadge>
          </Explained>
        );
      }
      return (
        <Explained
          help={{
            title: "Actual times in FSM",
            lines: [
              `Started ${viewerDateTime(r.actualStart!)}, ended ${viewerDateTime(r.actualEnd!)}.`,
              r.scheduledStart ? `Scheduled ${viewerDateTime(r.scheduledStart)}${r.scheduledEnd ? ` – ${viewerTime(r.scheduledEnd, viewerDateString(r.scheduledStart))}` : ""}.` : "No scheduled time in FSM.",
            ],
          }}
        >
          <IconText icon={CalendarDays}>
            {viewerDateTime(r.actualStart!)} – {viewerTime(r.actualEnd!, viewerDateString(r.actualStart!))}
          </IconText>
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "hours",
    header: helpHeader("Hours", APPOINTMENT_HELP.hours),
    cell: ({ row }) => {
      const r = row.original;
      if (r.actualMinutes === null) return num("—");
      return (
        <Explained
          help={{
            title: `${hrs(r.actualMinutes)} on the appointment`,
            lines: [
              `${viewerTime(r.actualEnd)} − ${viewerTime(r.actualStart)} = ${durationLabel(r.actualMinutes)}, rounded to ${hrs(r.actualMinutes)}.`,
              r.countsInJobHours ? "Counts in each technician's job hours, as their own time on it." : "Not counted in job hours.",
            ],
          }}
        >
          {num(hrs(r.actualMinutes), true)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "variance",
    header: helpHeader("vs scheduled", APPOINTMENT_HELP.variance),
    cell: ({ row }) => {
      const r = row.original;
      const v = r.varianceMinutes;
      if (v === null) return num("—");
      return (
        <Explained
          help={{
            title: `${v > 0 ? "+" : ""}${hrs(v)} against the booking`,
            lines: [
              `${durationLabel(r.actualMinutes)} actual − ${durationLabel(r.scheduledMinutes)} scheduled = ${v < 0 ? "−" : ""}${durationLabel(Math.abs(v))}.`,
              v > 0 ? "It took longer than booked." : v < 0 ? "It took less time than booked." : "Exactly as booked.",
            ],
          }}
        >
          {num(`${v > 0 ? "+" : ""}${hrs(v)}`)}
        </Explained>
      );
    },
    enableSorting: false,
  },
  {
    id: "chargeability",
    header: helpHeader("Chargeable", APPOINTMENT_HELP.chargeability),
    cell: ({ row }) => (
      <Explained help={{ title: CHARGEABILITY_LABELS[row.original.chargeability], lines: [CHARGEABILITY_WHY[row.original.chargeability]] }}>
        <FlagBadge tone={CHARGEABILITY_TONE[row.original.chargeability]}>{CHARGEABILITY_LABELS[row.original.chargeability]}</FlagBadge>
      </Explained>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: helpHeader("Status", APPOINTMENT_HELP.status),
    cell: ({ row }) => {
      const r = row.original;
      return (
        <Explained
          help={{
            title: r.status ?? "No status",
            lines: [
              r.countsInJobHours
                ? "Counts in job hours."
                : r.status === "Cannot Complete"
                  ? "Cannot Complete without both actual times: not counted in job hours."
                  : r.missingActuals
                    ? "No actual times in FSM: not counted in job hours."
                    : "Not counted in job hours.",
            ],
          }}
        >
          <span className="text-sm">{r.status ?? "—"}</span>
        </Explained>
      );
    },
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
