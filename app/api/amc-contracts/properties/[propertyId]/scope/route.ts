import { NextRequest, NextResponse } from "next/server";

import { scopeItemSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { createScopeItem, listScope } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/**
 * A property's scope (BRD 5.2, DEV-360): services by trade, quantity,
 * frequency, duration, preferred months and days, exclusions. Captured once;
 * the proposal and the PPM schedule reuse it.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  try {
    return NextResponse.json(await listScope(gate.admin, propertyId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the scope");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ propertyId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId } = await ctx.params;
  if (!UUID.test(propertyId)) return NextResponse.json({ error: "Property not found." }, { status: 404 });
  const parsed = scopeItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    return NextResponse.json({ item: await createScopeItem(gate.admin, propertyId, parsed.data, { id: gate.userId, label: gate.label }) }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the scope item");
  }
}
