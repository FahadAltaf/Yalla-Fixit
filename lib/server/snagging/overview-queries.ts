import type { SupabaseClient } from "@supabase/supabase-js";

import type { SnaggingTaskStatus } from "@/types/types";

/**
 * Shared query helpers for the Snagging Overview sections.
 *
 * Every section endpoint reads through here so they count the same way,
 * and so the counting stays in Postgres. Each helper issues a head-only
 * query — `count: "exact", head: true` returns the number and no rows —
 * which is what keeps the page honest as the table grows from nine jobs
 * to nine thousand. Nothing on this page pulls a row set back to count
 * its length in JavaScript.
 */

export type Admin = SupabaseClient;

/** A window of days ending today, in the shape PostgREST wants. */
export type Period = {
  days: number;
  fromTs: string;
  toTs: string;
  /** The equally sized window immediately before this one, for trends. */
  previousFromTs: string;
  previousToTs: string;
};

export function resolvePeriod(daysParam: string | null, fallback = 30): Period {
  const raw = Number(daysParam);
  const days = Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.floor(raw)) : fallback;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const from = now - days * dayMs;
  return {
    days,
    fromTs: new Date(from).toISOString(),
    toTs: new Date(now).toISOString(),
    previousFromTs: new Date(from - days * dayMs).toISOString(),
    previousToTs: new Date(from).toISOString(),
  };
}

/** Start of today in UTC, for the "assigned today" style counters. */
export function startOfToday(): string {
  return `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;
}

type Refine<T> = (query: T) => T;

/**
 * COUNT(*) over snagging_jobs, refined by the caller.
 *
 * Typed loosely on purpose: the Supabase builder's type changes shape
 * with every filter, and pinning it here would make each call site
 * fight the compiler for no benefit — the query never leaves this file's
 * callers.
 */
export async function countJobs(
  admin: Admin,
  refine: Refine<any> = (query) => query,
): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_jobs").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** COUNT(*) over snagging_snags, refined by the caller. */
export async function countSnags(
  admin: Admin,
  refine: Refine<any> = (query) => query,
): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_snags").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** A percentage change between two counts, or null when there is no base. */
export function trendPercent(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

/** The pipeline stages, in the order work moves through them. */
export const PIPELINE_STAGES: Array<{ status: SnaggingTaskStatus; label: string }> = [
  { status: "assigned", label: "Assigned" },
  { status: "in_progress", label: "In progress" },
  { status: "submitted", label: "Submitted" },
  { status: "in_review", label: "In review" },
  { status: "approved", label: "Approved" },
  { status: "delivered", label: "Delivered" },
];

/** Snag statuses that mean the defect is still outstanding. */
export const OPEN_SNAG_STATUSES = [
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
];

/** Snag statuses that mean the defect was closed off. */
export const RESOLVED_SNAG_STATUSES = ["verified_closed", "withdrawn"];

/**
 * The six trade categories the restructured catalogue is built around
 * (BRD v7), and the element codes that feed each one today.
 *
 * The catalogue in the database is still area / element / defect — the
 * restructure is on hold pending the new content — so there is no
 * category column to group on yet. Rather than ship a section that
 * renders empty until that lands, each category declares the element
 * codes that roll up into it, and the counts are taken per category
 * directly in Postgres.
 *
 * When the real category column arrives this map is the only thing that
 * changes: the endpoint groups on the column instead of on these lists,
 * and nothing on the client moves. EHS has no element code today, so it
 * reports zero rather than being hidden — a category that exists in the
 * business but not yet in the data is worth showing as empty.
 */
export const CATEGORY_ELEMENTS: Array<{ category: string; elements: string[] }> = [
  { category: "Civil", elements: ["WL", "CL", "FL", "PT", "SK", "DR", "WN", "JN", "BL"] },
  { category: "Electrical", elements: ["EL", "AP"] },
  { category: "Plumbing", elements: ["PL", "SN"] },
  { category: "A/C", elements: ["HV"] },
  { category: "EHS", elements: [] },
  { category: "Outdoor", elements: ["EX"] },
];

/**
 * Cache headers per section.
 *
 * The live worklists revalidate quickly because they are what somebody
 * is acting on; the breakdowns sit longer because a severity split does
 * not meaningfully move minute to minute.
 */
export function cacheHeaders(seconds: number): Record<string, string> {
  return {
    "Cache-Control": `private, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`,
  };
}
