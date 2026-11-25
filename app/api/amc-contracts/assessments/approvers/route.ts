import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { siteVisitDeciders } from "@/lib/server/amc/site-visit-approvers";

/**
 * GET: who approves site visits (24 Nov 2026): the approvers named in AMC
 * configuration, shown on the booking forms. Nobody is picked per visit.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const d = await siteVisitDeciders(gate.admin);
    return NextResponse.json({ names: d.names, from: d.from });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the approvers");
  }
}
