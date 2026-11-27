import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { sendChannelSchema } from "@/lib/amc/send-channels";
import { additionalWorkOwner, markWorkShared } from "@/lib/server/amc/additional-works";
import { callOutOwner } from "@/lib/server/amc/call-outs";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";
import { fsmQuotationState, setFsmQuotation } from "@/lib/server/amc/fsm-quotation";
import { generateQuotation, latestQuotation, quotationBlocker, quotationFsmWrites, quotationsReady, retryQuotationFsm, shareAmcQuotation } from "@/lib/server/amc/quotations";

/*
  A call out's or additional work's quotation (27 Nov 2026), the two ways:

  GET                                             the latest quotation, and the FSM quotation number on file
  POST { action: "generate" }                     from the services entered; created in Zoho FSM too
  POST { action: "share", channel, pdfBase64? }   a client link (Copy link, WhatsApp) or email with the PDF
  POST { action: "retry_fsm" }                    FSM again, for one it did not take
  POST { action: "set_number", number }           the number of a quotation made in FSM (DEV-508)
*/

const KINDS = ["call_out", "additional_work"] as const;
type Kind = (typeof KINDS)[number];
type Params = { params: Promise<{ kind: string; id: string }> };
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }).strict(),
  z.object({ action: z.literal("share"), channel: sendChannelSchema, pdfBase64: z.string().max(14_000_000).nullable().optional() }).strict(),
  z.object({ action: z.literal("retry_fsm") }).strict(),
  z.object({ action: z.literal("set_number"), number: z.string().trim().min(1, "Enter the FSM quotation number").max(40) }).strict(),
]);

async function gateFor(kindParam: string, id: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!(KINDS as readonly string[]).includes(kindParam) || !UUID.test(id)) return { response: notFound() };
  const kind = kindParam as Kind;
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
    const table = kind === "call_out" ? "amc_call_outs" : "amc_additional_works";
    const [ready, quotation, number, { data: row }, fsmWrites] = await Promise.all([
      quotationsReady(gate.admin),
      latestQuotation(gate.admin, kind, id),
      fsmQuotationState(gate.admin, kind, id),
      gate.admin.from(table).select("status").eq("id", id).maybeSingle<{ status: string }>(),
      quotationFsmWrites(gate.admin),
    ]);
    /* A quotation is made before the work goes ahead: additional work until approved, a call out until closed. */
    const status = String(row?.status ?? "");
    const quotable = kind === "additional_work" ? ["identified", "quotation_prepared", "shared"].includes(status) : !["closed", "cancelled"].includes(status);
    /* What stops Generate quotation now (no services yet), shown on the card. */
    const blocker = quotable && ready ? await quotationBlocker(gate.admin, kind, id) : null;
    return NextResponse.json({ ready, quotation, fsmQuotation: number, canEdit: rights.edit, quotable, fsmWrites, blocker }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the quotation");
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
    const action = parsed.data;
    switch (action.action) {
      case "generate": {
        const result = await generateQuotation(gate.admin, kind, id, actor);
        return NextResponse.json(result);
      }
      case "share": {
        const result = await shareAmcQuotation(gate.admin, kind, id, { channel: action.channel, pdfBase64: action.pdfBase64 ?? null }, actor);
        /* Additional work waits on the client from here, as with the old Share quotation. */
        if (kind === "additional_work") await markWorkShared(gate.admin, id, actor);
        return NextResponse.json(result);
      }
      case "retry_fsm":
        return NextResponse.json({ fsmProblem: await retryQuotationFsm(gate.admin, kind, id, actor) });
      case "set_number":
        await setFsmQuotation(gate.admin, kind, id, action.number, actor);
        return NextResponse.json({ ok: true });
    }
  } catch (error) {
    return contractErrorResponse(error, "Could not update the quotation");
  }
}
