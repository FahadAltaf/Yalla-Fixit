import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fieldVisitHistory, getFieldVisit } from "@/lib/server/amc/field-visits";

/** Everything that happened to one AMC visit, newest first (the visit page's History tab). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  try {
    /* The same visibility as the visit itself; its kind decides which records are read. */
    const visit = await getFieldVisit(gate.admin, id, gate.seesAll || gate.visits.view ? { all: true } : { all: false, userId: gate.userId });
    if (!visit) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    return NextResponse.json({ history: await fieldVisitHistory(gate.admin, visit.kind, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the visit's history");
  }
}
