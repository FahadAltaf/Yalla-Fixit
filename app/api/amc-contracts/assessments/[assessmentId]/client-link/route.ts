import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canReadAssessment } from "@/lib/amc/access";
import { whatsappUrl } from "@/lib/amc/approval-ladder";
import { getAssessment } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import { CLIENT_LINK_CHANNELS, createSiteVisitClientLink } from "@/lib/server/amc/client-links";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/*
  POST { channel } -- DEV-494 on a site visit (26 Nov 2026): the client's
  no-login link to upload the gate pass or work permit. Returns the link and
  the message to send with it. Whoever may change the site visit's passes.
*/
const bodySchema = z.object({ channel: z.enum(CLIENT_LINK_CHANNELS).default("whatsapp"), purpose: z.literal("access_upload").optional() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ assessmentId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { assessmentId } = await ctx.params;
  if (!UUID.test(assessmentId)) return NextResponse.json({ error: "Site visit not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const a = await getAssessment(gate.admin, assessmentId);
    if (!canReadAssessment(gate.actor, a.createdBy, a.assessorId)) return NextResponse.json({ error: "Site visit not found." }, { status: 404 });
    const mayEdit = gate.canApprove || gate.actor.ops.edit || a.createdBy === gate.userId || a.assessorId === gate.userId;
    if (!mayEdit) return NextResponse.json({ error: "You cannot change this site visit." }, { status: 403 });
    const { phone, ...link } = await createSiteVisitClientLink(gate.admin, { assessmentId, channel: parsed.data.channel }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ...link, whatsapp: parsed.data.channel === "whatsapp" && phone ? whatsappUrl(phone, link.message) : null });
  } catch (error) {
    return contractErrorResponse(error, "Could not make the client link");
  }
}
