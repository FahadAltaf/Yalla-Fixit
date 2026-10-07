import { NextRequest, NextResponse } from "next/server";

import { stageChangeSchema } from "@/lib/amc/enquiries";
import { UUID } from "@/lib/server/amc/business-schemas";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { changeStage } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { ActionType } from "@/types/types";

/**
 * Moves an enquiry to another configured stage (DEV-359). Lost needs a
 * reason from the list; reopening Won or Lost needs a reason; a required
 * site visit flags (or, if configured, blocks) Proposal Preparation and
 * later. Recorded in the stage history.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess(ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
  const parsed = stageChangeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await changeStage(gate.admin, enquiryId, parsed.data, gate.actor, await readAmcConfig(gate.admin)));
  } catch (error) {
    return contractErrorResponse(error, "Could not change the stage");
  }
}
