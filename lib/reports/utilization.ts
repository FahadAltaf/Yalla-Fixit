import { addDaysToDateString, zonedDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

import { coveredMinutes, isoWeekday, type TechnicianAvailability } from "./available-hours";

/**
 * Technician utilization (BRD 5.2 B2; DEV-444). Two measures, always side
 * by side:
 *
 *   time utilization        job hours ÷ available hours
 *   commercial utilization  chargeable job hours ÷ available hours
 *
 * Rules (reporting-calculation-specification.md):
 *
 *  - Job hours are the union of a technician's [actual start, actual end)
 *    on Completed appointments, and Cannot Complete ones that have both
 *    actual times. Two appointments at the same time count once. A job
 *    shared by a crew counts in full for each of them (time, not revenue).
 *  - Job time is counted inside the technician's shift windows only; time
 *    outside them is reported beside utilization as "outside shift"
 *    (overtime is D-16). So a day with no available hours (holiday, rest
 *    day, leave, after leaving) adds nothing to either side of the ratio.
 *  - Chargeable (D-08): the work order's quotation has a total above zero,
 *    or, with no quotation, the work order itself has a value. A quotation
 *    totalling zero (inspection, internal work) is time only (TC09). Work
 *    with no value anywhere is time only too, and shown apart: that is
 *    where AMC and in-contract work would be, once FSM says how to tell
 *    it (D-14).
 *  - Ratios are over sums, never averages of percentages.
 *  - Missing actual times are never zero-length jobs: those appointments
 *    stay out of job hours and count against data completeness.
 *  - Travel comes from FSM trips, which the token cannot read (B-01).
 *
 * Pure: no database, no clock. Minutes throughout.
 */

export type Chargeability = "chargeable" | "zero_value" | "no_value";

export const CHARGEABILITY_LABELS: Record<Chargeability, string> = {
  chargeable: "Chargeable",
  zero_value: "Quotation of zero",
  no_value: "No value in FSM",
};

/** D-08: a quotation above zero; with no quotation, a work order with a value. */
export function chargeabilityOf(input: { quotationTotal: number | null; workOrderTotal: number | null }): Chargeability {
  if (input.quotationTotal !== null) return input.quotationTotal > 0 ? "chargeable" : "zero_value";
  return (input.workOrderTotal ?? 0) > 0 ? "chargeable" : "no_value";
}

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

export type TechnicianUtilization = Measures & {
  fsmId: string;
  name: string;
  teamKey: string;
  teamName: string;
  /** No shift set on the technician: the day shift was used. */
  shiftAssumed: boolean;
  shiftDays: number;
  leaveMinutes: number;
  /** Job time outside the shift windows (D-16), not in the ratio. */
  outsideShiftMinutes: number;
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

export type TeamUtilization = Measures & {
  key: string;
  name: string;
  technicians: number;
  outsideShiftMinutes: number;
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
  const teamOf = (id: string) => {
    /* D-20: a team is a team leader and the technicians who report to them. */
    const leader = input.technicians.get(id)?.teamLeaderId ?? null;
    return leader ? { key: leader, name: `${nameOf(leader)}'s team` } : { key: "none", name: "No team" };
  };

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
  const jobsByTech = new Map<string, { all: Interval[]; chargeable: Interval[]; byKind: Record<Chargeability, Interval[]> }>();
  const perTechCounts = new Map<string, { appointments: number; completed: number; withActualTimes: number; scheduled: number; actual: number }>();
  for (const d of details) {
    for (const id of d.technicianIds) {
      const counts = perTechCounts.get(id) ?? { appointments: 0, completed: 0, withActualTimes: 0, scheduled: 0, actual: 0 };
      if (d.status === "Completed") {
        counts.completed += 1;
        if (!d.missingActuals) counts.withActualTimes += 1;
      }
      if (d.countsInJobHours) {
        counts.appointments += 1;
        if (d.scheduledMinutes !== null && d.actualMinutes !== null) {
          counts.scheduled += d.scheduledMinutes;
          counts.actual += d.actualMinutes;
        }
        const jobs = jobsByTech.get(id) ?? { all: [], chargeable: [], byKind: { chargeable: [], zero_value: [], no_value: [] } };
        const interval = { start: ms(d.actualStart), end: ms(d.actualEnd) };
        jobs.all.push(interval);
        jobs.byKind[d.chargeability].push(interval);
        if (d.chargeability === "chargeable") jobs.chargeable.push(interval);
        jobsByTech.set(id, jobs);
      }
      perTechCounts.set(id, counts);
    }
  }

  const jobMinutesBy: Record<Chargeability, number> = { chargeable: 0, zero_value: 0, no_value: 0 };
  const trend = new Map<string, TrendPoint>();
  const technicians: TechnicianUtilization[] = [];

  for (const avail of input.availability) {
    const jobs = jobsByTech.get(avail.fsmId);
    const counts = perTechCounts.get(avail.fsmId);
    let jobMinutes = 0;
    let chargeableMinutes = 0;
    let latestWindowEnd = rangeEnd;
    for (const day of avail.days) {
      if (day.status !== "working" || !day.windowStart || !day.windowEnd) continue;
      const ws = Date.parse(day.windowStart);
      const we = Date.parse(day.windowEnd);
      latestWindowEnd = Math.max(latestWindowEnd, we);
      /* A day with nothing available adds nothing to either side. */
      const dayJob = jobs && day.availableMinutes > 0 ? coveredMinutes(ws, we, jobs.all) : 0;
      const dayChargeable = jobs && day.availableMinutes > 0 ? coveredMinutes(ws, we, jobs.chargeable) : 0;
      if (jobs && day.availableMinutes > 0) {
        for (const kind of Object.keys(jobMinutesBy) as Chargeability[]) jobMinutesBy[kind] += coveredMinutes(ws, we, jobs.byKind[kind]);
      }
      jobMinutes += dayJob;
      chargeableMinutes += dayChargeable;

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
      point.jobMinutes += dayJob;
      point.chargeableMinutes += dayChargeable;
      if (day.date < point.from) point.from = day.date;
      if (day.date > point.to) point.to = day.date;
      trend.set(bucket.key, point);
    }
    /* Everything the technician worked in the period, less what fell in a counted window. */
    const allJob = jobs ? coveredMinutes(rangeStart, latestWindowEnd, jobs.all) : 0;
    const outsideShiftMinutes = Math.max(0, allJob - jobMinutes);

    const availableMinutes = avail.totals.availableMinutes;
    /* Someone with nothing available and no work in the period is not in the report. */
    if (availableMinutes === 0 && allJob === 0 && !(counts && counts.completed > 0)) continue;

    const team = teamOf(avail.fsmId);
    technicians.push({
      ...withPercents({ availableMinutes, jobMinutes, chargeableMinutes }),
      fsmId: avail.fsmId,
      name: nameOf(avail.fsmId),
      teamKey: team.key,
      teamName: team.name,
      shiftAssumed: avail.shiftAssumed,
      shiftDays: avail.totals.shiftDays,
      leaveMinutes: avail.totals.leaveMinutes,
      outsideShiftMinutes,
      appointments: counts?.appointments ?? 0,
      completed: counts?.completed ?? 0,
      withActualTimes: counts?.withActualTimes ?? 0,
      completenessPercent: percent(counts?.withActualTimes ?? 0, counts?.completed ?? 0),
      scheduledMinutes: counts?.scheduled ?? 0,
      actualMinutes: counts?.actual ?? 0,
      varianceMinutes: (counts?.actual ?? 0) - (counts?.scheduled ?? 0),
    });
  }

  /* Lowest time utilization first (who has room), nothing-available last. */
  technicians.sort((a, b) => (a.timePercent ?? 1000) - (b.timePercent ?? 1000) || a.name.localeCompare(b.name));

  const teams = new Map<string, TeamUtilization>();
  const blank = () => ({
    technicians: 0,
    availableMinutes: 0,
    jobMinutes: 0,
    chargeableMinutes: 0,
    timePercent: null,
    commercialPercent: null,
    outsideShiftMinutes: 0,
    completed: 0,
    withActualTimes: 0,
    completenessPercent: null,
    varianceMinutes: 0,
    scheduledMinutes: 0,
  });
  const overallSum: Omit<TeamUtilization, "key" | "name"> = blank();
  for (const t of technicians) {
    const team = teams.get(t.teamKey) ?? { key: t.teamKey, name: t.teamName, ...blank() };
    for (const target of [team, overallSum]) {
      target.technicians += 1;
      target.availableMinutes += t.availableMinutes;
      target.jobMinutes += t.jobMinutes;
      target.chargeableMinutes += t.chargeableMinutes;
      target.outsideShiftMinutes += t.outsideShiftMinutes;
      target.completed += t.completed;
      target.withActualTimes += t.withActualTimes;
      target.varianceMinutes += t.varianceMinutes;
      target.scheduledMinutes += t.scheduledMinutes;
    }
    teams.set(t.teamKey, team);
  }
  const finish = <T extends Omit<TeamUtilization, "key" | "name">>(m: T): T => ({
    ...withPercents(m),
    completenessPercent: percent(m.withActualTimes, m.completed),
  });

  return {
    technicians,
    teams: [...teams.values()].map(finish).sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.name.localeCompare(b.name))),
    overall: finish(overallSum),
    trend: [...trend.values()].sort((a, b) => a.key.localeCompare(b.key)).map((p) => withPercents(p)),
    appointments: details.sort((a, b) => (b.actualStart ?? b.scheduledStart ?? "").localeCompare(a.actualStart ?? a.scheduledStart ?? "")),
    jobMinutesBy,
  };
}
