import { NextResponse } from "next/server";

import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { renewalsDue } from "@/lib/server/amc/renewals";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The renewals due view (DEV-415): contracts inside the renewal lead time,
 * idle ones, ones that ended without a renewal, and recent outcomes, over
 * the contracts the caller may see. AMC → Renewals (its own permission).
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.can(ResourceType.AMC_RENEWALS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC Renewals." }, { status: 403 });
  }
  try {
    return NextResponse.json(await renewalsDue(gate.admin, { userId: gate.userId, canApprove: gate.seesAll }, await readAmcConfig(gate.admin)), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the renewals");
  }
}
