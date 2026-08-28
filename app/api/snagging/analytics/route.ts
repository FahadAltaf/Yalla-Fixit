import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  average,
  inRange,
  loadInspectorNames,
  loadJobsTouchingRange,
  loadReviewQueue,
  loadSnagsForJobs,
  minutesBetween,
  OUTSTANDING_SNAG_STATUSES,
  percentage,
  periodKey,
  periodLabel,
  periodSeries,
  queueBucketOf,
  resolveRange,
  type AnalyticsJob,
  type DateRange,
} from "@/lib/server/snagging/analytics";
import { DELIVERY_SLA_HOURS } from "@/lib/server/snagging/workflow";
import {
  ActionType,
  ResourceType,
  type SnaggingAnalytics,
  type SnaggingAnalyticsGranularity,
  type SnaggingTaskStatus,
} from "@/types/types";

/**
 * Operations analytics (FR-10.01 to FR-10.04).
 *
 * What this endpoint no longer returns is as much the requirement as
 * what it does. The severity and element distributions are gone
 * (FR-10.05): they compare nothing useful across projects, and the
 * client report is where a severity split belongs (FR-7.02). The
 * inspector's snag count is gone too (FR-10.04) — counting snags per
 * inspector measures the building, not the person walking it.
 *
 * Two figures are deliberately live rather than scoped to the selected
 * dates: the review queue and the overdue count. Both are worklists, and
 * a worklist narrowed to last month tells a reviewer there is less
 * waiting than there is.
 */

const GRANULARITIES: SnaggingAnalyticsGranularity[] = ["day", "week", "month"];

const STATUS_ORDER: SnaggingTaskStatus[] = [
  "draft",
  "assigned",
  "in_progress",
  "submitted",
  "in_review",
  "rejected",
  "approved",
  "delivered",
  "cancelled",
];

export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const range = resolveRange(params.get("from"), params.get("to"));
    const granularityParam = params.get("granularity") as SnaggingAnalyticsGranularity | null;
    const granularity =
      granularityParam && GRANULARITIES.includes(granularityParam) ? granularityParam : "day";

    const admin = await createAdminServerClient();
    const [jobs, queue] = await Promise.all([
      loadJobsTouchingRange(admin, range),
      loadReviewQueue(admin),
    ]);

    // Intake — the jobs raised in the period — is what the status split,
    // the developer view and the inspector view are counted over.
    const raised = jobs.filter((job) => inRange(job.created_at, range));
    const snags = await loadSnagsForJobs(
      admin,
      raised.map((job) => job.id),
    );

    const snagsByJob = new Map<string, { total: number; outstanding: number }>();
    const defectsByJob = new Map<string, string[]>();
    for (const snag of snags) {
      const tally = snagsByJob.get(snag.job_id) ?? { total: 0, outstanding: 0 };
      tally.total += 1;
      if (OUTSTANDING_SNAG_STATUSES.has(snag.status)) tally.outstanding += 1;
      snagsByJob.set(snag.job_id, tally);

      const labels = defectsByJob.get(snag.job_id) ?? [];
      labels.push(snag.defect_label ?? "Unclassified");
      defectsByJob.set(snag.job_id, labels);
    }

    const data: SnaggingAnalytics = {
      byStatus: computeByStatus(raised),
      reviewQueue: computeReviewQueue(queue),
      completed: computeCompleted(jobs, range, granularity),
      timeMetrics: computeTimeMetrics(jobs, queue, range),
      byDeveloper: computeByDeveloper(raised, snagsByJob, defectsByJob),
      byInspector: await computeByInspector(admin, raised),
    };

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging analytics error:", error);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}

/** FR-10.01 — jobs by status, every status the period actually used. */
function computeByStatus(raised: AnalyticsJob[]): SnaggingAnalytics["byStatus"] {
  return STATUS_ORDER.map((status) => ({
    status,
    count: raised.filter((job) => job.status === status).length,
  })).filter((entry) => entry.count > 0);
}

/** FR-10.01 — the review queue, aged by how long it has been submitted. */
function computeReviewQueue(queue: AnalyticsJob[]): SnaggingAnalytics["reviewQueue"] {
  const buckets = (["under_24h", "h24_48", "over_48h"] as const).map((bucket) => ({
    bucket,
    count: queue.filter((job) => queueBucketOf(job.submitted_at) === bucket).length,
  }));

  // The queue arrives oldest-first, so the first row with a submission
  // time is the one that has been waiting longest.
  const oldest = queue.find((job) => job.submitted_at)?.submitted_at ?? null;

  return { total: queue.length, oldestSubmittedAt: oldest, buckets };
}

/**
 * FR-10.01 — jobs completed by day, week and month.
 *
 * Completion is counted at approval, not at submission: an inspection
 * that has been sent back for correction is not finished, and counting
 * it at submission would let the same job land in the chart twice.
 */
