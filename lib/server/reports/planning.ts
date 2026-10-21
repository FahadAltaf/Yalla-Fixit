import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { computeAvailability, datesBetween, MAX_RANGE_DAYS, type AvailabilityInput } from "@/lib/reports/available-hours";
import { computeCapacity, isBooked, type CapacityResult, type CapacityRow } from "@/lib/reports/capacity";
import type { ReportingSettings } from "@/lib/reporting/settings";
import {
  computeUtilization,
  type AppointmentDetail,
  type Chargeability,
  type Granularity,
  type TeamUtilization,
  type TechnicianUtilization,
  type TrendPoint,
} from "@/lib/reports/utilization";
import { addDaysToDateString, todayInZone, zonedDateString } from "@/lib/scheduling/org-time";
import { readReportingSettings } from "@/lib/server/reporting/settings";

import { loadAvailabilityInput, loadCapacityAppointments, loadTechnicians, loadUtilizationAppointments, type ReportTechnician } from "./data";
import { dataAsOf } from "./reports";

/**
 * The P6 reports, assembled for their routes: utilization (DEV-444) and
 * forward capacity (DEV-452). The calculations are pure, in
 * lib/reports/utilization.ts and capacity.ts; this file loads, filters to
 * the technicians asked for, and pages.
 */

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().max(200);
const id = z.string().trim().max(80);

type Roster = Map<string, ReportTechnician>;

const teamKeyOf = (t: ReportTechnician) => t.teamLeaderId ?? "none";

function teamOptions(roster: Roster) {
  const leaders = new Set([...roster.values()].map((t) => t.teamLeaderId).filter((v): v is string => Boolean(v)));
  return [
    ...[...leaders].map((leader) => ({ id: leader, name: `${roster.get(leader)?.name ?? leader}'s team` })).sort((a, b) => a.name.localeCompare(b.name)),
    { id: "none", name: "No team" },
  ];
}

