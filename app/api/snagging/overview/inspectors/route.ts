import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  countJobs,
  myJobs,
  resolvePeriod,
} from "@/lib/server/snagging/overview-queries";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Assigned / in progress / completed, per inspector, one page at a time.
 *
 * The counts are COUNT(*) in Postgres and only for the inspectors on the
 * page, so the work done is bounded by page size rather than by how many
 * inspectors the business has. `rowCount` comes back so the table can
 * page the same way every other table in the app does.
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

    const params = req.nextUrl.searchParams;
    const period = resolvePeriod(params.get("days"));
    const page = Math.max(0, Number(params.get("page") ?? 0));
    const pageSize = Math.min(50, Math.max(1, Number(params.get("pageSize") ?? 10)));

    const admin = await createAdminServerClient();

    // Who has ever been assigned work. One narrow column, then reduced to
    // the distinct set — PostgREST has no DISTINCT, and the alternative
    // (a view or an RPC) is a migration.
    const { data: assignedRows, error: assignedError } = await admin
      .from("snagging_jobs")
      .select("inspector_id")
      .not("inspector_id", "is", null);
    if (assignedError) throw new Error(assignedError.message);

    const inspectorIds = [
      ...new Set((assignedRows ?? []).map((row) => row.inspector_id as string)),
    ];
    const rowCount = inspectorIds.length;
    const pageIds = inspectorIds.slice(page * pageSize, page * pageSize + pageSize);

    if (pageIds.length === 0) {
      return NextResponse.json({ data: { rows: [], rowCount } }, { headers: cacheHeaders(600) });
    }

    const { data: profiles, error: profileError } = await admin
      .from("user_profile")
      .select("id, full_name, email")
      .in("id", pageIds);
    if (profileError) throw new Error(profileError.message);

    const nameById = new Map(
      ((profiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)
        .map((row) => [row.id, row.full_name ?? row.email ?? "Unknown"] as const),
    );

    const rows = await Promise.all(
      pageIds.map(async (id) => {
        /*
          Each figure over the window the page is read through, so
          "completed" is work done in the period rather than a career
          total that only ever goes up.

          The chain is written out three times rather than hoisted into a
          helper: countJobs hands its refiner a builder type that is
          awkward to name, and a local alias for it costs more than the
          repetition saves.
        */
        const [assigned, inProgress, completed] = await Promise.all([
          countJobs(admin, (q) =>
            myJobs(q, profile.id)
              .eq("inspector_id", id)
              .gte("created_at", period.fromTs)
              .eq("status", "assigned"),
          ),
          countJobs(admin, (q) =>
            myJobs(q, profile.id)
              .eq("inspector_id", id)
              .gte("created_at", period.fromTs)
              .eq("status", "in_progress"),
          ),
          countJobs(admin, (q) =>
            myJobs(q, profile.id)
              .eq("inspector_id", id)
              .gte("created_at", period.fromTs)
              .in("status", ["approved", "delivered"]),
          ),
        ]);
        return {
          id,
          name: nameById.get(id) ?? "Unknown",
          assigned,
          inProgress,
          completed,
        };
      }),
    );

    rows.sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));

    return NextResponse.json(
      { data: { rows, rowCount, periodDays: period.days } },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Inspector performance error:", error);
    return NextResponse.json({ error: "Failed to load inspector performance" }, { status: 500 });
  }
}