function computeCompleted(
  jobs: AnalyticsJob[],
  range: DateRange,
  granularity: SnaggingAnalyticsGranularity,
): SnaggingAnalytics["completed"] {
  const completedJobs = jobs.filter((job) => inRange(job.approved_at, range));

  const counts = new Map<string, number>();
  for (const job of completedJobs) {
    const key = periodKey(job.approved_at as string, granularity);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return {
    granularity,
    total: completedJobs.length,
    points: periodSeries(range, granularity).map((period) => ({
      period,
      label: periodLabel(period, granularity),
      count: counts.get(period) ?? 0,
    })),
  };
}

/**
 * FR-10.02 — the five time metrics.
 *
 * Each carries the sample it was taken over. An average of one job and
 * an average of ninety read identically on a card, and the first is not
 * a measurement.
 */
function computeTimeMetrics(
  jobs: AnalyticsJob[],
  queue: AnalyticsJob[],
  range: DateRange,
): SnaggingAnalytics["timeMetrics"] {
  // Time on site: arrival to submission, anchored on the day the walk
  // was submitted.
  const onSite = jobs
    .filter((job) => inRange(job.submitted_at, range))
    .map((job) => minutesBetween(job.started_at, job.submitted_at))
    .filter((value): value is number => value !== null);

  // Submit to approval: how long the office took, anchored on approval.
  const approvedInRange = jobs.filter((job) => inRange(job.approved_at, range));
  const submitToApproval = approvedInRange
    .map((job) => minutesBetween(job.submitted_at, job.approved_at))
    .filter((value): value is number => value !== null);

  // First-time approval: of the jobs approved in the period, how many
  // were never sent back. rejection_count is incremented by the reject
  // route, so zero means it was right the first time.
  const firstTime = approvedInRange.filter((job) => (job.rejection_count ?? 0) === 0).length;

  // Delivery SLA: of the reports that went out, how many made the
  // window. Jobs still undelivered are not counted as misses — they have
  // not failed yet, and folding them in would make the figure move with
  // queue depth rather than with delivery performance.
  const delivered = jobs.filter(
    (job) => inRange(job.delivered_at, range) && job.approved_at !== null,
  );
  const onTime = delivered.filter((job) => {
    const minutes = minutesBetween(job.approved_at, job.delivered_at);
    return minutes !== null && minutes <= DELIVERY_SLA_HOURS * 60;
  }).length;

  return {
    avgMinutesOnSite: average(onSite),
    onSiteSample: onSite.length,
    avgSubmitToApprovalMinutes: average(submitToApproval),
    submitToApprovalSample: submitToApproval.length,
    firstTimeApprovalRate: percentage(firstTime, approvedInRange.length),
    firstTimeApprovalSample: approvedInRange.length,
    deliveredWithin24hRate: percentage(onTime, delivered.length),
    deliveredSample: delivered.length,
    overdueApprovals: queue.filter((job) => queueBucketOf(job.submitted_at) === "over_48h").length,
  };
}

/**
 * FR-10.03 — developer view: units inspected, snags per unit, defect mix.
 *
 * The mix is by defect, and it is scoped to one developer. That is the
 * distinction FR-10.05 draws: a portfolio-wide chart of severities or
 * elements says nothing, whereas "this developer's units keep failing on
 * the same three things" is the conversation the view exists to start.
 */
function computeByDeveloper(
  raised: AnalyticsJob[],
  snagsByJob: Map<string, { total: number; outstanding: number }>,
  defectsByJob: Map<string, string[]>,
): SnaggingAnalytics["byDeveloper"] {
  const developers = new Map<
    string,
    { units: Set<string>; snag_count: number; outstanding_count: number; defects: Map<string, number> }
  >();

  for (const job of raised) {
    const name = job.developer_name?.trim();
    if (!name) continue;

    const entry =
      developers.get(name) ??
      {
        units: new Set<string>(),
        snag_count: 0,
        outstanding_count: 0,
        defects: new Map<string, number>(),
      };
    const tally = snagsByJob.get(job.id) ?? { total: 0, outstanding: 0 };
    // Units, not job rows. A de-snag round and an additional visit are
    // their own rows against the same flat, so counting rows would show
    // a developer two units where there is one and halve the snag rate
    // on the unit that needed going back to.
    entry.units.add(job.parent_job_id ?? job.id);
    entry.snag_count += tally.total;
    entry.outstanding_count += tally.outstanding;
    for (const label of defectsByJob.get(job.id) ?? []) {
      entry.defects.set(label, (entry.defects.get(label) ?? 0) + 1);
    }
    developers.set(name, entry);
  }

  return [...developers.entries()]
    .map(([developer_name, value]) => ({
      developer_name,
      unit_count: value.units.size,
      snag_count: value.snag_count,
      snags_per_unit: value.units.size
        ? Math.round((value.snag_count / value.units.size) * 100) / 100
        : 0,
      outstanding_count: value.outstanding_count,
      defect_mix: [...value.defects.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5),
    }))
    .sort((a, b) => b.snags_per_unit - a.snags_per_unit);
}

/**
 * FR-10.04 — inspector view: how many inspections, and how long each
 * took. Snag count is absent by requirement, not by oversight.
 */
async function computeByInspector(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
  raised: AnalyticsJob[],
): Promise<SnaggingAnalytics["byInspector"]> {
  const inspectors = new Map<string, { inspection_count: number; minutes: number[] }>();

  for (const job of raised) {
    if (!job.inspector_id) continue;
    const entry = inspectors.get(job.inspector_id) ?? { inspection_count: 0, minutes: [] };
    entry.inspection_count += 1;
    const minutes = minutesBetween(job.started_at, job.submitted_at);
    if (minutes !== null) entry.minutes.push(minutes);
    inspectors.set(job.inspector_id, entry);
  }

  if (inspectors.size === 0) return [];
  const names = await loadInspectorNames(admin, [...inspectors.keys()]);

  return [...inspectors.entries()]
    .map(([user_id, value]) => ({
      user_id,
      name: names.get(user_id) ?? "Unknown",
      inspection_count: value.inspection_count,
      avgMinutesPerInspection: average(value.minutes),
      timedSample: value.minutes.length,
    }))
    .sort((a, b) => b.inspection_count - a.inspection_count);
}