const technicianOptions = (roster: Roster) =>
  [...roster.values()]
    .filter((t) => t.isActive)
    .map((t) => ({ id: t.fsmId, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

function page<T>(rows: T[], p: { page: number; pageSize: number }, all: boolean): T[] {
  return all ? rows : rows.slice(p.page * p.pageSize, (p.page + 1) * p.pageSize);
}

/* D-16: leave is barely recorded in the portal yet, so the report says how much it found. */
const leaveAndHolidayCounts = (input: AvailabilityInput) => ({ leaveRecords: input.leave.length, holidays: [...input.holidays].length });

// ---------------------------------------------------------------------
// Utilization (DEV-444)
// ---------------------------------------------------------------------

export const utilizationFiltersSchema = z.object({
  view: z.enum(["technicians", "teams", "appointments"]).default("technicians"),
  from: DATE.optional(),
  to: DATE.optional(),
  granularity: z.enum(["day", "week", "month"]).optional(),
  technician: id.optional(),
  team: id.optional(),
  chargeability: z.enum(["chargeable", "zero_value", "no_value"]).optional(),
  /** Appointments: only those missing actual times. */
  missing: z.enum(["1", "0"]).optional(),
  q: text.optional(),
});

export type UtilizationReport = {
  view: "technicians" | "teams" | "appointments";
  from: string;
  to: string;
  granularity: Granularity;
  overall: Omit<TeamUtilization, "key" | "name">;
  trend: TrendPoint[];
  teams: TeamUtilization[];
  /** The open view's rows, paged (technicians or appointments). */
  technicians: TechnicianUtilization[];
  appointments: AppointmentDetail[];
  total: number;
  jobMinutesBy: Record<Chargeability, number>;
  notes: {
    unpaidBreakMinutes: number;
    leaveRecords: number;
    holidays: number;
    /** Technicians without a shift: the day shift was used. */
    shiftAssumed: number;
    /** Technicians in the report with no rest days set: every day counts as a working day (D-16). */
    noRestDays: number;
    /** Appointments whose crew FSM has not been read for: the lead technician only. */
    crewsUnknown: number;
    /** Inactive technicians with no leaving date, included because they worked in the period. */
    inactiveWithoutLeavingDate: number;
  };
  options: { technicians: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> };
  dataAsOf: Record<string, string | null>;
};

/** The default period: this month to today. Weekly trend unless the range is short. */
function utilizationPeriod(filters: z.infer<typeof utilizationFiltersSchema>) {
  const today = todayInZone();
  let to = filters.to ?? today;
  let from = filters.from ?? `${to.slice(0, 8)}01`;
  if (from > to) [from, to] = [to, from];
  /* Capped like the engine; a longer range is cut from its start. */
  if (datesBetweenCount(from, to) > MAX_RANGE_DAYS) from = addDaysToDateString(to, -(MAX_RANGE_DAYS - 1));
  const days = datesBetweenCount(from, to);
  const granularity: Granularity = filters.granularity ?? (days <= 14 ? "day" : days <= 92 ? "week" : "month");
  return { from, to, granularity };
}

function datesBetweenCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

export async function buildUtilizationReport(
  admin: SupabaseClient,
  filters: z.infer<typeof utilizationFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<UtilizationReport> {
  const { from, to, granularity } = utilizationPeriod(filters);
  const [settings, roster, loaded, asOf] = await Promise.all([
    readReportingSettings(admin),
    loadTechnicians(admin),
    loadUtilizationAppointments(admin, { from, to }),
    dataAsOf(admin),
  ]);

  /* Who is in scope: the filter's technician or team, and of those, the
     active ones plus anyone who worked in the period (leavers keep their
     history). An inactive technician with no leaving date would look
     available for the whole period, so they are only in when they worked. */
  const worked = new Set(loaded.appointments.flatMap((a) => a.technicianIds));
  let inactiveWithoutLeavingDate = 0;
  const inScope = [...roster.values()].filter((t) => {
    if (filters.technician && t.fsmId !== filters.technician) return false;
    if (filters.team && teamKeyOf(t) !== filters.team) return false;
    if (t.isActive || t.leavingDate) return true;
    if (!worked.has(t.fsmId)) return false;
    inactiveWithoutLeavingDate += 1;
    return true;
  });

  const availabilityInput = await loadAvailabilityInput(admin, {
    from,
    to,
    technicians: inScope,
    unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
  });
  const availability = computeAvailability(availabilityInput);
  const scopeIds = new Set(inScope.map((t) => t.fsmId));
  const appointments = loaded.appointments
    .map((a) => ({ ...a, technicianIds: a.technicianIds.filter((t) => scopeIds.has(t)) }))
    .filter((a) => a.technicianIds.length > 0);

  const result = computeUtilization({ from, to, availability, technicians: roster, appointments, granularity });
  const counts = leaveAndHolidayCounts(availabilityInput);
  const needle = (filters.q ?? "").toLowerCase();

  let technicians: TechnicianUtilization[] = [];
  let details: AppointmentDetail[] = [];
  let total = 0;
  if (filters.view === "technicians") {
    const rows = needle ? result.technicians.filter((t) => `${t.name} ${t.teamName}`.toLowerCase().includes(needle)) : result.technicians;
    technicians = page(rows, paging, Boolean(options.all));
    total = rows.length;
  } else if (filters.view === "appointments") {
    const rows = result.appointments.filter((a) => {
      if (filters.chargeability && a.chargeability !== filters.chargeability) return false;
      if (filters.missing === "1" && !a.missingActuals) return false;
      if (
        needle &&
        !`${a.number ?? ""} ${a.workOrderNumber ?? ""} ${a.clientName ?? ""} ${a.technicianNames.join(" ")}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
    details = page(rows, paging, Boolean(options.all));
    total = rows.length;
  } else {
    total = result.teams.length;
  }

  return {
    view: filters.view,
    from,
    to,
    granularity,
    overall: result.overall,
    trend: result.trend,
    teams: result.teams,
    technicians,
    appointments: details,
    total,
    jobMinutesBy: result.jobMinutesBy,
    notes: {
      unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
      ...counts,
      shiftAssumed: result.technicians.filter((t) => t.shiftAssumed).length,
      noRestDays: result.technicians.filter((t) => (roster.get(t.fsmId)?.restWeekdays.length ?? 0) === 0).length,
      crewsUnknown: loaded.crewsUnknown,
      inactiveWithoutLeavingDate,
    },
    options: { technicians: technicianOptions(roster), teams: teamOptions(roster) },
    dataAsOf: asOf,
  };
}

// ---------------------------------------------------------------------
// Capacity (DEV-452)
// ---------------------------------------------------------------------

export const capacityFiltersSchema = z.object({
  /** First day shown; today when not given. */
  from: DATE.optional(),
  /** Days shown; the setting's horizon when not given. */
  days: z.coerce.number().int().min(1).max(90).optional(),
  team: id.optional(),
  technician: id.optional(),
  /** The bookings list below the board: one day of it. */
  day: DATE.optional(),
  q: text.optional(),
});

export type CapacityBooking = {
  id: string;
  number: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  status: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  date: string | null;
  hours: number;
  technicianNames: string[];
  unassigned: boolean;
};

export type CapacityReport = Omit<CapacityResult, "technicians" | "overbooked"> & {
  from: string;
  to: string;
  horizonDays: number;
  spareBelowPercent: number;
  /** Technicians of the team asked for, or all when none is. */
  technicians: CapacityRow[];
  bookings: CapacityBooking[];
  total: number;
  notes: { unpaidBreakMinutes: number; leaveRecords: number; holidays: number; crewsUnknown: number; shiftAssumed: number; noRestDays: number };
  options: { technicians: Array<{ id: string; name: string }>; teams: Array<{ id: string; name: string }> };
  dataAsOf: Record<string, string | null>;
};

/** The whole board for the dates: what the report and N14 both read. */
export async function computeCapacityFor(
  admin: SupabaseClient,
  settings: ReportingSettings,
  range: { from: string; days: number },
  scope: { team?: string } = {},
) {
  const to = addDaysToDateString(range.from, range.days - 1);
  const dates = datesBetween(range.from, to);
  const [roster, loaded] = await Promise.all([loadTechnicians(admin), loadCapacityAppointments(admin, { from: range.from, to })]);
  /* The board is the active roster, plus leavers still in it before their date. */
  const onBoard = [...roster.values()].filter(
    (t) => (t.isActive || (t.leavingDate !== null && t.leavingDate > range.from)) && (!scope.team || teamKeyOf(t) === scope.team),
  );
  const availabilityInput = await loadAvailabilityInput(admin, {
    from: range.from,
    to,
    technicians: onBoard,
    unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
  });
  const availability = computeAvailability(availabilityInput);
  const result = computeCapacity({
    dates,
    availability,
    technicians: new Map(onBoard.map((t) => [t.fsmId, t])),
    appointments: loaded.appointments,
    spareBelowPercent: settings.capacity.spareBelowPercent,
  });
  return { to, roster, loaded, availabilityInput, availability, result };
}

export async function buildCapacityReport(
  admin: SupabaseClient,
  filters: z.infer<typeof capacityFiltersSchema>,
  paging: { page: number; pageSize: number },
  options: { all?: boolean } = {},
): Promise<CapacityReport> {
  const settings = await readReportingSettings(admin);
  const from = filters.from ?? todayInZone();
  const days = filters.days ?? settings.capacity.horizonDays;
  const [{ to, roster, loaded, availabilityInput, availability, result }, asOf] = await Promise.all([
    computeCapacityFor(admin, settings, { from, days }, { team: filters.team }),
    dataAsOf(admin),
  ]);

  /* Bookings below the board: of the day picked (or the whole range), the team's or technician's. */
  const teamMembers = new Set(result.technicians.map((t) => t.key));
  const nameOf = (fsmId: string) => roster.get(fsmId)?.name ?? fsmId;
  const needle = (filters.q ?? "").toLowerCase();
  const bookings = loaded.appointments
    .filter((a) => {
      if (!isBooked(a)) return false;
      if (filters.day && (!a.scheduledStart || zonedDateString(a.scheduledStart) !== filters.day)) return false;
      if (filters.technician && !a.technicianIds.includes(filters.technician)) return false;
      /* Unassigned bookings belong to no team, so they show under every team. */
      if (filters.team && a.technicianIds.length > 0 && !a.technicianIds.some((t) => teamMembers.has(t))) return false;
      if (
        needle &&
        !`${a.number ?? ""} ${a.workOrderNumber ?? ""} ${a.clientName ?? ""} ${a.technicianIds.map(nameOf).join(" ")}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? ""))
    .map<CapacityBooking>((a) => {
      const startMs = a.scheduledStart ? Date.parse(a.scheduledStart) : NaN;
      const endMs = a.scheduledEnd ? Date.parse(a.scheduledEnd) : NaN;
      return {
        id: a.id,
        number: a.number,
        workOrderNumber: a.workOrderNumber,
        clientName: a.clientName,
        status: a.status,
        scheduledStart: a.scheduledStart,
        scheduledEnd: a.scheduledEnd,
        date: a.scheduledStart ? zonedDateString(a.scheduledStart) : null,
        hours: Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.round(((endMs - startMs) / 3_600_000) * 10) / 10 : 0,
        technicianNames: a.technicianIds.map(nameOf),
        unassigned: a.technicianIds.length === 0,
      };
    });

  /* eslint-disable-next-line @typescript-eslint/no-unused-vars -- N14's list is not part of the page */
  const { overbooked, technicians, ...board } = result;
  const counts = leaveAndHolidayCounts(availabilityInput);
  return {
    ...board,
    from,
    to,
    horizonDays: days,
    spareBelowPercent: settings.capacity.spareBelowPercent,
    technicians,
    bookings: page(bookings, paging, Boolean(options.all)),
    total: bookings.length,
    notes: {
      unpaidBreakMinutes: settings.attendance.unpaidBreakMinutes,
      ...counts,
      crewsUnknown: loaded.crewsUnknown,
      shiftAssumed: availability.filter((a) => a.shiftAssumed).length,
      noRestDays: result.technicians.filter((t) => (roster.get(t.key)?.restWeekdays.length ?? 0) === 0).length,
    },
    options: { technicians: technicianOptions(roster), teams: teamOptions(roster) },
    dataAsOf: asOf,
  };
}
