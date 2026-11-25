import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { chargeLineSchema, recordChargePaymentSchema } from "@/lib/amc/visit-charges";
import { additionalWorkOwner, saveWorkServices } from "@/lib/server/amc/additional-works";
import { readAmcConfig } from "@/lib/server/amc/config";
import { callOutOwner } from "@/lib/server/amc/call-outs";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";
import { draftWorkCharge, priceList, readCharge, recordChargePayment, saveCallOutServices, syncWorkCharge } from "@/lib/server/amc/visit-charges";

/*
  What a call out or additional work costs the client (18 Nov 2026).

  GET                                    the charge, and the services priced from the rate card for its property
  POST { action: "save_services", lines }  the services, each charged or free: a call out's charge, an
                                           additional work's quotation (19 Nov 2026, until approval).
                                           On a chargeable call out a line made free needs freeReason and
                                           AMC Allowances (Approve) or the AMC approver right (DEV-498).
  POST { action: "record_payment", amount, paidOn, mode, reference, note }
*/

const KINDS = ["call_out", "additional_work"] as const;
type Kind = (typeof KINDS)[number];
type Params = { params: Promise<{ kind: string; id: string }> };
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_services"), lines: z.array(chargeLineSchema).max(40) }).strict(),
  z.object({ action: z.literal("record_payment") }).passthrough(),
]);

async function gateFor(kindParam: string, id: string) {
  const gate = await requireContractAccess();
  if (!gate.ok) return { response: gate.response };
  if (!(KINDS as readonly string[]).includes(kindParam) || !UUID.test(id)) return { response: notFound() };
  const kind = kindParam as Kind;
  const scope = kind === "call_out" ? await callOutOwner(gate.admin, id) : await additionalWorkOwner(gate.admin, id);
  const rights = fieldWorkRights(gate, kind === "call_out" ? "call_outs" : "additional_works", scope.ownerId);
  /* Finance (AMC Payments) reads and records a charge's payment from the contract's Payments tab. */
  if (!scope.found || !(rights.view || gate.payments.view)) return { response: notFound() };
  return { gate, kind, rights };
}

export async function GET(_req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    const table = kind === "call_out" ? "amc_call_outs" : "amc_additional_works";
    const { data: row } = await gate.admin.from(table).select("contract_id, status").eq("id", id).maybeSingle<{ contract_id: string; status: string }>();
    if (!row) return notFound();
    if (kind === "additional_work") await syncWorkCharge(gate.admin, id, { id: gate.userId, label: gate.label }).catch(() => null);
    const [{ charge, ready }, services] = await Promise.all([readCharge(gate.admin, kind, id), priceList(gate.admin, row.contract_id)]);
    /* An additional work before approval: its quotation as its services (19 Nov 2026), changed until approved. */
    const beforeApproval = kind === "additional_work" && ["identified", "quotation_prepared", "shared"].includes(row.status);
    const shown = charge ?? (beforeApproval ? await draftWorkCharge(gate.admin, id) : null);
    return NextResponse.json(
      {
        charge: shown,
        ready,
        services,
        canEdit: rights.edit,
        servicesEditable: kind === "call_out" ? undefined : rights.edit && beforeApproval,
        /* DEV-498: may make a chargeable call out's line free (with a reason). */
        canMarkFree: gate.canApprove || gate.actor.allowanceOverride,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the charge");
  }
}

export async function POST(req: NextRequest, ctx: Params) {
  const { kind: kindParam, id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const { gate, kind, rights, response } = await gateFor(kindParam, id);
    if (!gate) return response;
    const actor = { id: gate.userId, label: gate.label };
    if (parsed.data.action === "save_services") {
      if (!rights.edit) return NextResponse.json({ error: "You cannot change this." }, { status: 403 });
      if (kind === "additional_work") {
        await saveWorkServices(gate.admin, id, parsed.data.lines, actor, await readAmcConfig(gate.admin));
        return NextResponse.json({ charge: await draftWorkCharge(gate.admin, id) });
      }
      return NextResponse.json({ charge: await saveCallOutServices(gate.admin, id, parsed.data.lines, actor, gate.canApprove || gate.actor.allowanceOverride) });
    }
    if (!rights.edit && !gate.payments.edit) return NextResponse.json({ error: "Recording a payment needs AMC Payments (Edit)." }, { status: 403 });
    const { action: _action, ...rest } = body as Record<string, unknown>;
    void _action;
    const payment = recordChargePaymentSchema.safeParse(rest);
    if (!payment.success) return NextResponse.json({ error: payment.error.issues[0]?.message ?? "Invalid payment" }, { status: 400 });
    return NextResponse.json(await recordChargePayment(gate.admin, kind, id, payment.data, actor));
  } catch (error) {
    return contractErrorResponse(error, "Could not update the charge");
  }
}
