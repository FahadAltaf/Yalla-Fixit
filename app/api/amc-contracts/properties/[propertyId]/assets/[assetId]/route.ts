import { NextRequest, NextResponse } from "next/server";

import { assetSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { updateAsset } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Edit an active asset. Retiring is its own action (…/retire); assets are never deleted. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string; assetId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId, assetId } = await ctx.params;
  if (!UUID.test(propertyId) || !UUID.test(assetId)) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  const parsed = assetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    return NextResponse.json({ asset: await updateAsset(gate.admin, propertyId, assetId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the asset");
  }
}
