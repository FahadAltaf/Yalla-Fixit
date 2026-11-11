import { NextRequest, NextResponse } from "next/server";

import { callOutCoverageQuerySchema } from "@/lib/amc/call-outs";
import { loadCallOutContract, previewCoverage } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * The coverage answer before a call out is confirmed (DEV-408): covered
 * or chargeable, why, the allowance balance and the SLA deadline. Changes
 * nothing; logging the call out checks again.
 */
export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = callOutCoverageQuerySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const contract = await loadCallOutContract(gate.admin, parsed.data.contractId);
    if (!fieldWorkRights(gate, "call_outs", contract.ownerId).view) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    const preview = previewCoverage(contract, parsed.data, await readAmcConfig(gate.admin));
    return NextResponse.json(
      { ...preview, contract: { id: contract.id, number: contract.number, customerName: contract.customerName, propertyLabel: contract.propertyLabel, status: contract.status }, canOverride: Boolean(gate.actor.allowanceOverride) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not check the coverage");
  }
}
