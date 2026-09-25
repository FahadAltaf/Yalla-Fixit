import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { loadJobFamily } from "@/lib/server/snagging/job-family";
import { ActionType, ResourceType } from "@/types/types";

/**
 * FR-8.05 — one defect's full status history, for reviewers, managers
 * and operations.
 *
 * A defect outlives the visit it was found on: it is raised on the
 * original inspection, carried into round 2, given a verdict there,
 * carried again into round 3. Each of those is a separate row (BRD 5.2
 * keeps the lasting record on the original and a working copy on each
 * round), so asking one row for its history answers only for one leg.
 *
 * This assembles the whole journey by snag_code across the job family —
 * the code is unique within a job and copied verbatim onto each round,
 * which is what makes the rows one defect.
 */
type Leg = {
  job_id: string;
  job_code: string;
  round_number: number;
  visit_type: string;
  snag_id: string;
  status: string;
  photo_count: number;
  /** Who raised the defect, on the leg it was raised on. */
  recorded_by: string | null;
  /** Who gave this leg's result, and what it was (a de-snag round). */
  verified_by: { name: string; at: string; verdict: string | null } | null;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data: snag, error: snagError } = await admin
      .from("snagging_snags")
      .select("job_id, snag_code")
      .eq("id", id)
      .maybeSingle();
    if (snagError) throw new Error(snagError.message);
    if (!snag)
      return NextResponse.json({ error: "Snag not found" }, { status: 404 });

    const family = await loadJobFamily(admin, snag.job_id as string);

    // Every row for this defect, on any visit in the family.
    const [{ data: jobs }, { data: rows }] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("id, code, round_number, visit_type")
        .in("id", family.allIds),
      // Each leg's photo count comes with it, counted by the database.
      admin
        .from("snagging_snags")
        .select(
          "id, job_id, status, round_created, recorded_by:created_by(full_name, email), photos:snagging_snag_photos(count)",
        )
        .in("job_id", family.allIds)
        .eq("snag_code", snag.snag_code as string),
    ]);

    const jobById = new Map((jobs ?? []).map((job) => [job.id as string, job]));

    /*
      Who gave each leg's result: the audit trail records every verdict with
      the inspector who gave it, against that round's row. Rounds are often
      walked by someone other than the inspector who raised the defect, so
      the history names both. The latest verdict on a leg is the one that
      stands.
    */
    const legIds = (rows ?? []).map((row) => row.id as string);
    const { data: verdicts } = legIds.length
      ? await admin
          .from("snagging_audit_events")
          .select("entity_id, actor_label, created_at, payload")
          .eq("event_type", "snag_verified")
          .in("entity_id", legIds)
          .order("created_at", { ascending: false })
      : { data: [] };
    const verdictByLeg = new Map<string, Record<string, unknown>>();
    for (const v of (verdicts ?? []) as Record<string, unknown>[]) {
      if (!verdictByLeg.has(v.entity_id as string)) verdictByLeg.set(v.entity_id as string, v);
    }
    /*
      Each leg shows how many photos back it. The count arrives with the
      legs (embedded above); it was a separate read of every photo's snag
      id, after the legs had come back. The legs are the whole response:
      both the portal and the phone read nothing else.
    */
    const photoCount = new Map<string, number>(
      ((rows ?? []) as Array<{ id: string; photos?: { count: number }[] | null }>).map(
        (row) => [row.id, row.photos?.[0]?.count ?? 0] as const,
      ),
    );

    /*
      Ordered by the round the leg belongs to, not by when the row was
      written: a round opened late still sits after the round before it,
      and that is the order a reviewer reads the story in.
    */
    const legs: Leg[] = (rows ?? [])
      .map((row) => {
        const job = jobById.get(row.job_id as string);
        const round = (job?.round_number as number) ?? 1;
        const who = (Array.isArray(row.recorded_by) ? row.recorded_by[0] : row.recorded_by) as
          | { full_name?: string | null; email?: string | null }
          | null;
        const verdict = verdictByLeg.get(row.id as string);
        return {
          job_id: row.job_id as string,
          job_code: (job?.code as string) ?? "",
          round_number: (job?.round_number as number) ?? 1,
          visit_type: (job?.visit_type as string) ?? "initial",
          snag_id: row.id as string,
          status: row.status as string,
          photo_count: photoCount.get(row.id as string) ?? 0,
          // A carried copy has no author of its own; only the raising leg names one.
          recorded_by:
            ((row.round_created as number | null) ?? 1) === round
              ? (who?.full_name ?? who?.email ?? null)
              : null,
          verified_by: verdict?.actor_label
            ? {
                name: verdict.actor_label as string,
                at: verdict.created_at as string,
                verdict: ((verdict.payload as { verdict?: string } | null)?.verdict as string) ?? null,
              }
            : null,
        };
      })
      .sort((a, b) => a.round_number - b.round_number);

    return NextResponse.json({ data: { legs } });
  } catch (error) {
    console.error("Snag history GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the defect history" },
      { status: 500 },
    );
  }
}
