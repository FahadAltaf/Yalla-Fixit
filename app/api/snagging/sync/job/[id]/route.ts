import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction, isAdminUser } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { hasAreaInspector } from "@/lib/server/snagging/columns";
import { loadSyncChildren } from "@/lib/server/snagging/sync-children";
import { loadTaskDetail } from "@/lib/server/snagging/sync-task-detail";
import { isOnJobRoster } from "@/lib/server/snagging/job-roster";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/sync/job/[id] — one job's contents, for the handset.
 *
 * The inspector opens a job the device has not fully synced yet: after an
 * install, after the office assigns it mid-shift, or while the full pull is
 * still running behind the job list. Rather than wait for the whole
 * workload, the app asks for this one job and paints it.
 *
 * Same rows, same wire shape as the sync pull (lib/server/snagging/
 * sync-children), so the app stores them with the code it already has.
 * Read-only: everything the inspector captures still goes back through
 * /api/snagging/sync/push.
 *
 * `since` makes it a delta, for a job already on the device.
 */
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
    const since = req.nextUrl.searchParams.get("since") ?? undefined;
    const admin = await createAdminServerClient();

    /*
      Only a job this inspector is on: the lead, someone booked onto one of
      its visits, or an inspector holding a room on it. The same three ways
      a job reaches the handset through the pull.
    */
    const [{ data: job, error: jobError }, visitBooked, roomHeld, childHeld, onRoster] = await Promise.all([
      admin.from("snagging_jobs").select("id, inspector_id").eq("id", id).maybeSingle(),
      admin
        .from("snagging_job_visits")
        .select("id", { count: "exact", head: true })
        .eq("job_id", id)
        .eq("inspector_id", profile.id)
        .in("status", ["scheduled", "in_progress"]),
      (async () => {
        if (!(await hasAreaInspector(admin))) return { count: 0 };
        return admin
          .from("snagging_areas")
          .select("id", { count: "exact", head: true })
          .eq("job_id", id)
          .eq("inspector_id", profile.id);
      })(),
      /*
        The original of a round or visit this inspector is on. The pull
        hands it over as read-only context (what is already on record),
        and the app now fetches a finished job's contents here on demand.
      */
      admin
        .from("snagging_jobs")
        .select("id", { count: "exact", head: true })
        .eq("parent_job_id", id)
        .eq("inspector_id", profile.id),
      // One of the job's inspectors (the roster), not only the first.
      isOnJobRoster(admin, id, profile.id),
    ]);
    if (jobError) throw new Error(jobError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const mine =
      job.inspector_id === profile.id ||
      (visitBooked.count ?? 0) > 0 ||
      (roomHeld.count ?? 0) > 0 ||
      (childHeld.count ?? 0) > 0 ||
      onRoster ||
      isAdminUser(accessUser);
    if (!mine) {
      return NextResponse.json({ error: "Not assigned to this inspection" }, { status: 403 });
    }

    // Stamped before the reads, so a change made while they run is in the next delta.
    const serverTime = new Date().toISOString();
    /*
      The job screen's fields the list card left out (contacts, the unit,
      the NOC, the team, notes), and what the job contains -- read together.
    */
    const [task, children] = await Promise.all([
      loadTaskDetail(admin, id),
      // Scoped to the caller: one inspector's findings are not another's.
      loadSyncChildren(admin, [id], { since, viewer_id: profile.id }),
    ]);

    return NextResponse.json({
      data: {
        server_time: serverTime,
        task_id: id,
        task,
        ...children,
      },
    });
  } catch (error) {
    console.error("Snagging sync job GET error:", error);
    return NextResponse.json({ error: "Failed to load the job" }, { status: 500 });
  }
}
