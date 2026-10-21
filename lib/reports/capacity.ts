import { addDaysToDateString, zonedTimeToUtc } from "@/lib/scheduling/org-time";

import { coveredMinutes, type DayStatus, type TechnicianAvailability } from "./available-hours";

/**
 * Forward capacity (BRD 5.2 B5; DEV-452): booked against available hours
 * by day and team, for the horizon in Reporting Settings.
 *
 *  - Booked: for each technician, the union of the scheduled times of
 *    their appointments that are not cancelled, by calendar day (Asia/
 *    Dubai), so two bookings at the same time count once. The portal's
 *    night shift (00:00-09:00) lies within one day; a shift crossing
 *    midnight would split its bookings across the two dates.
 *  - Available: the available-hours engine (DEV-443).
 *  - Over-booked: booked above available. Booking a technician on a rest
 *    day, a holiday or leave is over-booking too.
 *  - Spare: booked below the setting's share of available.
 *  - Unassigned: scheduled hours on appointments with no technician,
 *    shown separately, never in a team.
 *
 * N14 is raised for a team's day when it first becomes over-booked.
 * Pure: no database, no clock.
 */

export type CapacityAppointment = {
  id: string;
  number: string | null;
  workOrderNumber: string | null;
  clientName: string | null;
  status: string | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  technicianIds: string[];
};

export type CapacityTechnician = { fsmId: string; name: string; teamLeaderId: string | null };

export type CellStatus = "over" | "spare" | "ok" | "off";

export type CapacityCell = {
  date: string;
  bookedMinutes: number;
  availableMinutes: number;
  status: CellStatus;
  /** Why nothing is available, for a technician's day. */
  dayStatus?: DayStatus;
};

export type CapacityRow = {
  key: string;
  name: string;
  /** Technicians in a team row; the team, in a technician row. */
  technicians?: number;
  teamKey?: string;
  cells: CapacityCell[];
  bookedMinutes: number;
  availableMinutes: number;
  overDays: number;
  spareDays: number;
};

export type CapacityDay = CapacityCell & { unassignedMinutes: number; appointments: number };

export type CapacityResult = {
  dates: string[];
  days: CapacityDay[];
  teams: CapacityRow[];
  technicians: CapacityRow[];
  /** Team days over-booked, for N14. */
  overbooked: Array<{ date: string; teamKey: string; teamName: string; bookedMinutes: number; availableMinutes: number }>;
  totals: {
    bookedMinutes: number;
    availableMinutes: number;
    unassignedMinutes: number;
    overTeamDays: number;
    spareTeamDays: number;
    overTechnicianDays: number;
  };
};

const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

export function cellStatus(bookedMinutes: number, availableMinutes: number, spareBelowPercent: number): CellStatus {
  if (bookedMinutes > availableMinutes) return "over";
  if (availableMinutes === 0) return "off";
  if (bookedMinutes < availableMinutes * (spareBelowPercent / 100)) return "spare";
  return "ok";
}

export const isBooked = (a: CapacityAppointment) => a.status !== "Cancelled";

