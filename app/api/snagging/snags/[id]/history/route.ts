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
};

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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
      .select("id, job_id, snag_code, element_label, defect_label, severity, status")
      .eq("id", id)
      .maybeSingle();
    if (snagError) throw new Error(snagError.message);
    if (!snag) return NextResponse.json({ error: "Snag not found" }, { status: 404 });

    const family = await loadJobFamily(admin, snag.job_id as string);

    // Every row for this defect, on any visit in the family.
    const [{ data: jobs }, { data: rows }] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("id, code, round_number, visit_type, scheduled_date")
        .in("id", family.allIds),
      admin
        .from("snagging_snags")
        .select("id, job_id, status, updated_at, created_at")
        .in("job_id", family.allIds)
        .eq("snag_code", snag.snag_code as string),
    ]);

    const jobById = new Map((jobs ?? []).map((job) => [job.id as string, job]));
    const snagIds = (rows ?? []).map((row) => row.id as string);

    // Photos and verdict events are the evidence behind each leg.
    const [{ data: photos }, { data: events }] = await Promise.all([
      snagIds.length
        ? admin
            .from("snagging_snag_photos")
            .select("id, snag_id, storage_path, round_number, taken_at")
            .in("snag_id", snagIds)
            .order("taken_at", { ascending: true })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      snagIds.length
        ? admin
            .from("snagging_audit_events")
            .select("id, event_type, actor_label, justification, payload, created_at, entity_id")
            .in("entity_id", snagIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);

    const photoCount = new Map<string, number>();
    for (const photo of photos ?? []) {
      const key = photo.snag_id as string;
      photoCount.set(key, (photoCount.get(key) ?? 0) + 1);
    }

    /*
      Ordered by the round the leg belongs to, not by when the row was
      written: a round opened late still sits after the round before it,
      and that is the order a reviewer reads the story in.
    */
    const legs: Leg[] = (rows ?? [])
      .map((row) => {
        const job = jobById.get(row.job_id as string);
        return {
          job_id: row.job_id as string,
          job_code: (job?.code as string) ?? "",
          round_number: (job?.round_number as number) ?? 1,
          visit_type: (job?.visit_type as string) ?? "initial",
          snag_id: row.id as string,
          status: row.status as string,
          photo_count: photoCount.get(row.id as string) ?? 0,
        };
      })
      .sort((a, b) => a.round_number - b.round_number);

    return NextResponse.json({
      data: {
        snag: {
          id: snag.id,
          snag_code: snag.snag_code,
          element_label: snag.element_label,
          defect_label: snag.defect_label,
          severity: snag.severity,
          status: snag.status,
        },
        legs,
        photos: photos ?? [],
        events: events ?? [],
      },
    });
  } catch (error) {
    console.error("Snag history GET error:", error);
    return NextResponse.json({ error: "Failed to load the defect history" }, { status: 500 });
  }
}
