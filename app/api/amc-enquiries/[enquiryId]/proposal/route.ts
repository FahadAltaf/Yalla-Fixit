import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { createProposalFromEnquiry } from "@/lib/server/amc/enquiry-proposal";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { ActionType } from "@/types/types";

/**
 * Starts the AMC proposal for an enquiry (DEV-365): client, contact,
 * property and lines prefilled, priced on the rate card. The caller then
 * owns it and finishes it in the wizard.
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess(ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
  try {
    return NextResponse.json(await createProposalFromEnquiry(gate.admin, enquiryId, gate.actor, await readAmcConfig(gate.admin)), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not start the proposal");
  }
}
