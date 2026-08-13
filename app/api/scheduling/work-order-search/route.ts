import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hasResourceAction } from "@/lib/role-permissions";
import { getAuthenticatedUserAccess } from "@/lib/server/user-access";
import { ActionType, ResourceType } from "@/types/types";

const searchSchema = z.object({
  workOrderName: z.string().trim().optional(),
  contact: z.string().trim().optional(),
  company: z.string().trim().optional(),
  address: z.string().trim().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// PLAN-003/004 (O-4): multi-result work order search by number, client,
// company, address or due-date. Proxies the zoho-fsm-work-order-search fn.
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

    const supabaseUrl = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: "Supabase environment is not configured" }, { status: 500 });
    }

    const res = await fetch(`${supabaseUrl}/functions/v1/zoho-fsm-work-order-search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${anonKey}`,
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(parsed.data),
    });

    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = { error: "The work-order-search function returned an invalid response" };
    }

    if (res.ok) return NextResponse.json({ data: json });
    return NextResponse.json(json, { status: res.status });
  } catch (error) {
    console.error("Work-order-search error:", error);
    return NextResponse.json({ error: "Failed to search work orders" }, { status: 500 });
  }
}
