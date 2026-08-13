import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const bodySchema = z.object({ workOrderId: z.string().trim().min(1) });

// Proxies to the zoho-fsm-work-order-lines Edge Function so the add-entry
// dialog can list a work order's service lines for selection.
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

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment is not configured" }, { status: 500 });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/zoho-fsm-work-order-lines`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ workOrderId: parsed.data.workOrderId }),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: "The work-order-lines function returned an invalid response" };
    }

    // Wrap so executeRESTBackend unwraps .data to the FsmWorkOrderLines object.
    if (res.ok) return NextResponse.json({ data: json });
    return NextResponse.json(json, { status: res.status });
  } catch (error) {
    console.error("Work-order-lines error:", error);
    return NextResponse.json({ error: "Failed to load work order service lines" }, { status: 500 });
  }
}
