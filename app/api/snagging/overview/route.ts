import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { ActionType, ResourceType, type SnaggingOverview } from "@/types/types";

/**
 * Everything the "Today at a glance" screen needs, in one request.
 *
 * The dashboard is the first thing an ops lead opens in the morning, so
 * it reads once rather than firing six queries the browser has to
 * waterfall. The counts come back as head-only queries: none of them
 * pull rows the screen only intends to length().
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
    const now = new Date().toISOString();
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [
      assigned,
      inProgress,
      submitted,
      approved,
      needsCorrection,
      overdue,
      waitingRows,
      snagRows,
      roundsOutstanding,
      verifications,
      rejectedMutations,
      photoCount,
    ] = await Promise.all([
      countTasks(admin, ["assigned"]),
      countTasks(admin, ["in_progress"]),
      countTasks(admin, ["submitted", "in_review"]),
      countTasks(admin, ["approved", "delivered"]),
      countTasks(admin, ["rejected"]),
      admin
        .from("snagging_tasks")
        .select("id", { count: "exact", head: true })
        .in("status", ["submitted", "in_review"])
        .lt("approval_due_at", now),

      // The review queue itself, oldest deadline first.
      admin
        .from("snagging_task_summaries")
        .select(
          `id, code, unit_label, building_name, client_name, submitted_at,
           high_severity_count, snag_count, photo_count, approval_due_at`,
        )
        .in("status", ["submitted", "in_review"])
        .order("submitted_at", { ascending: true, nullsFirst: false })
        .limit(6),

      admin.from("snagging_snags").select("severity, status"),

      // Rounds opened and not yet signed off.
      admin
        .from("snagging_tasks")
        .select("id", { count: "exact", head: true })
        .gt("round_number", 1)
        .in("status", ["assigned", "in_progress", "submitted", "in_review", "rejected"]),

      admin
        .from("snagging_snag_verifications")
        .select("verdict")
        .gte("created_at", thirtyDaysAgo),

      // The honest measure of "stuck": mutations the server refused.
      // A device holding un-sent work is invisible from here by
      // definition, so the tile says what it can actually see.
      admin
        .from("snagging_sync_mutations")
        .select("mutation_id", { count: "exact", head: true })
        .eq("status", "rejected"),

      admin.from("snagging_snag_photos").select("id", { count: "exact", head: true }),
    ]);

    if (waitingRows.error) throw new Error(waitingRows.error.message);
    if (snagRows.error) throw new Error(snagRows.error.message);
    if (verifications.error) throw new Error(verifications.error.message);

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

    // Pass rate: of everything re-inspected in the period, how much the
    // developer actually fixed first time.
    const verdicts = verifications.data ?? [];
    const closed = verdicts.filter((row) => row.verdict === "verified_closed").length;
    const passRate = verdicts.length ? Math.round((closed / verdicts.length) * 100) : null;

    const data: SnaggingOverview = {
      counts: {
        assigned,
        inProgress,
        submitted,
        approved,
        needsCorrection,
        overdue: overdue.count ?? 0,
      },
      waitingOnReview: (waitingRows.data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        unit_label: row.unit_label,
        building_name: row.building_name,
        client_name: row.client_name,
        submitted_at: row.submitted_at,
        approval_due_at: row.approval_due_at,
        high_severity_count: row.high_severity_count ?? 0,
        snag_count: row.snag_count ?? 0,
        photo_count: row.photo_count ?? 0,
      })),
      severity,
      openSnagTotal: openSnags.length,
      snagTotal: snags.length,
      roundsOutstanding: roundsOutstanding.count ?? 0,
      passRate,
      sync: {
        photosReceived: photoCount.count ?? 0,
        stuckInError: rejectedMutations.count ?? 0,
      },
    };

    return NextResponse.json({ data });
  } catch (error) {
    console.error("Snagging overview error:", error);
    return NextResponse.json({ error: "Failed to load the overview" }, { status: 500 });
  }
}

type Admin = Awaited<ReturnType<typeof createAdminServerClient>>;

async function countTasks(admin: Admin, statuses: string[]): Promise<number> {
  const { count, error } = await admin
    .from("snagging_tasks")
    .select("id", { count: "exact", head: true })
    .in("status", statuses);

  if (error) throw new Error(error.message);
  return count ?? 0;
}
