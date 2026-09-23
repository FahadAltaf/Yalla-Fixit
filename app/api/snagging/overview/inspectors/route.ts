import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  cacheHeaders,
  myJobs,
  resolvePeriod,
} from "@/lib/server/snagging/overview-queries";
import { readAllRows } from "@/lib/server/snagging/read-all";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Assigned / in progress / completed, per inspector, one page at a time.
 *
 * Counted from the period's jobs in one read, then sorted across every
 * inspector and paged. `rowCount` comes back so the table can page the
 * same way every other table in the app does.
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
    const pageSize = Math.min(
      50,
      Math.max(1, Number(params.get("pageSize") ?? 10)),
    );

    const admin = await createAdminServerClient();

    /*
      Two reads, together, instead of a distinct-inspector read followed by
      three counts per inspector on the page:
        - everyone who has ever been assigned work, with their name, and
        - the period's jobs the reader can see, with their inspector and
          status, counted per inspector here.
      Both are read a page at a time: the API stops at 1,000 rows without
      saying so, and the inspector list used to come back short.
    */
    type Named = { full_name: string | null; email: string | null };
    const [assignedRows, periodJobs] = await Promise.all([
      readAllRows<{ inspector_id: string; inspector: Named | Named[] | null }>(
        (from, to) =>
          admin
            .from("snagging_jobs")
            .select("inspector_id, inspector:inspector_id(full_name, email)")
            .not("inspector_id", "is", null)
            .order("id")
            .range(from, to) as never,
        "inspectors",
      ),
      readAllRows<{ inspector_id: string | null; status: string }>(
        (from, to) =>
          myJobs(
            admin
              .from("snagging_jobs")
              .select("inspector_id, status")
              .not("inspector_id", "is", null)
              .gte("created_at", period.fromTs),
            profile.id,
          )
            .order("id")
            .range(from, to) as never,
        "inspector jobs",
      ),
    ]);

    const nameById = new Map<string, string>();
    for (const row of assignedRows) {
      if (nameById.has(row.inspector_id)) continue;
      const person = Array.isArray(row.inspector) ? row.inspector[0] : row.inspector;
      nameById.set(row.inspector_id, person?.full_name ?? person?.email ?? "Unknown");
    }

    /*
      Each figure over the window the page is read through, so "completed"
      is work done in the period rather than a career total that only ever
      goes up.
    */
    const tally = new Map<string, { assigned: number; inProgress: number; completed: number }>();
    for (const id of nameById.keys()) tally.set(id, { assigned: 0, inProgress: 0, completed: 0 });
    for (const job of periodJobs) {
      const counts = job.inspector_id ? tally.get(job.inspector_id) : undefined;
      if (!counts) continue;
      if (job.status === "assigned") counts.assigned += 1;
      else if (job.status === "in_progress") counts.inProgress += 1;
      else if (job.status === "approved" || job.status === "delivered") counts.completed += 1;
    }

    // Sorted across everyone BEFORE paging, so page two really does carry
    // on from page one. It used to page first and sort each page.
    const everyone = [...tally.entries()]
      .map(([id, counts]) => ({ id, name: nameById.get(id) ?? "Unknown", ...counts }))
      .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name));
    const rowCount = everyone.length;
    const rows = everyone.slice(page * pageSize, page * pageSize + pageSize);

    return NextResponse.json(
      { data: { rows, rowCount, periodDays: period.days } },
      { headers: cacheHeaders(600) },
    );
  } catch (error) {
    console.error("Inspector performance error:", error);
    return NextResponse.json(
      { error: "Failed to load inspector performance" },
      { status: 500 },
    );
  }
}
