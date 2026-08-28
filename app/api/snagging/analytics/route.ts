import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { CATEGORY_ELEMENTS } from "@/lib/server/snagging/overview-queries";
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
  previousRange,
  queueBucketOf,
  resolveRange,
  type SnagRow,
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
    if (
      !hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const params = req.nextUrl.searchParams;
    const range = resolveRange(params.get("from"), params.get("to"));

    const admin = await createAdminServerClient();
    const [jobs, queue] = await Promise.all([
      loadJobsTouchingRange(admin, range),
      loadReviewQueue(admin),
    ]);

    // Intake — the jobs raised in the period — is what the status split,
    // the developer view and the inspector view are counted over.
    const raised = jobs.filter((job) => inRange(job.created_at, range));

    // The equivalent window before this one, for the period-on-period
    // trends. Fetched rather than derived, because a job raised before
    // the range is not in `jobs` at all.
    const previous = previousRange(range);
    const previousJobs = await loadJobsTouchingRange(admin, previous);
    const raisedBefore = previousJobs.filter((job) =>
      inRange(job.created_at, previous),
    );

    const snags = await loadSnagsForJobs(
      admin,
      raised.map((job) => job.id),
    );

    const snagsByJob = new Map<
      string,
      { total: number; outstanding: number }
    >();
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
      byStatus: computeByStatus(raised, raisedBefore),
      defectCategories: computeDefectCategories(snags),
      reviewQueue: computeReviewQueue(queue),
      completed: computeCompleted(jobs, range),
      timeMetrics: computeTimeMetrics(jobs, queue, range),
      byDeveloper: computeByDeveloper(
        raised,
        raisedBefore,
        snagsByJob,
        defectsByJob,
      ),
      byInspector: await computeByInspector(admin, raised),
    };

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging analytics error:", error);
    return NextResponse.json(
      { error: "Failed to load analytics" },
      { status: 500 },
    );
  }
}

/**
 * FR-10.01 — jobs by status, every status the period actually used,
 * each with its movement against the window before it.
 *
 * The trend is a signed count rather than a percentage: at these
 * volumes "+1" is a fact somebody can check, where "+100%" is one job
 * dressed up as a doubling.
 */
function computeByStatus(
  raised: AnalyticsJob[],
  previous: AnalyticsJob[],
): SnaggingAnalytics["byStatus"] {
  return STATUS_ORDER.map((status) => {
    const count = raised.filter((job) => job.status === status).length;
    const before = previous.filter((job) => job.status === status).length;
    return { status, count, trend: count - before };
  }).filter((entry) => entry.count > 0);
}

/** FR-10.01 — the review queue, aged by how long it has been submitted. */
function computeReviewQueue(
  queue: AnalyticsJob[],
): SnaggingAnalytics["reviewQueue"] {
  const buckets = (["under_24h", "h24_48", "over_48h"] as const).map(
    (bucket) => ({
      bucket,
      count: queue.filter((job) => queueBucketOf(job.submitted_at) === bucket)
        .length,
    }),
  );

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
): SnaggingAnalytics["completed"] {
  const completedJobs = jobs.filter((job) => inRange(job.approved_at, range));

  const series = Object.fromEntries(
    GRANULARITIES.map((granularity) => {
      const counts = new Map<string, number>();
      for (const job of completedJobs) {
        const key = periodKey(job.approved_at as string, granularity);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return [
        granularity,
        periodSeries(range, granularity).map((period) => ({
          period,
          label: periodLabel(period, granularity),
          count: counts.get(period) ?? 0,
        })),
      ];
    }),
  ) as SnaggingAnalytics["completed"]["series"];

  return { total: completedJobs.length, series };
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
  const firstTime = approvedInRange.filter(
    (job) => (job.rejection_count ?? 0) === 0,
  ).length;

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
    overdueApprovals: queue.filter(
      (job) => queueBucketOf(job.submitted_at) === "over_48h",
    ).length,
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
  raisedBefore: AnalyticsJob[],
  snagsByJob: Map<string, { total: number; outstanding: number }>,
  defectsByJob: Map<string, string[]>,
): SnaggingAnalytics["byDeveloper"] {
  // Units the same developer had inspected in the window before this
  // one, counted the same way — by root job, so a revisit is not a unit.
  const unitsBefore = new Map<string, Set<string>>();
  for (const job of raisedBefore) {
    const name = job.developer_name?.trim();
    if (!name) continue;
    const units = unitsBefore.get(name) ?? new Set<string>();
    units.add(job.parent_job_id ?? job.id);
    unitsBefore.set(name, units);
  }

  const lastInspection = new Map<string, string>();
  for (const job of raised) {
    const name = job.developer_name?.trim();
    if (!name) continue;
    // Whichever is the most recent evidence somebody was on site.
    const stamp = job.submitted_at ?? job.started_at ?? job.created_at;
    const current = lastInspection.get(name);
    if (!current || stamp > current) lastInspection.set(name, stamp);
  }

  const developers = new Map<
    string,
    {
      units: Set<string>;
      snag_count: number;
      outstanding_count: number;
      defects: Map<string, number>;
    }
  >();

  for (const job of raised) {
    const name = job.developer_name?.trim();
    if (!name) continue;

    const entry = developers.get(name) ?? {
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
      unit_trend:
        value.units.size - (unitsBefore.get(developer_name)?.size ?? 0),
      last_inspection_at: lastInspection.get(developer_name) ?? null,
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
  const inspectors = new Map<
    string,
    {
      inspection_count: number;
      minutes: number[];
      approvalMinutes: number[];
      approved: number;
      firstTime: number;
    }
  >();

  for (const job of raised) {
    if (!job.inspector_id) continue;
    const entry = inspectors.get(job.inspector_id) ?? {
      inspection_count: 0,
      minutes: [],
      approvalMinutes: [],
      approved: 0,
      firstTime: 0,
    };
    entry.inspection_count += 1;

    const minutes = minutesBetween(job.started_at, job.submitted_at);
    if (minutes !== null) entry.minutes.push(minutes);

    // Approval measures only count jobs that actually reached approval.
    // Averaging over everything assigned would score an inspector down
    // for work still sitting in the office queue.
    if (job.approved_at) {
      entry.approved += 1;
      if ((job.rejection_count ?? 0) === 0) entry.firstTime += 1;
      const turnaround = minutesBetween(job.submitted_at, job.approved_at);
      if (turnaround !== null) entry.approvalMinutes.push(turnaround);
    }

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
      firstTimeApprovalRate: percentage(value.firstTime, value.approved),
      approvalSample: value.approved,
      avgSubmitToApprovalMinutes: average(value.approvalMinutes),
    }))
    .sort((a, b) => b.inspection_count - a.inspection_count);
}

/**
 * FR-10.03 — defect categories across every developer in the range.
 *
 * The per-row pills answer "what does this developer keep failing on";
 * this answers the same question for the portfolio, which otherwise had
 * to be assembled by reading every row's badges. Categories come from
 * the same map the overview uses, so the two pages agree on what counts
 * as Civil.
 */
function computeDefectCategories(
  snags: SnagRow[],
): SnaggingAnalytics["defectCategories"] {
  const elementOf = (code: string | null) => code?.split("-")[1] ?? null;

  const counts = new Map<string, number>();
  for (const { category } of CATEGORY_ELEMENTS) counts.set(category, 0);

  for (const snag of snags) {
    const element = elementOf(snag.catalogue_code);
    if (!element) continue;
    const match = CATEGORY_ELEMENTS.find((entry) =>
      entry.elements.includes(element),
    );
    if (!match) continue;
    counts.set(match.category, (counts.get(match.category) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}
