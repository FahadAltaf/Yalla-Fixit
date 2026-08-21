import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType, type SnaggingOverview } from "@/types/types";

/**
 * Everything the "Today at a glance" screen needs, in one request.
 *
 * The dashboard is the first thing an ops lead opens in the morning, so
 * it reads once rather than firing several queries the browser has to
 * waterfall. The status counts come back as head-only queries against
 * snagging_jobs; the review-queue rows are enriched with their client
 * name and per-job snag/photo tallies in JS.
 */
export async function GET(req: NextRequest) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const admin = await createAdminServerClient();

    const [
      assigned,
      inProgress,
      submitted,
      approved,
      needsCorrection,
      waitingRows,
      snagRows,
      roundsOutstanding,
      photoCount,
    ] = await Promise.all([
      countJobs(admin, ["assigned"]),
      countJobs(admin, ["in_progress"]),
      countJobs(admin, ["submitted", "in_review"]),
      countJobs(admin, ["approved", "delivered"]),
      countJobs(admin, ["rejected"]),

      // The review queue itself, oldest submission first.
      admin
        .from("snagging_jobs")
        .select("id, code, unit_label, building_name, client_id, submitted_at")
        .in("status", ["submitted", "in_review"])
        .order("submitted_at", { ascending: true, nullsFirst: false })
        .limit(6),

      admin.from("snagging_snags").select("severity, status"),

      // De-snag rounds opened and not yet signed off. Scoped to visit_type
      // so an additional visit (also round_number > 1) is not counted here.
      admin
        .from("snagging_jobs")
        .select("id", { count: "exact", head: true })
        .eq("visit_type", "desnag")
        .in("status", ["assigned", "in_progress", "submitted", "in_review", "rejected"]),

      admin.from("snagging_snag_photos").select("id", { count: "exact", head: true }),
    ]);

    if (waitingRows.error) throw new Error(waitingRows.error.message);
    if (snagRows.error) throw new Error(snagRows.error.message);

    const waiting = waitingRows.data ?? [];
    const waitingIds = waiting.map((row) => row.id);

    // Resolve the client name and the per-job snag/photo tallies the
    // review queue shows, in one pass each rather than per row.
    const clientIds = Array.from(
      new Set(waiting.map((row) => row.client_id).filter((v): v is string => Boolean(v))),
    );

    const [clientsResult, queueSnags, queuePhotos] = await Promise.all([
      clientIds.length
        ? admin.from("snagging_clients").select("id, name").in("id", clientIds)
        : Promise.resolve({ data: [], error: null } as const),
      waitingIds.length
        ? admin.from("snagging_snags").select("job_id, severity").in("job_id", waitingIds)
        : Promise.resolve({ data: [], error: null } as const),
      waitingIds.length
        ? admin.from("snagging_snag_photos").select("job_id").in("job_id", waitingIds)
        : Promise.resolve({ data: [], error: null } as const),
    ]);

    if (clientsResult.error) throw new Error(clientsResult.error.message);
    if (queueSnags.error) throw new Error(queueSnags.error.message);
    if (queuePhotos.error) throw new Error(queuePhotos.error.message);

    const clientNames = new Map(
      (clientsResult.data ?? []).map((c) => [c.id, c.name] as const),
    );

    const snagCountByJob = new Map<string, number>();
    const highSeverityByJob = new Map<string, number>();
    for (const snag of queueSnags.data ?? []) {
      snagCountByJob.set(snag.job_id, (snagCountByJob.get(snag.job_id) ?? 0) + 1);
      if (snag.severity === "high") {
        highSeverityByJob.set(snag.job_id, (highSeverityByJob.get(snag.job_id) ?? 0) + 1);
      }
    }

    const photoCountByJob = new Map<string, number>();
    for (const photo of queuePhotos.data ?? []) {
      photoCountByJob.set(photo.job_id, (photoCountByJob.get(photo.job_id) ?? 0) + 1);
    }

    const snags = snagRows.data ?? [];
    const openStatuses = new Set([
      "open",
      "pending_verification",
      "verified_poor_quality",
      "verified_not_done",
    ]);
    const openSnags = snags.filter((snag) => openStatuses.has(snag.status));

    const severity = (["high", "medium", "low"] as const).map((level) => ({
      severity: level,
      count: openSnags.filter((snag) => snag.severity === level).length,
    }));

    const data: SnaggingOverview = {
      counts: {
        assigned,
        inProgress,
        submitted,
        approved,
        needsCorrection,
        // The approval SLA clock was dropped in the lean schema, so
        // there is nothing to measure "overdue" against any more.
        overdue: 0,
      },
      waitingOnReview: waiting.map((row) => ({
        id: row.id,
        code: row.code,
        unit_label: row.unit_label,
        building_name: row.building_name,
        client_name: (row.client_id && clientNames.get(row.client_id)) || "",
        submitted_at: row.submitted_at,
        // approval_due_at no longer exists on the job.
        approval_due_at: null,
        high_severity_count: highSeverityByJob.get(row.id) ?? 0,
        snag_count: snagCountByJob.get(row.id) ?? 0,
        photo_count: photoCountByJob.get(row.id) ?? 0,
      })),
      severity,
      openSnagTotal: openSnags.length,
      snagTotal: snags.length,
      roundsOutstanding: roundsOutstanding.count ?? 0,
      // The verification history that fed the first-time pass rate is no
      // longer stored, so the metric is unavailable.
      passRate: null,
      sync: {
        photosReceived: photoCount.count ?? 0,
        // The sync-mutation error queue is not part of the lean schema.
        stuckInError: 0,
      },
    };

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging overview error:", error);
    return NextResponse.json({ error: "Failed to load the overview" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

async function countJobs(admin: Admin, statuses: string[]): Promise<number> {
  const { count, error } = await admin
    .from("snagging_jobs")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
