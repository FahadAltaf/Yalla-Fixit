import { NextRequest, NextResponse } from "next/server";

import { retireAssetSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { retireAsset } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Retire an asset with a reason (replaced, removed…). Its history is kept. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ propertyId: string; assetId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId, assetId } = await ctx.params;
  if (!UUID.test(propertyId) || !UUID.test(assetId)) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  const parsed = retireAssetSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    return NextResponse.json({ asset: await retireAsset(gate.admin, propertyId, assetId, parsed.data.reason, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not retire the asset");
  }
}
