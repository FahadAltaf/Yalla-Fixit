import { NextRequest, NextResponse } from "next/server";

import { canUseAmc } from "@/components/dashboard/extensions/amc/amc-constants";
import { canApproveAmc } from "@/components/dashboard/extensions/amc/amc-settings";
import type { AmcHistoryEvent } from "@/components/dashboard/extensions/amc/amc-types";
import { readAmcSettings } from "@/lib/server/amc/settings";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Everything that has happened to one submission (FR5.9), from the audit
 * trail. The submission row only keeps the latest date of each kind, so a
 * proposal sent back twice, or rejected by the client and sent again,
 * would otherwise show one round of it.
 *
 * The owner sees their own; an approver sees any they can see in the list.
 */
export async function GET(req: NextRequest) {
  const access = await getAuthenticatedUserAccess();
  if (!access.profile || !access.accessUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUseAmc(access.accessUser)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const admin = await createAdminServerClient();
  const { data: submission, error: fetchError } = await admin
    .from("amc_submissions")
    .select("id, owner_id, status")
    .eq("id", id)
    .maybeSingle();
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  if (!submission) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (submission.owner_id !== access.profile.id) {
    const canApprove = canApproveAmc(
      await readAmcSettings(admin),
      access.profile.email,
      hasResourceAction(
        access.accessUser,
        ResourceType.AMC,
        ActionType.APPROVE,
      ),
    );
    if (!canApprove || submission.status === "draft") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const { data, error } = await admin
    .from("amc_audit_events")
    .select(
      "event_type, actor_label, origin, justification, payload, created_at",
    )
    .eq("entity_type", "submission")
    .eq("entity_id", id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events: AmcHistoryEvent[] = (data ?? []).map((row) => ({
    type: String(row.event_type),
    at: String(row.created_at),
    actor: (row.actor_label as string | null) ?? null,
    origin: (row.origin as AmcHistoryEvent["origin"]) ?? "portal",
    note: (row.justification as string | null) ?? null,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
  }));

  return NextResponse.json(
    { events },
    { headers: { "Cache-Control": "no-store" } },
  );
}
