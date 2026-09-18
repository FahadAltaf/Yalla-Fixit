// Org-timezone time handling for the scheduling module.
//
// A schedule is planned in the ORG's wall-clock time (settings.org_timezone,
// Asia/Dubai). Instants are safe on their own -- the database stores
// timestamptz and Zoho FSM exchanges ISO strings with an offset -- but every
// conversion between a wall-clock value ("09:00 on the 18th", "today",
// "minutes past midnight") and an instant has to be done in the org's zone.
//
// Doing it with the machine's clock (new Date(`${date}T09:00`), getHours(),
// toLocaleTimeString()) is only right while every laptop and server happens
// to be set to Gulf time: a scheduler abroad, or a UTC-hosted server, would
// read and write shifted times, and FSM would disagree with the board.
//
// So: every such conversion in the module goes through this file. It is pure
// and dependency-free, and works the same in the browser and on the server.

export const DEFAULT_ORG_TIMEZONE = "Asia/Dubai";

// The org's zone for this session. The boards set it from the scheduling
// config when it loads; until then (and on pages that never load the config)
// the default applies, which is the same zone for this org.
let orgTimeZone = DEFAULT_ORG_TIMEZONE;

export function setOrgTimeZone(timeZone?: string | null) {
  if (!timeZone) return;
  try {
    // Throws a RangeError for a zone name the runtime doesn't know.
    new Intl.DateTimeFormat("en-US", { timeZone });
    orgTimeZone = timeZone;
  } catch {
    // Keep the current zone rather than break every time on the board.
  }
}

export function getOrgTimeZone() {
  return orgTimeZone;
}

type Instant = Date | number | string;

function toDate(at: Instant) {
  return at instanceof Date ? at : new Date(at);
}

// The zone's UTC offset, in minutes, at a given instant (+240 for Dubai).
export function zoneOffsetMinutes(at: Instant, timeZone: string = orgTimeZone): number {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(toDate(at))
        .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
    const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
    if (!match) return 0; // plain "GMT" = UTC
    return (match[1] === "-" ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
  } catch {
    return 0;
  }
}

// A Date whose UTC fields read as the zone's wall clock at that instant.
function shiftedToZone(at: Instant, timeZone: string) {
  const date = toDate(at);
  return new Date(date.getTime() + zoneOffsetMinutes(date, timeZone) * 60_000);
}

/** "2026-09-18" + "09:00" in the org's zone -> the instant (05:00Z for Dubai). */
export function zonedTimeToUtc(date: string, time = "00:00:00", timeZone: string = orgTimeZone): Date {
  const clock = time.length === 5 ? `${time}:00` : time;
  const asIfUtc = Date.parse(`${date}T${clock}Z`);
  // Two passes, so a zone with daylight saving resolves its offset at the
  // real instant rather than at the first guess. (The Gulf has none.)
  const guess = zoneOffsetMinutes(asIfUtc, timeZone);
  const offset = zoneOffsetMinutes(asIfUtc - guess * 60_000, timeZone);
  return new Date(asIfUtc - offset * 60_000);
}

/** The calendar date (YYYY-MM-DD) an instant falls on in the org's zone. */
export function zonedDateString(at: Instant, timeZone: string = orgTimeZone): string {
  return shiftedToZone(at, timeZone).toISOString().slice(0, 10);
}

/** Minutes past midnight of an instant, read in the org's zone. */
export function zonedMinutesOfDay(at: Instant, timeZone: string = orgTimeZone): number {
  const shifted = shiftedToZone(at, timeZone);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "HH:mm" of an instant in the org's zone (the value a time input expects). */
export function zonedHhmm(at: Instant, timeZone: string = orgTimeZone): string {
  return shiftedToZone(at, timeZone).toISOString().slice(11, 16);
}

/** Today's date (YYYY-MM-DD) in the org's zone. */
export function todayInZone(timeZone: string = orgTimeZone): string {
  return zonedDateString(Date.now(), timeZone);
}

/** Calendar arithmetic on a YYYY-MM-DD string; no timezone involved at all. */
export function addDaysToDateString(date: string, delta: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/**
 * The instant `minutes` past midnight on an org-zone date, as ISO. Minutes
 * beyond 1440 roll into the next day (a bar dragged across midnight).
 */
export function isoAtZonedMinutes(date: string, minutes: number, timeZone: string = orgTimeZone): string {
  return new Date(zonedTimeToUtc(date, "00:00:00", timeZone).getTime() + minutes * 60_000).toISOString();
}

// Human-readable formatting, always in the org's zone (never the viewer's).

export function formatZonedDate(
  at: Instant,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
  timeZone: string = orgTimeZone,
): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(toDate(at));
}

export function formatZonedTime(
  at: Instant,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
  timeZone: string = orgTimeZone,
): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(toDate(at));
}

export function formatZonedDateTime(at: Instant, timeZone: string = orgTimeZone): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone }).format(toDate(at));
}
