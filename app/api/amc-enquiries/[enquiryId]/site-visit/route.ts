import { NextRequest, NextResponse } from "next/server";

import { siteVisitSchema } from "@/lib/amc/enquiries";
import { UUID } from "@/lib/server/amc/business-schemas";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { scheduleSiteVisit } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { ActionType } from "@/types/types";

/**
 * Books a site visit (DEV-362): an AMC assessment of the enquiry's
 * property, dated and assigned to an assessor, who is told in the portal.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess(ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return NextResponse.json({ error: "Enquiry not found." }, { status: 404 });
  const parsed = siteVisitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await scheduleSiteVisit(gate.admin, enquiryId, parsed.data, gate.actor, await readAmcConfig(gate.admin)), {
      status: 201,
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not book the site visit");
  }
}
