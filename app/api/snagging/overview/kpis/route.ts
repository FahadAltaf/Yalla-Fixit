import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countJobs,
  resolvePeriod,
  startOfToday,
  trendPercent,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The five KPI cards.
 *
 * Ten counts, all COUNT(*) in Postgres and all issued together, so the
 * row paints without waiting on any other section. Total and Completed
 * carry a trend against the previous window of the same length; the
 * three middle cards are live states, which have no meaningful "versus
 * last period" and get a supporting fact instead.
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

    const period = resolvePeriod(req.nextUrl.searchParams.get("days"));
    const admin = await createAdminServerClient();
    const today = startOfToday();

    const [
      totalNow,
      totalBefore,
      assigned,
      assignedToday,
      inProgress,
      activeInspectors,
      waitingReview,
      completedNow,
      completedBefore,
    ] = await Promise.all([
      countJobs(admin, (q) => q.gte("created_at", period.fromTs).lte("created_at", period.toTs)),
      countJobs(admin, (q) =>
        q.gte("created_at", period.previousFromTs).lt("created_at", period.previousToTs),
      ),
      countJobs(admin, (q) => q.eq("status", "assigned")),
      countJobs(admin, (q) => q.eq("status", "assigned").gte("created_at", today)),
      countJobs(admin, (q) => q.eq("status", "in_progress")),
      // Distinct inspectors currently walking a unit. The rows are the
      // in-progress jobs only, so this stays small however big the table
      // gets, and it is the one place a row set is genuinely needed —
      // Postgres has no DISTINCT COUNT through PostgREST.
      distinctInspectors(admin),
      countJobs(admin, (q) => q.in("status", ["submitted", "in_review"])),
      countJobs(admin, (q) =>
        q.in("status", ["approved", "delivered"]).gte("approved_at", period.fromTs),
      ),
      countJobs(admin, (q) =>
        q
          .in("status", ["approved", "delivered"])
          .gte("approved_at", period.previousFromTs)
          .lt("approved_at", period.previousToTs),
      ),
    ]);

    return NextResponse.json(
      {
        data: {
          periodDays: period.days,
          total: { value: totalNow, trend: trendPercent(totalNow, totalBefore) },
          assigned: { value: assigned, today: assignedToday },
          inProgress: { value: inProgress, activeInspectors },
          waitingReview: { value: waitingReview },
          completed: { value: completedNow, trend: trendPercent(completedNow, completedBefore) },
        },
      },
      { headers: cacheHeaders(60) },
    );
  } catch (error) {
    console.error("Snagging overview KPI error:", error);
    return NextResponse.json({ error: "Failed to load the headline figures" }, { status: 500 });
  }
}

async function distinctInspectors(
  admin: Awaited<ReturnType<typeof createAdminServerClient>>,
): Promise<number> {
  const { data, error } = await admin
    .from("snagging_jobs")
    .select("inspector_id")
    .eq("status", "in_progress")
    .not("inspector_id", "is", null);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((row) => row.inspector_id as string)).size;
}
