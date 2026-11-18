import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { CLIENT_CONFIRMATIONS, type FieldStartKind } from "@/lib/amc/field-start";
import { sendChannelSchema } from "@/lib/amc/send-channels";
import { paymentTimingSchema } from "@/lib/amc/visit-charges";
import { ACCESS_STATUSES } from "@/lib/amc/visits";
import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { callOutOwner } from "@/lib/server/amc/call-outs";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { confirmWork, fieldAccess, removeFieldPass, requestWorkConfirmation, saveFieldPass, startFieldWork } from "@/lib/server/amc/field-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/*
  A call out's or additional work's access, start and client confirmation
  (17 Nov 2026), as a planned visit's.

  GET                                       rules, passes, access status for the day, started, confirmation
  POST { action: "start", payment? }       Start visit, once the checklist is complete (payment: before / after with the reason)
  POST { action: "pass", documentId, validUntil, note, accessRuleId?, accessStatus? }
  POST { action: "pass_remove", documentId }
  POST { action: "confirm", outcome, channel, note }          additional work only
  POST { action: "request_confirmation", channel }            additional work only
*/

const KINDS = ["call_out", "additional_work"] as const;
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date");
const actionSchema = z.discriminatedUnion("action", [
  /* payment (18 Nov 2026): when there is something to pay, before the visit or after it with the reason. */
  z.object({ action: z.literal("start"), payment: paymentTimingSchema.nullable().optional() }).strict(),
  z
    .object({
      action: z.literal("pass"),
      documentId: z.string().regex(UUID),
      validUntil: date.nullable(),
      note: z.string().trim().max(500).nullable(),
      accessRuleId: z.string().regex(UUID).nullable().optional(),
      accessStatus: z.enum(ACCESS_STATUSES).optional(),
    })
    .strict(),
  z.object({ action: z.literal("pass_remove"), documentId: z.string().regex(UUID) }).strict(),
  z
    .object({
      action: z.literal("confirm"),
      outcome: z.enum(CLIENT_CONFIRMATIONS),
      channel: z.enum(["whatsapp", "call", "sms", "email", "in_person"]).nullable(),
      note: z.string().trim().max(500).nullable(),
    })
    .strict(),
  z.object({ action: z.literal("request_confirmation"), channel: sendChannelSchema }).strict(),
]);

type Params = { params: Promise<{ kind: string; id: string }> };
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

async function gateFor(kindParam: string, id: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!(KINDS as readonly string[]).includes(kindParam) || !UUID.test(id)) return { response: notFound() };
  const kind = kindParam as FieldStartKind;
  const scope = kind === "call_out" ? await callOutOwner(gate.admin, id) : await additionalWorkOwner(gate.admin, id);
  const rights = fieldWorkRights(gate, kind === "call_out" ? "call_outs" : "additional_works", scope.ownerId);
  if (!scope.found || !rights.view) return { response: notFound() };
  return { gate, kind, rights };
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    return NextResponse.json({ ...(await fieldAccess(gate.admin, kind, id)), canEdit: rights.edit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the access");
  }
}

export async function POST(req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    if (!rights.edit) return NextResponse.json({ error: "You cannot change this." }, { status: 403 });
    const actor = { id: gate.userId, label: gate.label };
    const a = parsed.data;
    switch (a.action) {
      case "start":
        return NextResponse.json(await startFieldWork(gate.admin, kind, id, actor, a.payment ?? null));
      case "pass":
        await saveFieldPass(gate.admin, kind, id, a, actor);
        return NextResponse.json({ ok: true });
      case "pass_remove":
        await removeFieldPass(gate.admin, kind, id, a.documentId, actor);
        return NextResponse.json({ ok: true });
      case "confirm":
        if (kind !== "additional_work") return NextResponse.json({ error: "A call out needs no client confirmation." }, { status: 400 });
        return NextResponse.json(await confirmWork(gate.admin, id, a, actor));
      case "request_confirmation":
        if (kind !== "additional_work") return NextResponse.json({ error: "A call out needs no client confirmation." }, { status: 400 });
        return NextResponse.json(await requestWorkConfirmation(gate.admin, id, a.channel, actor));
    }
  } catch (error) {
    return contractErrorResponse(error, "Could not update");
  }
}
