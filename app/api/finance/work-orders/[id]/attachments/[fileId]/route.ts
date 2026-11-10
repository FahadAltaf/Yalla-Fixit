import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { fetchAttachmentsLive, fetchFileLive, fetchServiceReportsLive, fetchWorkOrderLive, FsmLiveError } from "@/lib/server/finance/fsm-live";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * One file of a work order or its appointments, or a service report's PDF,
 * streamed from Zoho FSM. Only a file FSM lists on this work order (or one
 * of its appointments or service reports) is served, so the route cannot
 * be used to read any other FSM file.
 */

export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,40}$/;
/* A service report's PDF has a path for an id ("servicereport/<appointment>/pdf/<report>"); never "..". */
const FILE_ID = /^(?!.*\.\.)[0-9A-Za-z_.\/-]{1,200}$/;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  if (!ID.test(id) || !FILE_ID.test(fileId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const user = gate.access.accessUser;
  if (
    !hasResourceAction(user, ResourceType.FINANCE_QUEUE, ActionType.VIEW) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.CREATE) &&
    !hasResourceAction(user, ResourceType.FINANCE_EXCLUSIONS, ActionType.APPROVE)
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const admin = await createAdminServerClient();
    const live = await fetchWorkOrderLive(admin, id);
    if (!live) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [files, reports] = await Promise.all([
      fetchAttachmentsLive(admin, id, live.appointmentIds),
      fetchServiceReportsLive(admin, id, live.appointmentIds),
    ]);
    const report = reports.find((r) => r.pdf?.fileId === fileId)?.pdf ?? null;
    const file = files.find((f) => f.fileId === fileId) ?? (report ? { name: report.name } : null);
    if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const res = await fetchFileLive(admin, fileId);
    const inline = req.nextUrl.searchParams.get("download") !== "1";
    const name = file.name.replace(/["\\\r\n]/g, "_");
    return new Response(res.body, {
      headers: {
        "Content-Type": res.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof FsmLiveError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Work order file error:", error);
    return NextResponse.json({ error: "Could not read the file in Zoho FSM" }, { status: 500 });
  }
}
