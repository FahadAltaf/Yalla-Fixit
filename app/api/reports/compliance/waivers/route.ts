import { NextRequest, NextResponse } from "next/server";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { ComplianceError, waiveMisses, waiverRequestSchema } from "@/lib/server/reports/compliance";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Waive missed check-ins (BRD 5.2 B4; DEV-448): one or several misses, or
 * a confirmed outage for everyone in one action. Compliance Edit, which an
 * administrator does not get by default (a named supervisor or coordinator
 * does). Who and when are recorded; a waiver is never removed.
 *
 * Body: { month, reason, note?, eventKeys? | outage?: { from, to, kinds } }
 */
export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.COMPLIANCE, ActionType.EDIT);
  if (!gate.ok) return gate.response;

  const parsed = waiverRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid waiver" }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const result = await waiveMisses(admin, parsed.data, actorOf(gate.access.profile));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ComplianceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Compliance waiver error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was waived." }, { status: 500 });
  }
}
