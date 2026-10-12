import { NextRequest, NextResponse } from "next/server";

import { callOutCreateSchema } from "@/lib/amc/call-outs";
import { listCallOuts, createCallOut } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, contractOwner, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * AMC call outs (DEV-405).
 *
 *   GET  ?contractId&open=1   call outs: every one with AMC Call outs (View), else those of
 *                             contracts the caller may read (one contract when contractId is given)
 *   POST                      log a call out: the coverage check runs again on the server
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const contractId = params.get("contractId");
  if (contractId && !UUID.test(contractId)) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  try {
    const config = await readAmcConfig(gate.admin);
    let ownerFilter: string | null = null;
    let canCreate = fieldWorkRights(gate, "call_outs", null).create;
    if (contractId) {
      const scope = await contractOwner(gate.admin, contractId);
      canCreate = fieldWorkRights(gate, "call_outs", scope.ownerId).create;
      if (!scope.found || !fieldWorkRights(gate, "call_outs", scope.ownerId).view) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    } else if (!fieldWorkRights(gate, "call_outs", null).seesAll) {
      ownerFilter = gate.userId;
    }
    const result = await listCallOuts(gate.admin, { contractId, open: params.get("open") === "1", ownerId: ownerFilter }, config);
    return NextResponse.json(
      { ...result, canCreate, canOverride: Boolean(gate.actor.allowanceOverride) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the call outs");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = callOutCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = await contractOwner(gate.admin, parsed.data.contractId);
    const rights = fieldWorkRights(gate, "call_outs", scope.ownerId);
    if (!scope.found || !rights.view) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    if (!rights.create) return NextResponse.json({ error: "You cannot log call outs on this contract." }, { status: 403 });
    const result = await createCallOut(gate.admin, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin), rights.override);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not log the call out");
  }
}
