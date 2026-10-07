import { NextRequest, NextResponse } from "next/server";

import { listApprovalSteps } from "@/lib/server/amc/approval-ladder";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";
import { listSendLog } from "@/lib/server/amc/proposal-share";

/**
 * GET ?id=  the proposal's approval ladder (every level of every round and
 * version, with who decided and why) and its send log (channel,
 * recipients, version, user, time). `migrated: false` before 20261007150000.
 */
export async function GET(req: NextRequest) {
  const gate = await requireProposalViewer(req.nextUrl.searchParams.get("id"));
  if (!gate.ok) return gate.response;
  try {
    const [ladder, log] = await Promise.all([listApprovalSteps(gate.admin, gate.proposal.id), listSendLog(gate.admin, gate.proposal.id)]);
    return NextResponse.json(
      { steps: ladder.steps, sendLog: log.entries, migrated: ladder.migrated && log.migrated },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the approvals and sends");
  }
}
