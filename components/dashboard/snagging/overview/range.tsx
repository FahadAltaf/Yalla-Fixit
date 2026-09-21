"use client";

import { createContext, useContext } from "react";

import { useSection, type Section } from "./use-section";

/**
 * The window the whole Overview is read through.
 *
 * One control at the top of the page instead of a period select on each
 * card. Before this, "Inspection activity" had a 7/30-day select of its
 * own while the KPI row was fixed at 30 and the pipeline counted every
 * job ever raised — three cards side by side, each answering for a
 * different stretch of time, with nothing on screen saying so.
 *
 * It rides in the URL of every request rather than in a provider the
 * sections read directly, because `useSection` is keyed by URL: changing
 * the range changes the key, which refetches and caches each range
 * separately. Flicking back to 30 days is then instant.
 *
 * Two sections deliberately ignore it. "Needs attention" is what is
 * wrong NOW and "Upcoming inspections" is what is booked NEXT; neither
 * is a measurement of a period, and filtering them by one would hide
 * work that still needs doing.
 */
const RangeContext = createContext<number>(30);

export const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
] as const;

export function OverviewRange({
  days,
  children,
}: {
  days: number;
  children: React.ReactNode;
}) {
  return <RangeContext.Provider value={days}>{children}</RangeContext.Provider>;
}

/** The chosen window, for a card that wants to name it in its copy. */
export function useRangeDays(): number {
  return useContext(RangeContext);
}

/** `useSection`, with the page's date range appended to the URL. */
export function useRangedSection<T>(
  url: string,
  options: { staleMs?: number; enabled?: boolean } = {},
): Section<T> {
  const days = useRangeDays();
  const separator = url.includes("?") ? "&" : "?";
  return useSection<T>(`${url}${separator}days=${days}`, options);
}

/** "the last 30 days", "the last 12 months" — for captions. */
export function rangeLabel(days: number): string {
  const match = RANGES.find((range) => range.days === days);
  return match ? match.label : `${days} days`;
}
