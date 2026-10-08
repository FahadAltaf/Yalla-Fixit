import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listTechnicianDirectory } from "@/lib/server/amc/visits";

/**
 * The FSM technicians with their AMC skills and profile (DEV-356, 395):
 * every AMC user may read them (the board suggests from them); AMC Visits
 * (Edit) changes them.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ ...(await listTechnicianDirectory(gate.admin)), canEdit: gate.visits.edit });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the technicians");
  }
}
