/**
 * Sensible starting values for booking a site visit.
 *
 * Every appointment form in this module has the same two requirements: the
 * slot has to be in the future, and it should open on something plausible
 * rather than empty. Both were being worked out per dialog, which is how one
 * of them ended up defaulting to a time that had already passed by the time
 * anybody read it.
 *
 * Dubai does not observe daylight saving, so the offset is a constant rather
 * than something to look up per date.
 */
const GULF_OFFSET_MS = 4 * 60 * 60 * 1000;

/** How far ahead a default slot is placed, so it cannot open in the past. */
const NOTICE_MINUTES = 60;

/** Today in Gulf time, as YYYY-MM-DD — the earliest bookable day. */
export function todayInGulf(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(
    new Date(),
  );
}

/**
 * The next slot a visit could realistically be booked into.
 *
 * An hour's notice from now, rounded up to the next `stepMinutes`, which
 * lands on a time somebody would actually write down. Rolling past midnight
 * carries the date with it — a form opened at 23:40 offers tomorrow morning,
 * not a time yesterday.
 *
 * Gulf wall-clock is expressed as a UTC instant so the arithmetic below
 * reads as the clock an inspector is looking at, then sliced back out.
 */
export function nextBookableSlot(stepMinutes = 30): {
  date: string;
  time: string;
} {
  const gulf = new Date(Date.now() + GULF_OFFSET_MS);
  gulf.setUTCSeconds(0, 0);
  gulf.setUTCMinutes(gulf.getUTCMinutes() + NOTICE_MINUTES);

  const past = gulf.getUTCMinutes() % stepMinutes;
  if (past !== 0) {
    gulf.setUTCMinutes(gulf.getUTCMinutes() + (stepMinutes - past));
  }

  const iso = gulf.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16) };
}

/**
 * The instant a date + time pair refers to, or null when either is missing.
 *
 * Times are entered as the local clock, which is Gulf time for every job
 * this product handles, so the offset is stated rather than left to the
 * browser — a coordinator working from another timezone would otherwise
 * book a slot four hours out from the one they typed.
 */
export function toGulfInstant(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const instant = new Date(`${date}T${time}:00+04:00`);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

/** Whether a chosen date + time has already passed. */
export function isPastSlot(date: string, time: string): boolean {
  const instant = toGulfInstant(date, time);
  if (instant) return instant.getTime() <= Date.now();
  // A date with no time yet: only the day itself can be judged.
  return Boolean(date) && date < todayInGulf();
}
