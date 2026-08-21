import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { getFsmWorkOrderLines } from "@/lib/server/zoho/work-orders";
import { ActionType, ResourceType } from "@/types/types";

const bodySchema = z.object({ workOrderId: z.string().trim().min(1) });

// Lists a work order's service lines for the add-entry dialog to choose from.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await getFsmWorkOrderLines(parsed.data.workOrderId);
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });

    // Wrap so executeRESTBackend unwraps .data to the FsmWorkOrderLines object.
    return NextResponse.json({ data: result.json });
  } catch (error) {
    console.error("Work-order-lines error:", error);
    return NextResponse.json({ error: "Failed to load work order service lines" }, { status: 500 });
  }
}
