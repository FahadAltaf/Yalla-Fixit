import { NextRequest, NextResponse } from "next/server";

import { hasResourceAction } from "@/lib/role-permissions";
import { actorOf } from "@/lib/server/finance/route-helpers";
import { ComplianceError } from "@/lib/server/reports/compliance";
import { raiseDispute, raiseDisputeSchema, technicianOfUser } from "@/lib/server/reports/disputes";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Raise a compliance dispute (BRD 5.2 B4, N12; DEV-449): one missed
 * check-in, with the reason, up to the cut-off day (TC14).
 *
 * The technician disputes their own: who they are comes from their
 * signed-in account, never the request. With onBehalf, a supervisor or
 * coordinator (Compliance Edit) raises it for any technician.
 *
 * Body: { month, eventKey, reason, onBehalf? }
 */
export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const parsed = raiseDisputeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid dispute" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    let who: { self: string } | { onBehalf: true };
    if (parsed.data.onBehalf) {
      if (!hasResourceAction(gate.access.accessUser, ResourceType.REPORTS_COMPLIANCE, ActionType.EDIT)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      who = { onBehalf: true };
    } else {
      const me = await technicianOfUser(admin, gate.access.profile.id);
      if (!me) return NextResponse.json({ error: "Your account is not linked to a technician." }, { status: 403 });
      who = { self: me.fsmId };
    }
    return NextResponse.json(await raiseDispute(admin, parsed.data, actorOf(gate.access.profile), who));
  } catch (error) {
    if (error instanceof ComplianceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Compliance dispute error:", error);
    return NextResponse.json({ error: "Something went wrong. The dispute was not raised." }, { status: 500 });
  }
}
