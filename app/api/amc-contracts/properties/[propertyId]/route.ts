import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { propertyOverview, updateProperty } from "@/lib/server/amc/business";
import { UUID, propertySchema } from "@/lib/server/amc/business-schemas";

/**
 * A property's AMC view: the current contract, previous contracts (kept
 * through renewals), services and usage, assessments and quotes. PATCH edits
 * the live property record; signed snapshots never change.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  try {
    return NextResponse.json({
      overview: await propertyOverview(gate.admin, { userId: gate.userId, canApprove: gate.canApprove }, propertyId),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the property");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  const parsed = propertySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ property: await updateProperty(gate.admin, propertyId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the property");
  }
}
