"use client";

import { useSyncExternalStore } from "react";

import { getOrgTimeZone } from "@/lib/scheduling/org-time";

/**
 * Times in the reports as the person looking at them reads a clock (29 Oct):
 * their own timezone, from the browser, with its name shown. Zoho FSM does
 * the same (its web screens show the FSM user's own zone, US Pacific on the
 * shared account), which is why the same check-in looked a day apart there.
 *
 * Only the display changes. The rules stay in the org's time (Asia/Dubai):
 * a shift day, lateness, the 25th cut-off. A report's "date" is that shift
 * day, as FSM's own Date field is; a time on another day in the viewer's
 * zone carries its date, so a check-out the next morning never reads as
 * the same day.
 */

/** The viewer's zone; the org's while rendering on the server. */
export function viewerTimeZone(): string {
  if (typeof window === "undefined") return getOrgTimeZone();
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || getOrgTimeZone();
  } catch {
    return getOrgTimeZone();
  }
}

/** "GMT+4", "GMT+5", "GMT-7": the zone's offset at that moment (names like "GST" mean different places). */
export function zoneLabel(timeZone = viewerTimeZone(), at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}

const subscribe = () => () => undefined;
/** The viewer's zone and its label, after hydration (the server renders the org's). */
export function useViewerZone(): { timeZone: string; label: string } {
  const timeZone = useSyncExternalStore(subscribe, viewerTimeZone, getOrgTimeZone);
  return { timeZone, label: zoneLabel(timeZone) };
}

const valid = (iso: string | null | undefined): iso is string => Boolean(iso) && Number.isFinite(Date.parse(iso as string));

/** YYYY-MM-DD of an instant in the viewer's zone. */
export function viewerDateString(iso: string, timeZone = viewerTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/**
 * "06:12"; or "29 Oct 06:12" when, in the viewer's zone, it falls on a day
 * other than `day` (YYYY-MM-DD): a check-out after midnight, or a check-in a
 * zone away from Dubai.
 */
export function viewerTime(iso: string | null | undefined, day?: string, timeZone = viewerTimeZone()): string {
  if (!valid(iso)) return "—";
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  if (!day || viewerDateString(iso, timeZone) === day) return time;
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(new Date(iso));
  return `${date} ${time}`;
}

/** "28 Oct 2026", in the viewer's zone. */
export function viewerDate(iso: string | null | undefined, timeZone = viewerTimeZone()): string {
  if (!valid(iso)) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/** "28 Oct 2026, 06:03". */
export function viewerDateTime(iso: string | null | undefined, timeZone = viewerTimeZone()): string {
  if (!valid(iso)) return "—";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
    new Date(iso),
  );
}

/** "24 h 09 m", "45 m", "under a minute": whole minutes, cut as FSM's HH:mm:ss is. */
export function durationLabel(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return "—";
  if (minutes < 1) return "under a minute";
  const whole = Math.floor(minutes);
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
}
