import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canManage, contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { activationPreview } from "@/lib/server/amc/contracts";

/**
 * What activating a signed proposal would create: customer, property,
 * value, signature, the proposal's dates and every entitlement. Nothing is
 * written; the activation dialog shows this before anyone confirms.
 *
 * GET /api/amc-contracts/activation-preview?submissionId=<uuid>
 */
const querySchema = z.object({ submissionId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
  }

  const { data: owner } = await gate.admin
    .from("amc_submissions")
    .select("owner_id")
    .eq("id", parsed.data.submissionId)
    .maybeSingle<{ owner_id: string }>();
  if (!owner || !canManage(gate, owner.owner_id)) {
    return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
  }

  try {
    return NextResponse.json({ preview: await activationPreview(gate.admin, parsed.data.submissionId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not prepare the activation");
  }
}
