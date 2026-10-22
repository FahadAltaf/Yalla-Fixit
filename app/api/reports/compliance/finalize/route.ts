import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { ComplianceError, finalizeMonth } from "@/lib/server/reports/compliance";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Finalise a month's compliance (BRD 5.2 B4; DEV-450): after the dispute
 * cut-off, the statements are frozen with the settings used and never
 * recalculated. Compliance Approve (a named person, not inherited by
 * administrators). Refused until shift check-ins can be read (B-01).
 *
 * Body: { month: "YYYY-MM" }
 */
const bodySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict();

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.COMPLIANCE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A month is required" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const statements = await finalizeMonth(admin, parsed.data.month, actorOf(gate.access.profile));
    return NextResponse.json({ statements });
  } catch (error) {
    if (error instanceof ComplianceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Compliance finalise error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was finalised." }, { status: 500 });
  }
}
