import { NextRequest, NextResponse } from "next/server";

import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";
import { fieldVisitHistory } from "@/lib/server/amc/field-visits";

/**
 * Everything that happened to one additional work, newest first (its
 * page's History tab): status changes and other recorded events. Read with
 * the same rights as the work itself, at any status (before approval it is
 * not a visit, so the visits' history route would not find it).
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const notFound = () => NextResponse.json({ error: "Additional work not found." }, { status: 404 });
  if (!UUID.test(id)) return notFound();
  try {
    const scope = await additionalWorkOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return notFound();
    return NextResponse.json({ history: await fieldVisitHistory(gate.admin, "additional_work", id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the history");
  }
}
