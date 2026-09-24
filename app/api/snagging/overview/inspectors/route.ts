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
import { hasJobInspectors } from "@/lib/server/snagging/columns";
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
    /*
      The roster is read where 20260923100000 has run, and skipped where it
      has not: naming a missing table fails the whole read, which is this
      panel. Without it the counts fall back to the job's own column, which
      is what they were before several inspectors were possible.
    */
    const roster = await hasJobInspectors(admin);

    const [assignedRows, periodJobs, rosterRows] = await Promise.all([
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
      readAllRows<{ id: string; inspector_id: string | null; status: string }>(
        (from, to) =>
          myJobs(
            admin
              .from("snagging_jobs")
              .select("id, inspector_id, status")
              .gte("created_at", period.fromTs),
            profile.id,
          )
            .order("id")
            .range(from, to) as never,
        "inspector jobs",
      ),
      roster
        ? readAllRows<{
            job_id: string;
            inspector_id: string;
            user_profile: Named | Named[] | null;
          }>(
            (from, to) =>
              admin
                .from("snagging_job_inspectors")
                .select(
                  "job_id, inspector_id, user_profile:inspector_id(full_name, email)",
                )
                .order("job_id")
                .range(from, to) as never,
            "job inspectors",
          )
        : Promise.resolve([]),
    ]);

    const one = <T,>(value: T | T[] | null): T | null =>
      (Array.isArray(value) ? value[0] : value) ?? null;

    const nameById = new Map<string, string>();
    for (const row of rosterRows) {
      if (nameById.has(row.inspector_id)) continue;
      const person = one(row.user_profile);
      nameById.set(
        row.inspector_id,
        person?.full_name ?? person?.email ?? "Unknown",
      );
    }
    for (const row of assignedRows) {
      if (nameById.has(row.inspector_id)) continue;
      const person = one(row.inspector);
      nameById.set(row.inspector_id, person?.full_name ?? person?.email ?? "Unknown");
    }

    // Which inspectors each job belongs to, from the roster.
    const byJob = new Map<string, string[]>();
    for (const row of rosterRows) {
      const list = byJob.get(row.job_id) ?? [];
      list.push(row.inspector_id);
      byJob.set(row.job_id, list);
    }

    /*
      Each figure over the window the page is read through, so "completed"
      is work done in the period rather than a career total that only ever
      goes up.
    */
    const tally = new Map<string, { assigned: number; inProgress: number; completed: number }>();
    for (const id of nameById.keys()) tally.set(id, { assigned: 0, inProgress: 0, completed: 0 });
    for (const job of periodJobs) {
      /*
        Counted once for EACH inspector on the job.

        A job split between two people is work both of them did, so both
        carry it; the totals across the column therefore exceed the job
        count on a split job, which is the honest answer for a per-person
        workload. Falls back to the job's own column for anything raised
        before the roster existed.
      */
      const ids = byJob.get(job.id) ?? (job.inspector_id ? [job.inspector_id] : []);
      for (const id of ids) {
        const counts = tally.get(id);
        if (!counts) continue;
        if (job.status === "assigned") counts.assigned += 1;
        else if (job.status === "in_progress") counts.inProgress += 1;
        else if (job.status === "approved" || job.status === "delivered")
          counts.completed += 1;
      }
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
