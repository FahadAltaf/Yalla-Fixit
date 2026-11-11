import { NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listTechnicianDirectory } from "@/lib/server/amc/visits";
import { syncFsmTechnicians } from "@/lib/server/zoho/service-resources";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The FSM technicians with their AMC skills and profile (DEV-356, 395):
 * every AMC user may read them (the board suggests from them); AMC Visits
 * (Edit) changes them.
 */
/* Pages up to 2000 FSM users, as the scheduling refresh does. */
export const maxDuration = 60;

export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  /* The Technicians page's own permission; the board reads technicians through its own route. */
  if (!gate.can(ResourceType.AMC_TECHNICIANS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC Technicians." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ...(await listTechnicianDirectory(gate.admin)), canEdit: gate.visits.edit });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the technicians");
  }
}

/**
 * Refresh: the roster from Zoho FSM (read only there), as the Scheduling and
 * Compliance refresh do: new technicians appear, ones gone from FSM become
 * inactive. AMC skills and profiles are the portal's and are kept.
 */
export async function POST() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.can(ResourceType.AMC_TECHNICIANS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC Technicians." }, { status: 403 });
  }
  try {
    const result = await syncFsmTechnicians();
    if (!result.ok) return NextResponse.json(result.json, { status: result.status });
    const json = result.json as { resources?: unknown[]; removed?: unknown[] | number };
    return NextResponse.json({
      onRoster: Array.isArray(json.resources) ? json.resources.length : null,
      removed: Array.isArray(json.removed) ? json.removed.length : typeof json.removed === "number" ? json.removed : 0,
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not refresh the technicians from Zoho FSM");
  }
}
