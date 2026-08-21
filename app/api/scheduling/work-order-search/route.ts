import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { searchFsmWorkOrders } from "@/lib/server/zoho/work-orders";
import { ActionType, ResourceType } from "@/types/types";

// The non-number filters scan several pages of recent work orders, so give
// this route more headroom than the platform default.
export const maxDuration = 60;

const searchSchema = z.object({
  workOrderName: z.string().trim().optional(),
  contact: z.string().trim().optional(),
  company: z.string().trim().optional(),
  address: z.string().trim().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// PLAN-003/004 (O-4): multi-result work order search by number, client,
// company, address or due-date.
export async function POST(req: NextRequest) {
  try {
    const { profile, accessUser } = await getAuthenticatedUserAccess();
    if (!profile || !accessUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!hasResourceAction(accessUser, ResourceType.SCHEDULING, ActionType.VIEW)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = searchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const result = await searchFsmWorkOrders(parsed.data);
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });

    return NextResponse.json({ data: result.json });
  } catch (error) {
    console.error("Work-order-search error:", error);
    return NextResponse.json({ error: "Failed to search work orders" }, { status: 500 });
  }
}