export function computeCapacity(input: {
  dates: string[];
  availability: TechnicianAvailability[];
  technicians: Map<string, CapacityTechnician>;
  appointments: CapacityAppointment[];
  spareBelowPercent: number;
  timeZone?: string;
}): CapacityResult {
  const bounds = input.dates.map((date) => ({
    date,
    start: zonedTimeToUtc(date, "00:00", input.timeZone).getTime(),
    end: zonedTimeToUtc(addDaysToDateString(date, 1), "00:00", input.timeZone).getTime(),
  }));
  const nameOf = (id: string) => input.technicians.get(id)?.name ?? id;

  type Interval = { start: number; end: number };
  const byTech = new Map<string, Interval[]>();
  const unassigned: Interval[] = [];
  const countByDay = new Map<string, number>();
  for (const a of input.appointments) {
    if (!isBooked(a)) continue;
    const start = ms(a.scheduledStart);
    const end = ms(a.scheduledEnd);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (const b of bounds) if (start < b.end && end > b.start) countByDay.set(b.date, (countByDay.get(b.date) ?? 0) + 1);
    const crew = a.technicianIds.filter((id) => input.technicians.has(id));
    if (a.technicianIds.length === 0) {
      unassigned.push({ start, end });
      continue;
    }
    for (const id of crew) {
      const list = byTech.get(id) ?? [];
      list.push({ start, end });
      byTech.set(id, list);
    }
  }

  const technicians: CapacityRow[] = [];
  const teams = new Map<string, CapacityRow>();
  for (const avail of input.availability) {
    const bookings = byTech.get(avail.fsmId) ?? [];
    const leader = input.technicians.get(avail.fsmId)?.teamLeaderId ?? null;
    const teamKey = leader ?? "none";
    const teamName = leader ? `${nameOf(leader)}'s team` : "No team";
    const cells = bounds.map<CapacityCell>((b, i) => {
      const day = avail.days[i];
      const bookedMinutes = bookings.length ? coveredMinutes(b.start, b.end, bookings) : 0;
      const availableMinutes = day?.availableMinutes ?? 0;
      return {
        date: b.date,
        bookedMinutes,
        availableMinutes,
        status: cellStatus(bookedMinutes, availableMinutes, input.spareBelowPercent),
        dayStatus: day?.status,
      };
    });
    /* A leaver with nothing booked is not on the board. */
    if (cells.every((c) => c.dayStatus === "left" && c.bookedMinutes === 0)) continue;

    const row: CapacityRow = {
      key: avail.fsmId,
      name: nameOf(avail.fsmId),
      teamKey,
      cells,
      bookedMinutes: cells.reduce((s, c) => s + c.bookedMinutes, 0),
      availableMinutes: cells.reduce((s, c) => s + c.availableMinutes, 0),
      overDays: cells.filter((c) => c.status === "over").length,
      spareDays: cells.filter((c) => c.status === "spare").length,
    };
    technicians.push(row);

    const team = teams.get(teamKey) ?? {
      key: teamKey,
      name: teamName,
      technicians: 0,
      cells: bounds.map((b) => ({ date: b.date, bookedMinutes: 0, availableMinutes: 0, status: "off" as CellStatus })),
      bookedMinutes: 0,
      availableMinutes: 0,
      overDays: 0,
      spareDays: 0,
    };
    team.technicians = (team.technicians ?? 0) + 1;
    cells.forEach((c, i) => {
      team.cells[i].bookedMinutes += c.bookedMinutes;
      team.cells[i].availableMinutes += c.availableMinutes;
    });
    teams.set(teamKey, team);
  }

  const teamRows = [...teams.values()]
    .map((team) => {
      const cells = team.cells.map((c) => ({ ...c, status: cellStatus(c.bookedMinutes, c.availableMinutes, input.spareBelowPercent) }));
      return {
        ...team,
        cells,
        bookedMinutes: cells.reduce((s, c) => s + c.bookedMinutes, 0),
        availableMinutes: cells.reduce((s, c) => s + c.availableMinutes, 0),
        overDays: cells.filter((c) => c.status === "over").length,
        spareDays: cells.filter((c) => c.status === "spare").length,
      };
    })
    .sort((a, b) => (a.key === "none" ? 1 : b.key === "none" ? -1 : a.name.localeCompare(b.name)));

  const days = bounds.map<CapacityDay>((b, i) => {
    const bookedMinutes = teamRows.reduce((s, t) => s + t.cells[i].bookedMinutes, 0);
    const availableMinutes = teamRows.reduce((s, t) => s + t.cells[i].availableMinutes, 0);
    return {
      date: b.date,
      bookedMinutes,
      availableMinutes,
      status: cellStatus(bookedMinutes, availableMinutes, input.spareBelowPercent),
      /* Separate jobs: summed, not merged. */
      unassignedMinutes: unassigned.reduce((s, u) => s + coveredMinutes(b.start, b.end, [u]), 0),
      appointments: countByDay.get(b.date) ?? 0,
    };
  });

  const overbooked = teamRows.flatMap((t) =>
    t.cells
      .filter((c) => c.status === "over")
      .map((c) => ({ date: c.date, teamKey: t.key, teamName: t.name, bookedMinutes: c.bookedMinutes, availableMinutes: c.availableMinutes })),
  );

  technicians.sort((a, b) => b.overDays - a.overDays || a.name.localeCompare(b.name));
  return {
    dates: input.dates,
    days,
    teams: teamRows,
    technicians,
    overbooked,
    totals: {
      bookedMinutes: days.reduce((s, d) => s + d.bookedMinutes, 0),
      availableMinutes: days.reduce((s, d) => s + d.availableMinutes, 0),
      unassignedMinutes: days.reduce((s, d) => s + d.unassignedMinutes, 0),
      overTeamDays: overbooked.length,
      spareTeamDays: teamRows.reduce((s, t) => s + t.spareDays, 0),
      overTechnicianDays: technicians.reduce((s, t) => s + t.overDays, 0),
    },
  };
}
