import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { APPROVAL_SLA_HOURS, DELIVERY_SLA_HOURS } from "@/lib/server/snagging/workflow";
import { ActionType, ResourceType, SnaggingAnalytics } from "@/types/types";

/**
 * Operational analytics (§6.7) and the KPIs from §2.3.
 *
 * The lean rebuild dropped the snagging_task_summaries and
 * snagging_developer_quality views, so the distributions and the KPI
 * block are computed here from snagging_jobs + snagging_snags directly
 * and aggregated in JS.
 *
 * The only column the lean schema genuinely lost is approval_due_at;
 * the approval SLA is therefore derived from submitted_at rather than
 * read from a stored deadline, exactly as the review queue does it.
 * rejection_count and delivered_at survived the rebuild, so the
 * first-time-approval and delivery KPIs are computed, not stubbed.
 */

/** Snag statuses that still count as outstanding (open work). */
const OUTSTANDING_STATUSES = new Set([
  "open",
  "pending_verification",
  "verified_poor_quality",
  "verified_not_done",
]);

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
    const from = params.get("from") ?? defaultFrom();
    const to = params.get("to") ?? new Date().toISOString().slice(0, 10);
    const fromTs = `${from}T00:00:00.000Z`;
    const toTs = `${to}T23:59:59.999Z`;

    const admin = await createAdminServerClient();
    const todayStart = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`;

    // FR-6.07 — the same 48h rule the review queue applies, asked as a
    // count. Derived from submitted_at because approval_due_at did not
    // survive the lean rebuild.
    const approvalCutoff = new Date(Date.now() - APPROVAL_SLA_HOURS * 60 * 60 * 1000).toISOString();

    const [openCount, pendingApproval, approvedToday, deliveredCount, overdueApprovals, snagRows, jobRows] =
      await Promise.all([
        countJobs(admin, (q) => q.in("status", ["assigned", "in_progress", "rejected"])),
        countJobs(admin, (q) => q.in("status", ["submitted", "in_review"])),
        countJobs(admin, (q) => q.eq("status", "approved").gte("approved_at", todayStart)),
        countJobs(admin, (q) => q.eq("status", "delivered")),
        countJobs(admin, (q) =>
          q.in("status", ["submitted", "in_review"]).lt("submitted_at", approvalCutoff),
        ),
        // Distribution source: severity + element live on the snag row.
        admin
          .from("snagging_snags")
          .select("severity, catalogue_code, element_label")
          .gte("created_at", fromTs)
          .lte("created_at", toTs),
        // The jobs in range carry the developer, the inspector, and the
        // submit/approve timestamps the KPI block needs.
        admin
          .from("snagging_jobs")
          .select(
            "id, developer_name, building_name, inspector_id, status, submitted_at, approved_at, delivered_at, rejection_count",
          )
          .gte("created_at", fromTs)
          .lte("created_at", toTs),
      ]);

    if (snagRows.error) throw new Error(snagRows.error.message);
    if (jobRows.error) throw new Error(jobRows.error.message);

    const snags = snagRows.data ?? [];
    const jobs = jobRows.data ?? [];

    const bySeverity = (["low", "medium", "high"] as const).map((severity) => ({
      severity,
      count: snags.filter((snag) => snag.severity === severity).length,
    }));

    const elementCounts = new Map<string, { element_label: string; count: number }>();
    for (const snag of snags) {
      // No standalone element_code column any more; the element prefix of
      // the catalogue code (e.g. "WL" in "WL-CRK") stands in for it.
      const elementCode = snag.catalogue_code?.split("-")[0] ?? snag.element_label ?? "unknown";
      const existing = elementCounts.get(elementCode);
      if (existing) existing.count += 1;
      else elementCounts.set(elementCode, { element_label: snag.element_label ?? elementCode, count: 1 });
    }

    const byElement = [...elementCounts.entries()]
      .map(([element_code, value]) => ({ element_code, ...value }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    // Per-job snags for the developer / inspector breakdowns, resolved
    // through the job (snags belong to the job now).
    const jobIds = jobs.map((job) => job.id);
    const { data: jobSnagRows, error: jobSnagError } = jobIds.length
      ? await admin.from("snagging_snags").select("job_id, status").in("job_id", jobIds)
      : { data: [] as Array<{ job_id: string; status: string }>, error: null };
    if (jobSnagError) throw new Error(jobSnagError.message);

    const snagsByJob = new Map<string, { total: number; outstanding: number }>();
    for (const snag of jobSnagRows ?? []) {
      const entry = snagsByJob.get(snag.job_id) ?? { total: 0, outstanding: 0 };
      entry.total += 1;
      if (OUTSTANDING_STATUSES.has(snag.status)) entry.outstanding += 1;
      snagsByJob.set(snag.job_id, entry);
    }

    const byDeveloper = computeDeveloperQuality(jobs, snagsByJob);
    const byInspector = await computeInspectorTotals(admin, jobs, snagsByJob);

    return NextResponse.json({
      data: {
        counts: {
          open: openCount,
          pendingApproval,
          approvedToday,
          delivered: deliveredCount,
          // The approval SLA clock (approval_due_at) was dropped in the
          // lean schema, so there is nothing to measure "overdue" against.
          overdueApprovals,
        },
        bySeverity,
        byElement,
        byDeveloper,
        byInspector,
        kpis: computeKpis(jobs),
      } satisfies SnaggingAnalytics,
    });
  } catch (error) {
    console.error("Snagging analytics error:", error);
    return NextResponse.json({ error: "Failed to load analytics" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;
type JobQuery = ReturnType<ReturnType<Admin["from"]>["select"]>;

type JobRow = {
  id: string;
  developer_name: string | null;
  building_name: string | null;
  inspector_id: string | null;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  delivered_at: string | null;
  rejection_count: number | null;
};

async function countJobs(admin: Admin, refine: (query: JobQuery) => JobQuery): Promise<number> {
  const { count, error } = await refine(
    admin.from("snagging_jobs").select("id", { count: "exact", head: true }) as JobQuery,
  );
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * FR-7 developer quality breakdown, rebuilt from jobs + snags now that
 * the snagging_developer_quality view is gone. One row per developer,
 * ordered by the worst snags-per-unit first.
 */
function computeDeveloperQuality(
  jobs: JobRow[],
  snagsByJob: Map<string, { total: number; outstanding: number }>,
): SnaggingAnalytics["byDeveloper"] {
  const byDeveloper = new Map<
    string,
    { unit_count: number; snag_count: number; outstanding_count: number }
  >();

  for (const job of jobs) {
    const developer = job.developer_name?.trim();
    if (!developer) continue;
    const tally = snagsByJob.get(job.id) ?? { total: 0, outstanding: 0 };
    const existing = byDeveloper.get(developer) ?? {
      unit_count: 0,
      snag_count: 0,
      outstanding_count: 0,
    };
    existing.unit_count += 1;
    existing.snag_count += tally.total;
    existing.outstanding_count += tally.outstanding;
    byDeveloper.set(developer, existing);
  }

  return [...byDeveloper.entries()]
    .map(([developer_name, value]) => ({
      developer_name,
      building_name: null,
      unit_count: value.unit_count,
      snag_count: value.snag_count,
      snags_per_unit: value.unit_count
        ? Math.round((value.snag_count / value.unit_count) * 100) / 100
        : 0,
      outstanding_count: value.outstanding_count,
    }))
    .sort((a, b) => b.snags_per_unit - a.snags_per_unit)
    .slice(0, 20);
}

/**
 * FR-7.01 — distribution by inspector. The single jobs.inspector_id
 * replaces the old snagging_task_assignees join; snag counts come from
 * the inspector's jobs.
 */
async function computeInspectorTotals(
  admin: Admin,
  jobs: JobRow[],
  snagsByJob: Map<string, { total: number; outstanding: number }>,
): Promise<SnaggingAnalytics["byInspector"]> {
  const byInspector = new Map<string, { task_count: number; snag_count: number }>();
  for (const job of jobs) {
    if (!job.inspector_id) continue;
    const tally = snagsByJob.get(job.id) ?? { total: 0, outstanding: 0 };
    const existing = byInspector.get(job.inspector_id) ?? { task_count: 0, snag_count: 0 };
    existing.task_count += 1;
    existing.snag_count += tally.total;
    byInspector.set(job.inspector_id, existing);
  }

  if (byInspector.size === 0) return [];

  const inspectorIds = [...byInspector.keys()];
  const { data: profiles, error } = await admin
    .from("user_profile")
    .select("id, full_name, email")
    .in("id", inspectorIds);
  if (error) throw new Error(error.message);

  const nameById = new Map(
    ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map(
      (row) => [row.id, row.full_name ?? row.email ?? "Unknown"] as const,
    ),
  );

  return [...byInspector.entries()]
    .map(([user_id, value]) => ({
      user_id,
      name: nameById.get(user_id) ?? "Unknown",
      task_count: value.task_count,
      snag_count: value.snag_count,
    }))
    .sort((a, b) => b.task_count - a.task_count);
}

/**
 * §2.3 KPIs.
 *
 * - Preparation time is submit-to-approval, the BRD's measurable proxy
 *   for the 80% reduction target (O2); both timestamps still live on the
 *   job.
 * - First-time approval (O5) and the delivery SLA (O4) relied on the
 *   rejection history and a delivered_at timestamp the lean schema no
 *   longer keeps, so they report null rather than a misleading number.
 */
function computeKpis(jobs: JobRow[]): SnaggingAnalytics["kpis"] {
  const approved = jobs.filter((job) => job.approved_at && job.submitted_at);

  const preparationMinutes = approved.map(
    (job) =>
      (new Date(job.approved_at!).getTime() - new Date(job.submitted_at!).getTime()) / 60000,
  );

  const avgPreparationMinutes = preparationMinutes.length
    ? Math.round(
        preparationMinutes.reduce((sum, value) => sum + value, 0) / preparationMinutes.length,
      )
    : null;

  // §2.3 — how often an inspection is accepted without ever being sent
  // back. rejection_count is incremented by the reject route, so a job
  // that reached approval with a count of zero was right first time.
  // Delivered jobs count too: they were approved on the way through.
  const everApproved = jobs.filter(
    (job) => job.approved_at !== null && job.approved_at !== undefined,
  );
  const firstTimeApprovalRate = everApproved.length
    ? Math.round(
        (everApproved.filter((job) => (job.rejection_count ?? 0) === 0).length /
          everApproved.length) *
          100,
      )
    : null;

  // §2.3 — of the reports that went out, how many made the 24h window
  // between approval and delivery. Jobs still undelivered are not
  // counted as misses here: they have not failed the window yet, and
  // folding them in would make the figure drift with queue depth rather
  // than with delivery performance.
  const delivered = jobs.filter((job) => job.delivered_at && job.approved_at);
  const deliveredWithinSlaRate = delivered.length
    ? Math.round(
        (delivered.filter(
          (job) =>
            new Date(job.delivered_at!).getTime() - new Date(job.approved_at!).getTime() <=
            DELIVERY_SLA_HOURS * 60 * 60 * 1000,
        ).length /
          delivered.length) *
          100,
      )
    : null;

  return {
    avgPreparationMinutes,
    firstTimeApprovalRate,
    deliveredWithinSlaRate,
  };
}

function defaultFrom(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().slice(0, 10);
}
