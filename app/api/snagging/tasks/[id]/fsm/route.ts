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
 * GET: everything this job has in FSM -- its quotation's estimate and the
 * work order, with their status, the report version attached, the last
 * error, and a page of every FSM call linked to the job (?page=&pageSize=):
 * the job's own, its quotations' (inspection, de-snag, additional visits)
 * and its client's (contact, company, addresses). POST: sync it now (Retry).
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
    const params = req.nextUrl.searchParams;
    const page = Math.max(0, Number(params.get("page")) || 0);
    const pageSize = Math.min(Math.max(Number(params.get("pageSize")) || 10, 1), 50);
    if (!ready) {
      return NextResponse.json({ data: { enabled, ready, job: null, estimate: null, log: [], logTotal: 0 } });
    }

    const [{ data: job, error }, { data: quotes, error: quoteError }] = await Promise.all([
      admin
        .from("snagging_jobs")
        .select("status, client_id, fsm_work_order_id, fsm_work_order_number, fsm_status, fsm_report_version, fsm_synced_at, fsm_error")
        .eq("id", id)
        .maybeSingle(),
      // Every quotation on the job; the newest inspection or de-snag one is the estimate it bills.
      admin
        .from("snagging_quotations")
        .select("id, quote_kind, quote_number, fsm_estimate_id, fsm_estimate_number, fsm_status, fsm_synced_at, fsm_error")
        .eq("job_id", id)
        .order("created_at", { ascending: false }),
    ]);
    if (error) throw new Error(error.message);
    if (quoteError) throw new Error(quoteError.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    /*
      Every FSM event linked to the job: its own (work order, report), its
      quotations' (estimates, numbers, revisions, status), and its client's
      that belong to no quotation or job (contact, company, addresses).
    */
    // A de-snag quotation points at the job it de-snags through source_job_id, not job_id.
    const { data: desnags } = await admin.from("snagging_quotations").select("id").eq("source_job_id", id);
    const quoteIds = [...(quotes ?? []), ...(desnags ?? [])].map((q) => q.id as string);
    const clientId = (job as { client_id?: string | null }).client_id ?? null;
    const linked = [
      `job_id.eq.${id}`,
      ...(quoteIds.length ? [`quotation_id.in.(${quoteIds.join(",")})`] : []),
      ...(clientId ? [`and(client_id.eq.${clientId},quotation_id.is.null,job_id.is.null)`] : []),
    ].join(",");
    const from = page * pageSize;
    const { data: log, error: logError, count } = await admin
      .from("snagging_fsm_sync_log")
      .select("id, action, status, fsm_record_id, message, created_at, actor:actor_id(full_name, email)", {
        count: "exact",
      })
      .or(linked)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + pageSize - 1);
    if (logError) throw new Error(logError.message);

    const estimate = (quotes ?? []).find((q) => q.quote_kind !== "visit") ?? null;
    return NextResponse.json({
      data: { enabled, ready, job, estimate, log: log ?? [], logTotal: count ?? 0 },
    });
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
    /*
      A sync that ran and found a problem is an answer, not a failed request:
      a 502 here made the card say only "Request failed (HTTP 502)" instead
      of FSM's reason (result.ok tells the card which it is).
    */
    return NextResponse.json({ data: result });
  } catch (error) {
    console.error("Snagging job FSM POST error:", error);
    return NextResponse.json({ error: "Failed to sync with Zoho FSM" }, { status: 500 });
  }
}
