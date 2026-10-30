import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { ComplianceError } from "@/lib/server/reports/compliance";
import { decideDispute, decideDisputeSchema } from "@/lib/server/reports/disputes";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Decide a compliance dispute (BRD §6.8; DEV-449): accepted, which waives
 * the miss, or rejected with the reason. Only the reviewers named in
 * Settings → Reporting (D-10); no role grants it.
 *
 * Body: { outcome: "accepted" | "rejected", waiverReason?, note? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "No such dispute" }, { status: 404 });
  const parsed = decideDisputeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid decision" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await decideDispute(admin, id, parsed.data, actorOf(gate.access.profile)));
  } catch (error) {
    if (error instanceof ComplianceError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Compliance dispute decision error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was decided." }, { status: 500 });
  }
}
