import { NextRequest, NextResponse } from "next/server";

import { recordDecisionSchema } from "@/lib/amc/approval-ladder";
import { recordClientDecision } from "@/lib/server/amc/client-decision";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";

/**
 * POST {id, answer, clientName, note, evidenceDocumentId}: the coordinator
 * records the client's answer given outside the link, with its evidence
 * (DEV-371). The proposal's owner, an approver or AMC Operations (Edit).
 */
export async function POST(req: NextRequest) {
  const parsed = recordDecisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const gate = await requireProposalViewer(parsed.data.id);
  if (!gate.ok) return gate.response;
  if (!gate.isOwner && !gate.canOperate) {
    return NextResponse.json({ error: "Only the proposal's owner or AMC operations can record the client's answer." }, { status: 403 });
  }
  try {
    return NextResponse.json(await recordClientDecision(gate.admin, parsed.data, gate.actor));
  } catch (error) {
    return contractErrorResponse(error, "Could not record the client's answer");
  }
}
