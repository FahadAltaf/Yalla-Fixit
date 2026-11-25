import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { requireProposalViewer } from "@/lib/server/amc/proposal-access";
import { changeProposalOwner, proposalOwnerCandidates } from "@/lib/server/amc/proposal-owner";

/*
  A proposal's owner (DEV-368, 20 Nov 2026 review).

    GET  ?id=               who it can be given to (the team that works on proposals)
    POST { id, takeOver: true }   take it over
    POST { id, ownerId }          give it to someone else

  The owner or the team by role (AMC Proposals Edit, AMC Operations Edit,
  the AMC approver right) may; the change is logged on its history.
*/

const bodySchema = z.union([
  z.object({ id: z.string().uuid(), takeOver: z.literal(true) }).strict(),
  z.object({ id: z.string().uuid(), ownerId: z.string().uuid() }).strict(),
]);

export async function GET(req: NextRequest) {
  const gate = await requireProposalViewer(req.nextUrl.searchParams.get("id"));
  if (!gate.ok) return gate.response;
  if (!gate.canAct) return NextResponse.json({ error: "Changing the owner needs AMC Proposals (Edit)." }, { status: 403 });
  try {
    return NextResponse.json({ ownerId: gate.proposal.ownerId, candidates: await proposalOwnerCandidates(gate.admin) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not list the team");
  }
}

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const gate = await requireProposalViewer(parsed.data.id);
  if (!gate.ok) return gate.response;
  if (!gate.canAct) return NextResponse.json({ error: "Changing the owner needs AMC Proposals (Edit)." }, { status: 403 });
  try {
    const ownerId = "takeOver" in parsed.data ? gate.actor.id : parsed.data.ownerId;
    return NextResponse.json(await changeProposalOwner(gate.admin, parsed.data.id, ownerId, gate.actor));
  } catch (error) {
    return contractErrorResponse(error, "Could not change the owner");
  }
}
