import { NextRequest, NextResponse } from "next/server";

import { scopeItemSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { updateScopeItem } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Edit a scope item, or remove it from the scope (active: false). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string; itemId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId, itemId } = await ctx.params;
  if (!UUID.test(propertyId) || !UUID.test(itemId)) return NextResponse.json({ error: "Scope item not found." }, { status: 404 });
  const parsed = scopeItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    return NextResponse.json({ item: await updateScopeItem(gate.admin, propertyId, itemId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the scope item");
  }
}
