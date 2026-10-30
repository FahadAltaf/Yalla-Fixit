import { addDaysToDateString, zonedDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

import { coveredMinutes, isoWeekday, type TechnicianAvailability } from "./available-hours";

/**
 * Technician utilization (BRD 5.2 B2; DEV-444). Two measures, always side
 * by side:
 *
 *   time utilization        job hours ÷ available hours
 *   commercial utilization  chargeable job hours ÷ available hours
 *
 * Rules (reporting-calculation-specification.md, with Sami's answers of
 * 28 Oct):
 *
 *  - Job hours are the union of a technician's own working time on
 *    Completed appointments, and Cannot Complete ones that have both actual
 *    times (they count). Two appointments at the same time count once.
 *  - A technician's own time on a job (individual hours, not the crew's):
 *    their FSM time sheet on it; else the appointment's actual times
 *    trimmed to their own FSM attendance that day (check-in to check-out);
 *    else the appointment's actual times, counted as unverified.
 *  - Each day counts job time up to the hours available that day (the
 *    daily hours, less leave; 6/7 of them while no rest day is entered).
 *    Time beyond that, and any work on a rest day, holiday or leave, is
 *    overtime: reported beside utilization, not in either ratio.
 *  - Chargeable (D-08): the work order's quotation has a total above zero,
 *    or, with no quotation, the work order itself has a value. A quotation
 *    totalling zero (inspection, internal work) is time only (TC09). Work
 *    with no value anywhere is time only too, and shown apart.
 *  - AMC and in-contract work is not chargeable (decided 29 Oct, D-08 and
 *    D-14; the BRD's B2 said it was), whatever its value: time only, and
 *    shown apart. FSM marks it on the work order: Work Type "AMC PPM", or
 *    an AMC contract reference.
 *  - Ratios are over sums, never averages of percentages.
 *  - Missing actual times are never zero-length jobs: those appointments
 *    stay out of job hours and count against data completeness.
 *  - Travel comes from FSM trips, which the token cannot read (B-01).
 *
 * Pure: no database, no clock. Minutes throughout.
 */

export type Chargeability = "chargeable" | "contract" | "zero_value" | "no_value";

export const CHARGEABILITY_LABELS: Record<Chargeability, string> = {
  chargeable: "Chargeable",
  contract: "AMC / contract",
  zero_value: "Quotation of zero",
  no_value: "No value in FSM",
};

/** 29 Oct: how FSM marks AMC work on a work order (Work Type "AMC PPM", or a contract reference). */
export function isContractWork(input: { workType?: string | null; amcContractRef?: string | null }): boolean {
  return Boolean(input.amcContractRef?.trim()) || /\bamc\b/i.test(input.workType ?? "");
}

/** D-08: AMC work never; else a quotation above zero; with no quotation, a work order with a value. */
export function chargeabilityOf(input: { quotationTotal: number | null; workOrderTotal: number | null; contract?: boolean }): Chargeability {
  if (input.contract) return "contract";
  if (input.quotationTotal !== null) return input.quotationTotal > 0 ? "chargeable" : "zero_value";
  return (input.workOrderTotal ?? 0) > 0 ? "chargeable" : "no_value";
}

export type HoursSource = "time_sheet" | "attendance" | "appointment";

export const HOURS_SOURCE_LABELS: Record<HoursSource, string> = {
  time_sheet: "own time sheet",
  attendance: "own check-in and check-out",
  appointment: "appointment times (unverified)",
};

/** One technician's own working time on an appointment (the loader decides the source). */
export type TechnicianWork = { start: string; end: string; source: HoursSource };

export type UtilizationAppointment = {
  id: string;
  number: string | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  status: string | null;
  type: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  technicianIds: string[];
  chargeability: Chargeability;
  /** Each technician's own time on it; anyone missing uses the appointment's actual times. */
  work?: Record<string, TechnicianWork>;
};

export type UtilizationTechnician = { fsmId: string; name: string; teamLeaderId: string | null };

export type Measures = {
  availableMinutes: number;
  jobMinutes: number;
  chargeableMinutes: number;
  /** null when nothing was available. One decimal, for display. */
  timePercent: number | null;
  commercialPercent: number | null;
};

/** BRD B2: travel from FSM Trips, beside utilization and never in it (set by the report builder). */
export type TravelMeasures = { travelMinutes?: number; travelTrips?: number };

export type TechnicianUtilization = Measures &
  TravelMeasures & {
  fsmId: string;
  name: string;
  teamKey: string;
  teamName: string;
  /** No shift set on the technician: the day shift was used. */
  shiftAssumed: boolean;
  /** No rest day entered: 6 of every 7 days were counted. */
  restDaysAssumed: boolean;
  /** Hours a working day (the standard day, or their own). */
  dailyMinutes: number;
  shiftDays: number;
  leaveMinutes: number;
  /** Job time beyond what was available on its day, or on a day off: not in the ratios. */
  overtimeMinutes: number;
  /** Where the counted jobs' hours came from, per appointment. */
  hoursFrom: Record<HoursSource, number>;
  /** Appointments counted in job hours. */
  appointments: number;
  /** Completed appointments, and how many have both actual times. */
  completed: number;
  withActualTimes: number;
  completenessPercent: number | null;
  /** Appointments with both scheduled and actual times: Σ of each. */
  scheduledMinutes: number;
  actualMinutes: number;
  /** actual − scheduled, over the same appointments. */
  varianceMinutes: number;
};

export type TeamUtilization = Measures &
  TravelMeasures & {
  key: string;
  name: string;
  technicians: number;
  overtimeMinutes: number;
  hoursFrom: Record<HoursSource, number>;
  completed: number;
  withActualTimes: number;
  completenessPercent: number | null;
  varianceMinutes: number;
  scheduledMinutes: number;
};

export type TrendPoint = Measures & { key: string; label: string; from: string; to: string };

export type Granularity = "day" | "week" | "month";

export type AppointmentDetail = UtilizationAppointment & {
  technicianNames: string[];
  /** Calendar date the appointment belongs to: actual start, else scheduled. */
  date: string | null;
  countsInJobHours: boolean;
  actualMinutes: number | null;
  scheduledMinutes: number | null;
  varianceMinutes: number | null;
  missingActuals: boolean;
};

export type UtilizationResult = {
  technicians: TechnicianUtilization[];
  teams: TeamUtilization[];
  overall: Omit<TeamUtilization, "key" | "name">;
  trend: TrendPoint[];
  appointments: AppointmentDetail[];
  /** Job minutes by chargeability, inside the shift windows. */
  jobMinutesBy: Record<Chargeability, number>;
};

const MINUTE = 60_000;
const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

function hasActuals(a: UtilizationAppointment): boolean {
  const start = ms(a.actualStart);
  const end = ms(a.actualEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

/** Counted in job hours: Completed, or Cannot Complete with both actual times. */
export function countsInJobHours(a: UtilizationAppointment): boolean {
  if (!hasActuals(a)) return false;
  return a.status === "Completed" || a.status === "Cannot Complete";
}

const durationMinutes = (start: string | null, end: string | null) => {
  const s = ms(start);
  const e = ms(end);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s ? (e - s) / MINUTE : null;
};

/** The Monday of a date's ISO week. */
export function weekStart(date: string): string {
  return addDaysToDateString(date, 1 - isoWeekday(date));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

function bucketOf(date: string, granularity: Granularity): { key: string; label: string } {
  if (granularity === "day") return { key: date, label: shortDate(date) };
  if (granularity === "week") {
    const start = weekStart(date);
    return { key: start, label: `w/c ${shortDate(start)}` };
  }
  return { key: date.slice(0, 7), label: `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}` };
}

const withPercents = <T extends { availableMinutes: number; jobMinutes: number; chargeableMinutes: number }>(m: T) => ({
  ...m,
  timePercent: percent(m.jobMinutes, m.availableMinutes),
  commercialPercent: percent(m.chargeableMinutes, m.availableMinutes),
});

export function computeUtilization(input: {
  from: string;
  to: string;
  availability: TechnicianAvailability[];
  technicians: Map<string, UtilizationTechnician>;
  /** Completed and Cannot Complete appointments around the period. */
  appointments: UtilizationAppointment[];
  granularity: Granularity;
  timeZone?: string;
}): UtilizationResult {
  const rangeStart = zonedTimeToUtc(input.from, "00:00", input.timeZone).getTime();
  const rangeEnd = zonedTimeToUtc(addDaysToDateString(input.to, 1), "00:00", input.timeZone).getTime();
  const nameOf = (id: string) => input.technicians.get(id)?.name ?? id;

  /* The appointments of the period: by actual start, else scheduled start. */
  const details: AppointmentDetail[] = [];
  for (const a of input.appointments) {
    const anchor = a.actualStart ?? a.scheduledStart;
    const at = ms(anchor);
    if (!Number.isFinite(at) || at < rangeStart || at >= rangeEnd) continue;
    const actualMinutes = durationMinutes(a.actualStart, a.actualEnd);
    const scheduledMinutes = durationMinutes(a.scheduledStart, a.scheduledEnd);
    details.push({
      ...a,
      technicianNames: a.technicianIds.map(nameOf),
      date: anchor ? zonedDateString(anchor, input.timeZone) : null,
      countsInJobHours: countsInJobHours(a),
      actualMinutes,
      scheduledMinutes,
      varianceMinutes: actualMinutes !== null && scheduledMinutes !== null ? actualMinutes - scheduledMinutes : null,
      missingActuals: !hasActuals(a),
    });
  }

  type Interval = { start: number; end: number };
  type Jobs = { all: Interval[]; byKind: Record<Chargeability, Interval[]> };
  const blankSources = (): Record<HoursSource, number> => ({ time_sheet: 0, attendance: 0, appointment: 0 });
  const jobsByTech = new Map<string, Jobs>();
  const perTechCounts = new Map<
    string,
    { appointments: number; completed: number; withActualTimes: number; scheduled: number; actual: number; sources: Record<HoursSource, number> }
  >();
  for (const d of details) {
    for (const id of d.technicianIds) {
      const counts = perTechCounts.get(id) ?? { appointments: 0, completed: 0, withActualTimes: 0, scheduled: 0, actual: 0, sources: blankSources() };
      if (d.status === "Completed") {
        counts.completed += 1;
        if (!d.missingActuals) counts.withActualTimes += 1;
      }
      if (d.countsInJobHours) {
        /* Their own time on the job, else the appointment's. */
        const own = d.work?.[id];
        const interval = own ? { start: ms(own.start), end: ms(own.end) } : { start: ms(d.actualStart), end: ms(d.actualEnd) };
        const ownMinutes = Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start ? (interval.end - interval.start) / MINUTE : 0;
        counts.appointments += 1;
        counts.sources[own?.source ?? "appointment"] += 1;
        if (d.scheduledMinutes !== null) {
          counts.scheduled += d.scheduledMinutes;
          counts.actual += ownMinutes;
        }
        if (ownMinutes > 0) {
          const jobs = jobsByTech.get(id) ?? { all: [], byKind: { chargeable: [], contract: [], zero_value: [], no_value: [] } };
          jobs.all.push(interval);
          jobs.byKind[d.chargeability].push(interval);
          jobsByTech.set(id, jobs);
        }
      }
      perTechCounts.set(id, counts);
    }
  }

  const dayBounds = new Map<string, { start: number; end: number }>();
  const boundsOf = (date: string) => {
    let b = dayBounds.get(date);
    if (!b) {
      b = { start: zonedTimeToUtc(date, "00:00", input.timeZone).getTime(), end: zonedTimeToUtc(addDaysToDateString(date, 1), "00:00", input.timeZone).getTime() };
      dayBounds.set(date, b);
    }
    return b;
  };

  type TeamSum = Omit<TeamUtilization, "key" | "name" | "technicians" | "timePercent" | "commercialPercent" | "completenessPercent"> & {
    key: string;
    name: string;
    members: Set<string>;
  };
  const blankTeam = (key: string, name: string): TeamSum => ({
    key,
    name,
    members: new Set(),
    availableMinutes: 0,
    jobMinutes: 0,
    chargeableMinutes: 0,
    overtimeMinutes: 0,
    completed: 0,
    withActualTimes: 0,
    varianceMinutes: 0,
    scheduledMinutes: 0,
    hoursFrom: blankSources(),
  });
  const teams = new Map<string, TeamSum>();
  const teamOfLeader = (leader: string | null) => (leader ? { key: leader, name: `${nameOf(leader)}'s team` } : { key: "none", name: "No team" });

  const jobMinutesBy: Record<Chargeability, number> = { chargeable: 0, contract: 0, zero_value: 0, no_value: 0 };
  const trend = new Map<string, TrendPoint>();
  const technicians: TechnicianUtilization[] = [];

  for (const avail of input.availability) {
    const jobs = jobsByTech.get(avail.fsmId);
    const counts = perTechCounts.get(avail.fsmId);
    let jobMinutes = 0;
    let chargeableMinutes = 0;
    let overtimeMinutes = 0;
    let workedAny = 0;
    /* The day's team; with none given at all, the roster's. */
    const leaderOn = (day: { teamLeaderId?: string | null } | undefined) =>
      day?.teamLeaderId !== undefined ? day.teamLeaderId : (input.technicians.get(avail.fsmId)?.teamLeaderId ?? null);
    /* With no rest day entered, a week holds 6/7 of its days' hours, and any day up to a full
       day's: six full days make 100 %, a seventh is overtime. */
    const weekLeft = new Map<string, number>();
    for (const day of avail.days) {
      if (!day.restDaysAssumed) continue;
      const week = weekStart(day.date);
      weekLeft.set(week, (weekLeft.get(week) ?? 0) + day.availableMinutes);
    }
    for (const day of avail.days) {
      const b = boundsOf(day.date);
      /* The day's own time, up to what was available that day; the rest is overtime. */
      const worked = jobs ? coveredMinutes(b.start, b.end, jobs.all) : 0;
      let counted = Math.min(worked, day.availableMinutes);
      if (day.restDaysAssumed) {
        const week = weekStart(day.date);
        counted = Math.min(worked, day.dailyMinutes - day.leaveMinutes, weekLeft.get(week) ?? 0);
        weekLeft.set(week, (weekLeft.get(week) ?? 0) - counted);
      }
      const chargeableWorked = jobs ? coveredMinutes(b.start, b.end, jobs.byKind.chargeable) : 0;
      const dayChargeable = Math.min(chargeableWorked, counted);
      /* What is left of the counted time, by kind: AMC, then a quotation of zero, then no value. */
      const contractWorked = jobs ? coveredMinutes(b.start, b.end, jobs.byKind.contract) : 0;
      const dayContract = Math.min(contractWorked, counted - dayChargeable);
      const zeroWorked = jobs ? coveredMinutes(b.start, b.end, jobs.byKind.zero_value) : 0;
      const dayZero = Math.min(zeroWorked, counted - dayChargeable - dayContract);
      jobMinutesBy.chargeable += dayChargeable;
      jobMinutesBy.contract += dayContract;
      jobMinutesBy.zero_value += dayZero;
      jobMinutesBy.no_value += counted - dayChargeable - dayContract - dayZero;
      jobMinutes += counted;
      chargeableMinutes += dayChargeable;
      overtimeMinutes += worked - counted;
      workedAny += worked;

      /* The team of that day: a move to another team does not take past days with it. */
      if (day.availableMinutes > 0 || worked > 0) {
        const t = teamOfLeader(leaderOn(day));
        const team = teams.get(t.key) ?? blankTeam(t.key, t.name);
        team.members.add(avail.fsmId);
        team.availableMinutes += day.availableMinutes;
        team.jobMinutes += counted;
        team.chargeableMinutes += dayChargeable;
        team.overtimeMinutes += worked - counted;
        teams.set(t.key, team);
      }

      const bucket = bucketOf(day.date, input.granularity);
      const point = trend.get(bucket.key) ?? {
        key: bucket.key,
        label: bucket.label,
        from: day.date,
        to: day.date,
        availableMinutes: 0,
        jobMinutes: 0,
        chargeableMinutes: 0,
        timePercent: null,
        commercialPercent: null,
      };
      point.availableMinutes += day.availableMinutes;
      point.jobMinutes += counted;
      point.chargeableMinutes += dayChargeable;
      if (day.date < point.from) point.from = day.date;
      if (day.date > point.to) point.to = day.date;
      trend.set(bucket.key, point);
    }

    const availableMinutes = avail.totals.availableMinutes;
    /* Someone with nothing available and no work in the period is not in the report. */
    if (availableMinutes === 0 && workedAny === 0 && !(counts && counts.completed > 0)) continue;

    /* Shown under the team of the period's last day; the team view splits by day. */
    const lastDay = avail.days[avail.days.length - 1];
    const team = teamOfLeader(leaderOn(lastDay));
    const sources = counts?.sources ?? blankSources();
    const rowTeam = teams.get(team.key) ?? blankTeam(team.key, team.name);
    rowTeam.completed += counts?.completed ?? 0;
    rowTeam.withActualTimes += counts?.withActualTimes ?? 0;
    rowTeam.varianceMinutes += (counts?.actual ?? 0) - (counts?.scheduled ?? 0);
    rowTeam.scheduledMinutes += counts?.scheduled ?? 0;
    for (const k of Object.keys(sources) as HoursSource[]) rowTeam.hoursFrom[k] += sources[k];
    rowTeam.members.add(avail.fsmId);
    teams.set(team.key, rowTeam);

    technicians.push({
      ...withPercents({ availableMinutes, jobMinutes, chargeableMinutes }),
      fsmId: avail.fsmId,
      name: nameOf(avail.fsmId),
      teamKey: team.key,
      teamName: team.name,
      shiftAssumed: avail.shiftAssumed,
      restDaysAssumed: avail.restDaysAssumed,
      dailyMinutes: avail.dailyMinutes,
      shiftDays: avail.totals.shiftDays,
      leaveMinutes: avail.totals.leaveMinutes,
      overtimeMinutes,
      hoursFrom: sources,
      appointments: counts?.appointments ?? 0,
      completed: counts?.completed ?? 0,
      withActualTimes: counts?.withActualTimes ?? 0,
      completenessPercent: percent(counts?.withActualTimes ?? 0, counts?.completed ?? 0),
      scheduledMinutes: counts?.scheduled ?? 0,
      actualMinutes: counts?.actual ?? 0,
      varianceMinutes: (counts?.actual ?? 0) - (counts?.scheduled ?? 0),
    });
  }

  /* Highest utilization first (28 Oct: every table descending); no figure last. */
  technicians.sort((a, b) => (b.timePercent ?? -1) - (a.timePercent ?? -1) || a.name.localeCompare(b.name));

  const inReport = new Set(technicians.map((t) => t.fsmId));
  const finish = (m: TeamSum): TeamUtilization => {
    const { members, ...rest } = m;
    return {
      ...withPercents(rest),
      technicians: [...members].filter((id) => inReport.has(id)).length,
      completenessPercent: percent(m.withActualTimes, m.completed),
    };
  };

  /* Overall: the same sums; completeness over appointments, not technician-appointment pairs. */
  const sum = (pick: (t: TechnicianUtilization) => number) => technicians.reduce((s, t) => s + pick(t), 0);
  const completedAppointments = details.filter((d) => d.status === "Completed" && d.technicianIds.some((id) => inReport.has(id)));
  const overallSources = blankSources();
  for (const t of technicians) for (const k of Object.keys(overallSources) as HoursSource[]) overallSources[k] += t.hoursFrom[k];
  const overall = {
    ...withPercents({ availableMinutes: sum((t) => t.availableMinutes), jobMinutes: sum((t) => t.jobMinutes), chargeableMinutes: sum((t) => t.chargeableMinutes) }),
    technicians: technicians.length,
    overtimeMinutes: sum((t) => t.overtimeMinutes),
    completed: completedAppointments.length,
    withActualTimes: completedAppointments.filter((d) => !d.missingActuals).length,
    completenessPercent: percent(completedAppointments.filter((d) => !d.missingActuals).length, completedAppointments.length),
    varianceMinutes: sum((t) => t.varianceMinutes),
    scheduledMinutes: sum((t) => t.scheduledMinutes),
    hoursFrom: overallSources,
  };

  return {
    technicians,
    teams: [...teams.values()]
      .map(finish)
      .filter((t) => t.technicians > 0)
      .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : (b.timePercent ?? -1) - (a.timePercent ?? -1) || a.name.localeCompare(b.name))),
    overall,
    trend: [...trend.values()].sort((a, b) => a.key.localeCompare(b.key)).map((p) => withPercents(p)),
    appointments: details.sort((a, b) => (b.actualStart ?? b.scheduledStart ?? "").localeCompare(a.actualStart ?? a.scheduledStart ?? "")),
    jobMinutesBy,
  };
}
