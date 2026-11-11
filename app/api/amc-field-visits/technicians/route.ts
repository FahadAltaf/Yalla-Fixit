import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fieldVisitTechnicians } from "@/lib/server/amc/field-visits";

/** The active FSM technicians, for AMC -> Visits' technician filter (names only). */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ technicians: await fieldVisitTechnicians(gate.admin) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the technicians");
  }
}
