import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";
import { proposalVersionUrl } from "@/lib/server/amc/proposal-versions";

/** A five-minute link to a locked version's document (?id=&version=). */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const gate = await requireProposalViewer(params.get("id"));
  if (!gate.ok) return gate.response;
  const versionNo = Number(params.get("version"));
  if (!Number.isInteger(versionNo) || versionNo < 1) return NextResponse.json({ error: "Choose a version." }, { status: 400 });
  try {
    return NextResponse.json({ url: await proposalVersionUrl(gate.admin, gate.proposal.id, versionNo) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not open the version");
  }
}
