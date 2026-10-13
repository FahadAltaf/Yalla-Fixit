import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { assetHistory } from "@/lib/server/amc/client-history";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/** An asset's service history (BRD 5.2): checklist results and photos from job sheets, and call outs for its trade. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ propertyId: string; assetId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId, assetId } = await ctx.params;
  if (!UUID.test(propertyId) || !UUID.test(assetId)) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
  try {
    const history = await assetHistory(gate.admin, propertyId, assetId);
    if (!history) return NextResponse.json({ error: "Asset not found." }, { status: 404 });
    return NextResponse.json(history, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the asset's history");
  }
}
