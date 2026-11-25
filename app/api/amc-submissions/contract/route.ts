import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { createContractFromApproval } from "@/lib/server/amc/contract-lifecycle";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";

/*
  POST { id } -- make the contract record of an approved proposal again
  (DEV-505, 20 Nov 2026), when creating it on the client's approval failed.
  The owner or the team by role; idempotent (an existing record is
  returned). A failure says why and is logged, as on approval.
*/

const bodySchema = z.object({ id: z.string().uuid() }).strict();

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const gate = await requireProposalViewer(parsed.data.id);
  if (!gate.ok) return gate.response;
  if (!gate.canAct) return NextResponse.json({ error: "Creating the contract needs AMC Proposals (Edit) or being its owner." }, { status: 403 });
  if (!["proposal_approved", "contract_sent", "signed"].includes(gate.proposal.status)) {
    return NextResponse.json({ error: "The client has not approved this proposal." }, { status: 409 });
  }
  try {
    const result = await createContractFromApproval(gate.admin, parsed.data.id, gate.actor, await readAmcConfig(gate.admin));
    if (!result.contractId) return NextResponse.json({ error: result.message ?? "The contract record was not created." }, { status: 409 });
    return NextResponse.json({ contractId: result.contractId, created: result.created });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the contract");
  }
}
