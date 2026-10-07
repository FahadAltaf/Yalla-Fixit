import { NextRequest, NextResponse } from "next/server";

import { updateEnquirySchema } from "@/lib/amc/enquiries";
import { UUID } from "@/lib/server/amc/business-schemas";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { getEnquiry, listFollowUps, listSiteVisits, updateEnquiry } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { listStatusHistory } from "@/lib/server/amc/status-history";
import { ActionType } from "@/types/types";

const notFound = () => NextResponse.json({ error: "Enquiry not found." }, { status: 404 });

/** One enquiry with its follow-ups, site visits and stage history; PATCH edits its details or owner. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess();
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return notFound();
  try {
    const config = await readAmcConfig(gate.admin);
    const enquiry = await getEnquiry(gate.admin, enquiryId, config);
    const [followUps, siteVisits, history] = await Promise.all([
      listFollowUps(gate.admin, enquiryId),
      listSiteVisits(gate.admin, enquiryId),
      listStatusHistory(gate.admin, "enquiry", enquiryId),
    ]);
    return NextResponse.json(
      { enquiry, followUps, siteVisits, history, canEdit: gate.canEdit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the enquiry");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ enquiryId: string }> }) {
  const gate = await requireEnquiryAccess(ActionType.EDIT);
  if (!gate.ok) return gate.response;
  const { enquiryId } = await ctx.params;
  if (!UUID.test(enquiryId)) return notFound();
  const parsed = updateEnquirySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const enquiry = await updateEnquiry(gate.admin, enquiryId, parsed.data, gate.actor, await readAmcConfig(gate.admin));
    return NextResponse.json({ enquiry });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the enquiry");
  }
}
