import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { whatsappUrl } from "@/lib/amc/approval-ladder";
import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { callOutOwner } from "@/lib/server/amc/call-outs";
import { CLIENT_LINK_CHANNELS, createFieldWorkClientLink } from "@/lib/server/amc/client-links";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/*
  POST { channel } -- DEV-494 on a call out or additional work (27 Nov 2026):
  the client's no-login link to send the passes and the property's access
  rules, as on a planned visit and a site visit. Returns the link and the
  message to send with it. Whoever may change the record.
*/
const KINDS = ["call_out", "additional_work"] as const;
const bodySchema = z.object({ channel: z.enum(CLIENT_LINK_CHANNELS).default("whatsapp"), purpose: z.literal("access_upload").optional() }).strict();
type Params = { params: Promise<{ kind: string; id: string }> };

export async function POST(req: NextRequest, ctx: Params) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { kind: kindParam, id } = await ctx.params;
  if (!(KINDS as readonly string[]).includes(kindParam) || !UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const kind = kindParam as (typeof KINDS)[number];
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = kind === "call_out" ? await callOutOwner(gate.admin, id) : await additionalWorkOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, kind === "call_out" ? "call_outs" : "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (!rights.edit) return NextResponse.json({ error: "You cannot change this record." }, { status: 403 });
    const { phone, ...link } = await createFieldWorkClientLink(gate.admin, { kind, id, channel: parsed.data.channel }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ...link, whatsapp: parsed.data.channel === "whatsapp" && phone ? whatsappUrl(phone, link.message) : null });
  } catch (error) {
    return contractErrorResponse(error, "Could not make the client link");
  }
}
