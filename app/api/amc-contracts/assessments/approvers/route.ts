import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listSiteVisitApprovers } from "@/lib/server/amc/site-visit-approvers";

/** GET: who can approve a site visit (AMC approval rights), for the approver field when one is booked or edited (16 Nov 2026). */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ approvers: await listSiteVisitApprovers(gate.admin) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the approvers");
  }
}
