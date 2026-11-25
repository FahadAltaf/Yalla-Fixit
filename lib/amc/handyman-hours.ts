import { z } from "zod";

/**
 * Free handyman hours (DEV-495, confirmed 24 Nov 2026).
 *
 *   * The allowance is counted in hours: the actual hours used come off it,
 *     and the hours left show when a handyman job is booked.
 *   * A handyman team is one technician and one helper. Two teams working
 *     one hour count as two hours: usage is team-hours, not clock time.
 *   * The technician records the actual time on site (arrived and completed
 *     on the job sheet, in the YFI app). The coordinator records the hours
 *     used, rounded to the nearest whole hour, and a job counts at least one
 *     hour (24 Nov 2026, the user).
 *
 * Until DEV-489 moves handyman jobs onto the Scheduling board, a handyman
 * job is a call out booked against the hours allowance with its number of
 * teams. Pure: used by the API, the screens and the tests.
 */

export const HANDYMAN_TEAM_NOTE = "A team is one technician and one helper. Two teams working one hour count as two hours.";
/**
 * Teams come from the crew (24 Nov 2026, the user): each technician on the
 * crew goes with a helper, so the crew's technicians are the teams. Before a
 * crew is assigned, one team is assumed.
 */
export const HANDYMAN_CREW_NOTE = "Teams are counted from the crew: each technician assigned goes with a helper, one team each.";
export function teamsFromCrew(technicianIds: readonly string[] | null | undefined, booked: number | null = null): { teams: number; fromCrew: boolean } {
  const crew = (technicianIds ?? []).filter(Boolean).length;
  return crew > 0 ? { teams: Math.min(crew, MAX_HANDYMAN_TEAMS), fromCrew: true } : { teams: Math.max(1, booked ?? 1), fromCrew: false };
}
export const MAX_HANDYMAN_TEAMS = 10;

export const handymanTeamsSchema = z.number().int().min(1, "At least one team").max(MAX_HANDYMAN_TEAMS, `At most ${MAX_HANDYMAN_TEAMS} teams`);
/** A handyman job counts at least this many hours. */
export const MIN_HANDYMAN_HOURS = 1;
/** What the coordinator records: whole team-hours, at least one. */
export const hoursUsedSchema = z
  .number()
  .int("Round the hours to a whole number")
  .min(MIN_HANDYMAN_HOURS, "A handyman job counts at least 1 hour")
  .max(500, "That is more than a job can take");

/** The contract's handyman hours allowance: an hours entitlement, the handyman service first. */
export function handymanEntitlement<E extends { entitlementType: string; serviceId: string; serviceLabel?: string | null }>(entitlements: readonly E[]): E | null {
  const hours = entitlements.filter((e) => e.entitlementType === "hours");
  return hours.find((e) => /handyman/i.test(`${e.serviceId} ${e.serviceLabel ?? ""}`)) ?? hours[0] ?? null;
}

/** Minutes on site from the job sheet's arrived and completed times; null when either is missing or out of order. */
export function minutesOnSite(arrivedAt: string | null | undefined, completedAt: string | null | undefined): number | null {
  if (!arrivedAt || !completedAt) return null;
  const ms = Date.parse(completedAt) - Date.parse(arrivedAt);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null;
}

/**
 * The hours to record: the time on site times the teams, rounded to the
 * nearest whole hour (half an hour rounds up), at least one. 1 h 20 min for
 * two teams is 2 h 40 min, so 3 hours; 20 minutes is 1 hour. Null without a
 * time on site.
 */
export function suggestedTeamHours(minutes: number | null, teams: number): number | null {
  if (minutes === null || !(teams >= 1)) return null;
  return Math.max(MIN_HANDYMAN_HOURS, Math.round((minutes * teams) / 60));
}

/** How the hours used fall against what is left: covered by the allowance, and the rest, which the client pays. */
export function splitHandymanHours(hoursUsed: number, remaining: number | null): { covered: number; chargeable: number } {
  if (remaining === null) return { covered: hoursUsed, chargeable: 0 };
  const covered = Math.min(hoursUsed, Math.max(0, Math.floor(remaining * 100) / 100));
  return { covered, chargeable: Math.round((hoursUsed - covered) * 100) / 100 };
}

/** "3 h", "1 h 20 min", "45 min". */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
