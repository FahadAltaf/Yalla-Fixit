import { NextResponse } from "next/server";

import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { jobSheetSupervisors, reviewQueue } from "@/lib/server/amc/job-sheets";

/**
 * Submitted job sheets waiting for a supervisor (to-do 5), oldest first,
 * with why each needs a close look and its 48-hour report clock.
 * AMC Visits (View or Approve), or a named supervisor.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const config = await readAmcConfig(gate.admin);
    const supervisor = gate.visits.approve || jobSheetSupervisors(config).includes(gate.userId);
    if (!gate.visits.view && !supervisor) return NextResponse.json({ error: "You do not have access to job reviews." }, { status: 403 });
    return NextResponse.json({ ...(await reviewQueue(gate.admin)), canReview: supervisor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the job reviews");
  }
}
