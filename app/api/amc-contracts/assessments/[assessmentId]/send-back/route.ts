import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { sendBackSiteVisit } from "@/lib/server/amc/site-visit-approval";

const schema = z.object({ reason: z.string().trim().min(3, "Say what the inspector should change.").max(2000) }).strict();

/** POST { reason }: sends a completed site visit back to its inspector; only its named approver may (16 Nov 2026). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Site visit not found." }, { status: 404 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ assessment: await sendBackSiteVisit(gate.admin, assessmentId, parsed.data.reason, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not send the site visit back");
  }
}
