import { NextRequest, NextResponse } from "next/server";

import { canRevise, reviseSchema } from "@/lib/amc/proposal-rules";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";
import { listProposalVersions, reviseProposal } from "@/lib/server/amc/proposal-versions";

/**
 * Proposal versions (BRD 5.4, DEV-367).
 *
 * GET  ?id=  the locked versions, oldest first (the proposal itself is the
 *            active one), with their lines for comparing prices.
 * POST {id, reason, summary}  the owner revises a proposal the client has
 *            seen: the active version is printed, stored and locked, and
 *            V(n+1) opens as a draft that goes through approval again.
 */
export async function GET(req: NextRequest) {
  const gate = await requireProposalViewer(req.nextUrl.searchParams.get("id"));
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json(await listProposalVersions(gate.admin, gate.proposal.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the versions");
  }
}

export async function POST(req: NextRequest) {
  const parsed = reviseSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const gate = await requireProposalViewer(parsed.data.id);
  if (!gate.ok) return gate.response;
  if (!canRevise(gate.proposal.status, gate.isOwner)) {
    return NextResponse.json(
      {
        error: gate.isOwner
          ? `A proposal that is ${gate.proposal.status.replace(/_/g, " ")} is not revised: it has not been shared, or the contract stage has begun.`
          : "Only the proposal's owner can revise it.",
      },
      { status: gate.isOwner ? 409 : 403 },
    );
  }
  try {
    return NextResponse.json(await reviseProposal(gate.admin, parsed.data, gate.actor), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not revise the proposal");
  }
}
