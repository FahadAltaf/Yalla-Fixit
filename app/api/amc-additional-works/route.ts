import { NextRequest, NextResponse } from "next/server";

import { additionalWorkCreateSchema } from "@/lib/amc/call-outs";
import { createAdditionalWork, listAdditionalWorks } from "@/lib/server/amc/additional-works";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, contractOwner, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * AMC additional works (DEV-407).
 *
 *   GET  ?contractId&callOutId&visitId   every one with AMC Additional works (View), else
 *                                        those of contracts the caller may read
 *   POST                                 raise one from a visit, a call out, or by hand
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const contractId = params.get("contractId");
  const callOutId = params.get("callOutId");
  const visitId = params.get("visitId");
  if ([contractId, callOutId, visitId].some((v) => v && !UUID.test(v))) return NextResponse.json({ error: "Not found." }, { status: 404 });
  try {
    let ownerFilter: string | null = null;
    let canCreate = fieldWorkRights(gate, "additional_works", null).create;
    if (contractId) {
      const scope = await contractOwner(gate.admin, contractId);
      canCreate = fieldWorkRights(gate, "additional_works", scope.ownerId).create;
      if (!scope.found || !fieldWorkRights(gate, "additional_works", scope.ownerId).view) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    } else if (!fieldWorkRights(gate, "additional_works", null).seesAll) {
      ownerFilter = gate.userId;
    }
    const result = await listAdditionalWorks(gate.admin, { contractId, callOutId, visitId, ownerId: ownerFilter });
    return NextResponse.json({ ...result, canCreate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the additional works");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = additionalWorkCreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = await contractOwner(gate.admin, parsed.data.contractId);
    const rights = fieldWorkRights(gate, "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
    if (!rights.create) return NextResponse.json({ error: "You cannot raise additional work on this contract." }, { status: 403 });
    return NextResponse.json(await createAdditionalWork(gate.admin, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin)), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not raise the additional work");
  }
}
