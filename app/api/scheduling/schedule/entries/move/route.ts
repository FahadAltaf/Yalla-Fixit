import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { moveEntriesSchema } from "@/lib/scheduling/move-entries";
import { requireContractAccess } from "@/lib/server/amc/contract-access";
import { moveScheduleEntries } from "@/lib/server/schedule-move";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * DEV-393: move one or several entries to another day, give them a new crew,
 * or both. Each entry answers for itself (`results`): what moved, and why
 * the rest did not. AMC work moves through AMC's rules (service window,
 * crew checks, access lead time), which need AMC access as well.
 */
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT)) {
      return NextResponse.json({ error: "Moving entries needs Scheduling (Edit)." }, { status: 403 });
    }
    const parsed = moveEntriesSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
    const admin = await createAdminServerClient();
    const results = await moveScheduleEntries(admin, parsed.data, { id: profile.id }, requireContractAccess);
    return NextResponse.json({ data: { results } });
  } catch (error) {
    console.error("Schedule entries move error:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not move the entries" }, { status: 500 });
  }
}
