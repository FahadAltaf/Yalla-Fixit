/**
 * The AMC module's clock is Dubai's (26 Nov 2026).
 *
 * The screens printed times on the browser's own clock while the server,
 * the client links, the reports and the messages use Dubai's, so a viewer
 * outside the UAE saw a site visit booked for 18:00 as 19:00 on one tab and
 * 18:00 on the next. Every AMC time on screen, and every date-time typed
 * into an AMC form, is now Dubai time. The UAE keeps no daylight saving, so
 * the offset is always +04:00.
 */

export const DUBAI_TZ = "Asia/Dubai";
const OFFSET = "+04:00";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** The wall-clock parts of an instant in Dubai. */
export function dubaiParts(at: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  /* Dubai is UTC+4 all year: shift and read the UTC fields. */
  const d = new Date(at.getTime() + 4 * 3600 * 1000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
}

const valid = (iso: string | Date | null | undefined): Date | null => {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** "26 Nov 2026, 18:00" in Dubai, or "—". */
export function formatDubaiDateTime(iso: string | Date | null | undefined): string {
  const d = valid(iso);
  if (!d) return "—";
  const p = dubaiParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "26 Nov 18:00" in Dubai, or "—". */
export function formatDubaiShort(iso: string | Date | null | undefined): string {
  const d = valid(iso);
  if (!d) return "—";
  const p = dubaiParts(d);
  return `${p.day} ${MONTHS[p.month - 1]} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "26/11/2026" in Dubai, or "—". */
export function formatDubaiDate(iso: string | Date | null | undefined): string {
  const d = valid(iso);
  if (!d) return "—";
  const p = dubaiParts(d);
  return `${pad(p.day)}/${pad(p.month)}/${p.year}`;
}

/** An instant as a datetime-local value ("2026-11-26T18:00"), on Dubai's clock. */
export function toDubaiInput(iso: string | Date | null | undefined): string {
  const d = valid(iso);
  if (!d) return "";
  const p = dubaiParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** A datetime-local value typed as Dubai time back to an instant (ISO), or null. */
export function fromDubaiInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?/.exec(value);
  if (!m) return null;
  const d = new Date(`${m[1]}T${m[2]}${m[3] ?? ":00"}${OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Now, or `days` from now (at `hour`:00 when given), as a datetime-local value on Dubai's clock. */
export function dubaiInputIn(days = 0, hour?: number, now: Date = new Date()): string {
  const p = dubaiParts(now);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  const date = `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
  return hour === undefined ? `${date}T${pad(p.hour)}:${pad(p.minute)}` : `${date}T${pad(hour)}:00`;
}
