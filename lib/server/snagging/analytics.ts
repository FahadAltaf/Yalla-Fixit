import type { SupabaseClient } from "@supabase/supabase-js";

import { APPROVAL_SLA_HOURS } from "@/lib/server/snagging/workflow";
import type { SnaggingAnalyticsGranularity } from "@/types/types";

/**
 * The query layer both analytics endpoints read through (FR-10.01 to
 * FR-10.06).
 *
 * The summary and the drill-down have to agree: if a card says eleven
 * and the list behind it shows nine, the page is worse than no page.
 * So the row shapes, the date anchors and the bucket rules all live
 * here, and the two routes differ only in what they do with the rows.
 */

export type AnalyticsJob = {
  id: string;
  code: string;
  status: string;
  unit_label: string | null;
  building_name: string | null;
  developer_name: string | null;
  inspector_id: string | null;
  parent_job_id: string | null;
  visit_type: string | null;
  round_number: number | null;
  created_at: string;
  started_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  delivered_at: string | null;
  rejection_count: number | null;
};

const JOB_COLUMNS =
  "id, code, status, unit_label, building_name, developer_name, inspector_id, " +
  "parent_job_id, visit_type, round_number, created_at, started_at, submitted_at, " +
  "approved_at, delivered_at, rejection_count";

/** Statuses that mean a job is sitting in the approval queue. */
export const REVIEW_QUEUE_STATUSES = ["submitted", "in_review"];

/** Snag statuses that still count as outstanding work on a unit. */
export const OUTSTANDING_SNAG_STATUSES = new Set([
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
]);

export type DateRange = { from: string; to: string; fromTs: string; toTs: string };

export function resolveRange(fromParam: string | null, toParam: string | null): DateRange {
  const to = toParam ?? new Date().toISOString().slice(0, 10);
  const from = fromParam ?? defaultFrom();
  return {
    from,
    to,
    fromTs: `${from}T00:00:00.000Z`,
    toTs: `${to}T23:59:59.999Z`,
  };
}

function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}

/**
 * Every job the period touches, by any of its four dates.
 *
 * A job raised in June and approved in July belongs to June's intake
 * and to July's throughput. Fetching on `created_at` alone — which is
 * what this endpoint used to do — silently dropped it from the approval
 * and delivery figures, so each metric picks its own anchor from this
 * set rather than sharing one filter.
 */
export async function loadJobsTouchingRange(
  admin: SupabaseClient,
  range: DateRange,
): Promise<AnalyticsJob[]> {
  const anchors = ["created_at", "submitted_at", "approved_at", "delivered_at"]
    .map((column) => `and(${column}.gte.${range.fromTs},${column}.lte.${range.toTs})`)
    .join(",");

  const { data, error } = await admin
    .from("snagging_jobs")
    .select(JOB_COLUMNS)
    .or(anchors)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AnalyticsJob[];
}

/**
 * The approval queue as it stands now.
 *
 * Deliberately not filtered by the page's date range. The queue is a
 * live worklist, and a reviewer who narrows the dates to last week
 * should not be told there is less waiting than there is.
 */
export async function loadReviewQueue(admin: SupabaseClient): Promise<AnalyticsJob[]> {
  const { data, error } = await admin
    .from("snagging_jobs")
    .select(JOB_COLUMNS)
    .in("status", REVIEW_QUEUE_STATUSES)
    .order("submitted_at", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as AnalyticsJob[];
}

/** Snags belonging to the given jobs, for the per-unit and mix figures. */
export async function loadSnagsForJobs(
  admin: SupabaseClient,
  jobIds: string[],
): Promise<Array<{ job_id: string; status: string; defect_label: string | null }>> {
  if (jobIds.length === 0) return [];
  const { data, error } = await admin
    .from("snagging_snags")
    .select("job_id, status, defect_label")
    .in("job_id", jobIds);
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ job_id: string; status: string; defect_label: string | null }>;
}

export async function loadInspectorNames(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await admin
    .from("user_profile")
    .select("id, full_name, email")
    .in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(
    ((data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
      (row) => [row.id, row.full_name ?? row.email ?? "Unknown"] as const,
    ),
  );
}

/** Whether a timestamp falls inside the selected period. */
export function inRange(value: string | null, range: DateRange): boolean {
  if (!value) return false;
  return value >= range.fromTs && value <= range.toTs;
}

export function minutesBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const span = new Date(end).getTime() - new Date(start).getTime();
  // A negative span means the timestamps were written out of order —
  // averaging it in would quietly pull the mean down.
  return Number.isFinite(span) && span >= 0 ? span / 60000 : null;
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function percentage(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 100);
}

export type QueueBucket = "under_24h" | "h24_48" | "over_48h";

/** How long a submission has been queued, in the three bands ops act on. */
export function queueBucketOf(submittedAt: string | null): QueueBucket {
  if (!submittedAt) return "under_24h";
  const hours = (Date.now() - new Date(submittedAt).getTime()) / 3600000;
  if (hours >= APPROVAL_SLA_HOURS) return "over_48h";
  if (hours >= 24) return "h24_48";
  return "under_24h";
}

/**
 * The period key a completion falls in, at the requested grain.
 *
 * Weeks are ISO weeks (Monday start) so a week key means the same thing
 * whoever reads it, rather than drifting with the reader's locale.
 */
export function periodKey(iso: string, granularity: SnaggingAnalyticsGranularity): string {
  const date = new Date(iso);
  if (granularity === "month") return iso.slice(0, 7);
  if (granularity === "day") return iso.slice(0, 10);

  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // getUTCDay() is 0 on Sunday, which ends an ISO week rather than starting one.
  const offset = (monday.getUTCDay() + 6) % 7;
  monday.setUTCDate(monday.getUTCDate() - offset);
  return monday.toISOString().slice(0, 10);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function periodLabel(key: string, granularity: SnaggingAnalyticsGranularity): string {
  if (granularity === "month") {
    const [year, month] = key.split("-");
    return `${MONTHS[Number(month) - 1]} ${year}`;
  }
  const [year, month, day] = key.split("-");
  const short = `${Number(day)} ${MONTHS[Number(month) - 1]}`;
  return granularity === "week" ? `w/c ${short}` : `${short} ${year.slice(2)}`;
}

/**
 * Every period in the range, including the ones nothing happened in.
 *
 * A chart drawn only from the periods that have data reads as steady
 * throughput when it is really two busy days either side of a gap.
 */
export function periodSeries(
  range: DateRange,
  granularity: SnaggingAnalyticsGranularity,
): string[] {
  const keys: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00.000Z`);
  const end = new Date(`${range.to}T00:00:00.000Z`);
  // The caller picks the grain; this only stops a pathological range
  // from walking forever.
  let guard = 0;
  while (cursor <= end && guard < 800) {
    const key = periodKey(cursor.toISOString(), granularity);
    if (keys[keys.length - 1] !== key) keys.push(key);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    guard += 1;
  }
  return keys;
}
