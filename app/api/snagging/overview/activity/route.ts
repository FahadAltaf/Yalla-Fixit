import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { cacheHeaders, resolvePeriod } from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Jobs created against inspections completed, per day, over the window.
 *
 * The window is applied in the query, so a 7-day view never reads a
 * year of rows. Two narrow columns come back — one timestamp per job —
 * and the days are tallied here.
 *
 * This is the one section that does not count in Postgres, because
 * PostgREST cannot GROUP BY date_trunc without a database function, and
 * adding one is a migration. At a few hundred jobs a month the timestamp
 * list is a few kilobytes; if the portfolio reaches the point where it
 * is not, a `snagging_activity_by_day(from, to)` RPC replaces the two
 * reads below and nothing else on the page changes.
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

    const period = resolvePeriod(req.nextUrl.searchParams.get("days"), 30);
    const admin = await createAdminServerClient();

    const [created, completed] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("created_at")
        .gte("created_at", period.fromTs)
        .lte("created_at", period.toTs),
      admin
        .from("snagging_jobs")
        .select("approved_at")
        .not("approved_at", "is", null)
        .gte("approved_at", period.fromTs)
        .lte("approved_at", period.toTs),
    ]);
    if (created.error) throw new Error(created.error.message);
    if (completed.error) throw new Error(completed.error.message);

    const createdByDay = tally((created.data ?? []).map((row) => row.created_at as string));
    const completedByDay = tally((completed.data ?? []).map((row) => row.approved_at as string));

    // Every day in the window, including the quiet ones: a line drawn
    // only through the days that had activity reads as steady flow when
    // it was really two busy days either side of a gap.
    const points: Array<{ day: string; label: string; created: number; completed: number }> = [];
    const cursor = new Date(period.fromTs);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(period.toTs);
    while (cursor <= end) {
      const day = cursor.toISOString().slice(0, 10);
      points.push({
        day,
        label: formatDay(day),
        created: createdByDay.get(day) ?? 0,
        completed: completedByDay.get(day) ?? 0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return NextResponse.json(
      { data: { periodDays: period.days, points } },
      { headers: cacheHeaders(300) },
    );
  } catch (error) {
    console.error("Snagging activity error:", error);
    return NextResponse.json({ error: "Failed to load inspection activity" }, { status: 500 });
  }
}

function tally(timestamps: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of timestamps) {
    const day = value.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]}`;
}
