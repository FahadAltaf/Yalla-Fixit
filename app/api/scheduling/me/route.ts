import { NextResponse } from "next/server";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { hasResourceAction } from "@/lib/role-permissions";
import { ActionType, ResourceType } from "@/types/types";

// Lets the client know whether to render approver-only controls (Approve/
// Reject). The actual gate is always re-checked server-side -- this is purely
// a UI affordance. Approver status now comes from the Approve permission (#2)
// rather than a hidden per-user flag.
export async function GET() {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({
      data: {
        userId: profile.id,
        isApprover: hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.APPROVE),
        canEdit: hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.EDIT),
      },
    });
  } catch (error) {
    console.error("Scheduling me GET error:", error);
    return NextResponse.json({ error: "Failed to load user scheduling access" }, { status: 500 });
  }
}
