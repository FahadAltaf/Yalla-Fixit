import { NextRequest, NextResponse } from "next/server";

import { followUpSchema } from "@/lib/amc/enquiries";
import { UUID } from "@/lib/server/amc/business-schemas";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { addFollowUp } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { ActionType } from "@/types/types";

/**
 * Logs a follow-up (DEV-359): date, channel, outcome, next date. It resets
 * the idle clock, sets the next follow-up, copies into the client's
 * communication log and can move the stage in the same step.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess(ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
  const parsed = followUpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await addFollowUp(gate.admin, enquiryId, parsed.data, gate.actor, await readAmcConfig(gate.admin)), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not log the follow-up");
  }
}
