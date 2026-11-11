import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { getFieldVisit } from "@/lib/server/amc/field-visits";

/**
 * One AMC visit as the Visits list shows it: the visit page's header. The
 * kind's own detail (a planned visit's lines and confirmation, a call out's
 * coverage) comes from its own route, with its own permission check.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  try {
    const visit = await getFieldVisit(gate.admin, id, gate.seesAll || gate.visits.view ? { all: true } : { all: false, userId: gate.userId });
    if (!visit) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    return NextResponse.json({ visit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the visit");
  }
}
