import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { fsmJobSyncReady, syncJobToFsm } from "@/lib/server/snagging/fsm-job-sync";
import { fsmSyncEnabled } from "@/lib/server/snagging/fsm-quotation-sync";
import { ActionType, ResourceType } from "@/types/types";

/**
 * An approved job in Zoho FSM (SNG-189).
 *
 * GET: the work order, its status, the report version attached, the last
 * error and the job's FSM sync log. POST: sync it now (Retry).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const enabled = fsmSyncEnabled();
    const ready = await fsmJobSyncReady(admin);
    if (!ready) return NextResponse.json({ data: { enabled, ready, job: null, log: [] } });

    const [{ data: job, error }, { data: log, error: logError }] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("status, fsm_work_order_id, fsm_work_order_number, fsm_status, fsm_report_version, fsm_synced_at, fsm_error")
        .eq("id", id)
        .maybeSingle(),
      admin
        .from("snagging_fsm_sync_log")
        .select("id, action, status, fsm_record_id, message, created_at, actor:actor_id(full_name, email)")
        .eq("job_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    if (error) throw new Error(error.message);
    if (logError) throw new Error(logError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json({ data: { enabled, ready, job, log: log ?? [] } });
  } catch (error) {
    console.error("Snagging job FSM GET error:", error);
    return NextResponse.json({ error: "Failed to load the FSM sync" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const result = await syncJobToFsm(admin, id, { actorId: profile.id });
    return NextResponse.json({ data: result }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error("Snagging job FSM POST error:", error);
    return NextResponse.json({ error: "Failed to sync with Zoho FSM" }, { status: 500 });
  }
}
