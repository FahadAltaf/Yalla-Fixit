/**
 * Sensible starting values for booking a site visit.
 *
 * Every appointment form in this module has the same two requirements: the
 * slot has to be in the future, and it should open on something plausible
 * rather than empty. Both were being worked out per dialog, which is how one
 * of them ended up defaulting to a time that had already passed by the time
 * anybody read it.
 *
 * Dates and times are typed, and shown back, in the viewer's own time zone
 * (the browser's). They were fixed to Gulf time, so a coordinator outside the
 * UAE typed 10:00 and saw 11:00 everywhere else on the page. Nothing is
 * stored in any zone: a typed date and time becomes an instant here.
 */

/** A Date's local calendar day and clock, as YYYY-MM-DD and HH:mm. */
function localParts(at: Date): { date: string; time: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
    time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
  };
}

/** How far ahead a default slot is placed, so it cannot open in the past. */
const NOTICE_MINUTES = 60;

/** Today on the viewer's clock, as YYYY-MM-DD — the earliest bookable day. */
export function todayLocal(): string {
  return localParts(new Date()).date;
}

/** The viewer's date and time right now, as YYYY-MM-DD and HH:mm. */
export function nowLocal(): { date: string; time: string } {
  return localParts(new Date());
}

/** A stored instant as the viewer's date and time, for a form to edit. */
export function splitInstant(iso: string | null | undefined): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? { date: "", time: "" } : localParts(at);
}

/**
 * The next slot a visit could realistically be booked into.
 *
 * An hour's notice from now, rounded up to the next `stepMinutes`, which
 * lands on a time somebody would actually write down. Rolling past midnight
 * carries the date with it — a form opened at 23:40 offers tomorrow morning,
 * not a time yesterday.
 *
 * On the viewer's own clock, like everything else they type and read.
 */
export function nextBookableSlot(stepMinutes = 30): {
  date: string;
  time: string;
} {
  const at = new Date();
  at.setSeconds(0, 0);
  at.setMinutes(at.getMinutes() + NOTICE_MINUTES);

  const past = at.getMinutes() % stepMinutes;
  if (past !== 0) at.setMinutes(at.getMinutes() + (stepMinutes - past));

  return localParts(at);
}

/**
 * The instant a typed date + time refers to, on the viewer's clock, or null
 * when either is missing. (An ISO date-time with no offset is read as local
 * time.)
 */
export function toLocalInstant(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const instant = new Date(`${date}T${time}:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Whether a chosen date + time has already passed. */
export function isPastSlot(date: string, time: string): boolean {
  const instant = toLocalInstant(date, time);
  if (instant) return instant.getTime() <= Date.now();
  // A date with no time yet: only the day itself can be judged.
  return Boolean(date) && date < todayLocal();
}
