import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { hasResourceAction } from "@/lib/role-permissions";
import { getRequestUserAccess } from "@/lib/server/request-user-access";
import { recordAudit } from "@/lib/server/snagging/audit";
import { loadJobChecklist } from "@/lib/server/snagging/job-detail-sections";
import { ActionType, ResourceType } from "@/types/types";

/**
 * GET /api/snagging/tasks/[id]/checklist -- the job's checklist, in creation order.
 *
 * One section of the job detail, fetched on its own so it renders as soon
 * as it arrives and a failure here cannot take another section down. See
 * lib/server/snagging/job-detail-sections.ts.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    // const { profile, accessUser } = await getRequestUserAccess(req);
    // if (!profile || !accessUser) {
    //   return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // }
    // if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.VIEW)) {
    //   return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    // }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    return NextResponse.json({ data: await loadJobChecklist(admin, id) });
  } catch (error) {
    console.error("Snagging task checklist GET error:", error);
    return NextResponse.json(
      { error: "Failed to load the checklist" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/snagging/tasks/[id]/checklist -- corrects the reason the
 * inspector gave on a checklist item ("not checked: no power to the
 * unit"). Only the wording: the answer itself is the inspector's finding
 * and changes on the phone. Body: { item_id, reason }. Empty clears it.
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { profile, accessUser } = await getRequestUserAccess(req);
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SNAGGING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const itemId = typeof body?.item_id === "string" ? body.item_id : null;
    if (!itemId || (body.reason !== null && typeof body.reason !== "string")) {
      return NextResponse.json({ error: "Send item_id and the reason as text." }, { status: 400 });
    }
    const reason = typeof body.reason === "string" ? body.reason.trim() || null : null;
    if (reason && reason.length > 500) {
      return NextResponse.json({ error: "A reason can be up to 500 characters." }, { status: 400 });
    }

    const { id } = await ctx.params;
    const admin = await createAdminServerClient();

    const { data: item, error: itemError } = await admin
      .from("snagging_job_checklist")
      .select("id, label, reason")
      .eq("id", itemId)
      .eq("job_id", id)
      .maybeSingle();
    if (itemError) throw new Error(itemError.message);
    if (!item) return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    if ((item.reason ?? null) === reason) {
      return NextResponse.json({ data: { id: item.id, reason } });
    }

    // Stamped so the inspector's phone picks the new wording up on its next pull.
    const { error } = await admin
      .from("snagging_job_checklist")
      .update({ reason, updated_at: new Date().toISOString() })
      .eq("id", itemId)
      .eq("job_id", id);
    if (error) throw new Error(error.message);

    await recordAudit(admin, {
      entityType: "task",
      entityId: id,
      taskId: id,
      eventType: "checklist_reason_edited",
      actorId: profile.id,
      actorLabel: profile.full_name ?? profile.email ?? null,
      origin: "portal",
      payload: { item: item.label, before: item.reason ?? null, after: reason },
    });

    return NextResponse.json({ data: { id: item.id, reason } });
  } catch (error) {
    console.error("Snagging checklist PATCH error:", error);
    return NextResponse.json({ error: "Failed to save the reason" }, { status: 500 });
  }
}
