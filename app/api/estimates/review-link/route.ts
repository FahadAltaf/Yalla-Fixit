import { NextRequest, NextResponse } from "next/server";

import { ESTIMATE_ID, signQuotationReview } from "@/lib/server/quotation-review-token";
import { requireResourceAccess } from "@/lib/server/require-access";
import { ActionType, ResourceType } from "@/types/types";

/**
 * The signature for a quotation's customer review link, for a signed-in
 * user who can work with quotations (Extensions). The quotation email adds
 * it to the approve/reject links; see lib/server/quotation-review-token.ts.
 */
export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.EXTENSIONS, ActionType.VIEW);
  if (!gate.ok) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { estimateId?: unknown };
  const estimateId = typeof body.estimateId === "string" ? body.estimateId : String(body.estimateId ?? "");
  if (!ESTIMATE_ID.test(estimateId)) return NextResponse.json({ error: "Invalid estimate id" }, { status: 400 });
  const sig = signQuotationReview(estimateId);
  if (!sig) return NextResponse.json({ error: "Review links are not configured" }, { status: 503 });
  return NextResponse.json({ sig });
}
