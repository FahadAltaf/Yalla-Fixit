import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { canOperateContract } from "@/lib/amc/access";
import { whatsappUrl } from "@/lib/amc/approval-ladder";
import { CLIENT_LINK_CHANNELS, CLIENT_LINK_PURPOSES, createVisitClientLink } from "@/lib/server/amc/client-links";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { visitDetail } from "@/lib/server/amc/visits";

/*
  POST { purpose, channel } -- a client link without a login for this visit
  (22 Nov 2026): visit_confirmation (DEV-507: Confirm or Reschedule) or
  access_upload (DEV-494: the gate pass or work permit). Returns the link,
  the message to send with it and, for WhatsApp, the prepared chat. Whoever
  may change the visit.
*/

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodySchema = z.object({ purpose: z.enum(CLIENT_LINK_PURPOSES), channel: z.enum(CLIENT_LINK_CHANNELS).default("whatsapp") }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const config = await readAmcConfig(gate.admin);
    const detail = await visitDetail(gate.admin, visitId, config, new Date(), false);
    if (!(gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, detail.ownerId))) {
      return NextResponse.json({ error: "You cannot change this contract's visits." }, { status: 403 });
    }
    const link = await createVisitClientLink(gate.admin, { visitId, ...parsed.data }, { id: gate.userId, label: gate.label }, config);
    const { data: c } = await gate.admin.from("amc_contracts").select("customer").eq("id", detail.contractId).maybeSingle<{ customer: Record<string, unknown> | null }>();
    const phone = typeof c?.customer?.customerPhone === "string" ? c.customer.customerPhone : null;
    return NextResponse.json({ ...link, whatsapp: parsed.data.channel === "whatsapp" && phone ? whatsappUrl(phone, link.message) : null });
  } catch (error) {
    return contractErrorResponse(error, "Could not make the client link");
  }
}
