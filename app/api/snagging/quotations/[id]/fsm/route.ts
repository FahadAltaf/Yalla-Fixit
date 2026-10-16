import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import {
  fsmSyncEnabled,
  fsmSyncReady,
  syncQuotationToFsm,
} from "@/lib/server/snagging/fsm-quotation-sync";
import { ActionType, ResourceType } from "@/types/types";

/**
 * A quotation in Zoho FSM.
 *
 * GET: where its sync stands (the FSM estimate, its status, the last
 * error) and a page of its FSM calls, newest first (?page=&pageSize=): the
 * quotation's own and its client's (contact, company, addresses).
 * POST: sync it now -- the Retry button. Brings FSM in line with the
 * quotation as it is, and answers with the outcome.
 */
async function guard(req: NextRequest, action: ActionType) {
  const { profile, accessUser } = await getRequestUserAccess(req);
  if (!profile || !accessUser) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!hasResourceAction(accessUser, ResourceType.SNAGGING, action)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { profile };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await guard(req, ActionType.VIEW);
    if ("error" in gate) return gate.error;
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const enabled = fsmSyncEnabled();
    const ready = await fsmSyncReady(admin);
    const params = req.nextUrl.searchParams;
    const page = Math.max(0, Number(params.get("page")) || 0);
    const pageSize = Math.min(Math.max(Number(params.get("pageSize")) || 10, 1), 50);
    if (!ready) {
      return NextResponse.json({ data: { enabled, ready, quotation: null, log: [], logTotal: 0 } });
    }
    const { data: quote, error } = await admin
      .from("snagging_quotations")
      .select("client_id, fsm_estimate_id, fsm_estimate_number, fsm_status, fsm_synced_at, fsm_error")
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!quote) return NextResponse.json({ error: "Quotation not found" }, { status: 404 });

    // The quotation's FSM calls, and its client's that belong to no quotation or job.
    const clientId = (quote as { client_id?: string | null }).client_id ?? null;
    const linked = [
      `quotation_id.eq.${id}`,
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
    return NextResponse.json({
      data: { enabled, ready, quotation: quote, log: log ?? [], logTotal: count ?? 0 },
    });
  } catch (error) {
    console.error("Snagging quotation FSM GET error:", error);
    return NextResponse.json({ error: "Failed to load the FSM sync" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const gate = await guard(req, ActionType.EDIT);
    if ("error" in gate) return gate.error;
    const { id } = await ctx.params;
    const admin = await createAdminServerClient();
    const result = await syncQuotationToFsm(admin, id, { actorId: gate.profile.id });
    return NextResponse.json({ data: result }, { status: result.ok ? 200 : 502 });
  } catch (error) {
    console.error("Snagging quotation FSM POST error:", error);
    return NextResponse.json({ error: "Failed to sync with Zoho FSM" }, { status: 500 });
  }
}
