import { NextRequest, NextResponse } from "next/server";

import { callOutActionSchema } from "@/lib/amc/call-outs";
import type { Trade } from "@/lib/amc/visits";
import { callOutDetail, callOutOwner, crewSuggestion, performCallOutAction } from "@/lib/server/amc/call-outs";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * One call out (DEV-405, 406).
 *
 *   GET                                 the call out, its allowance, photos and additional works
 *   GET ?suggest&date&time&duration     technicians with the trade for a slot (free, or why not), a
 *                                       suggested crew, and how many on the roster have the trade
 *   POST                                schedule / attend / record / close / cancel / flag misuse / acknowledged
 */
const notFound = () => NextResponse.json({ error: "Call out not found." }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  try {
    const params = req.nextUrl.searchParams;
    if (params.has("suggest")) {
      /* Only the call out's trade and contract: the full record (allowance, photos, works) is not needed to find a crew. */
      const [scope, row] = await Promise.all([
        callOutOwner(gate.admin, id),
        gate.admin.from("amc_call_outs").select("trade, contract_id").eq("id", id).maybeSingle<{ trade: Trade | null; contract_id: string }>(),
      ]);
      const rights = fieldWorkRights(gate, "call_outs", scope.ownerId);
      if (!scope.found || !rights.view || !row.data) return notFound();
      const date = params.get("date") ?? "";
      const time = params.get("time") ?? "09:00";
      const duration = Math.min(720, Math.max(15, Number(params.get("duration")) || 120));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: "Use a date and a time." }, { status: 400 });
      /* As for a planned visit: only technicians with the trade (or an expired certificate for it), not the whole roster. */
      return NextResponse.json(
        await crewSuggestion(gate.admin, { contractId: row.data.contract_id, trade: row.data.trade, date, time, durationMinutes: duration, ignoreIds: [id] }),
      );
    }
    const [scope, config] = await Promise.all([callOutOwner(gate.admin, id), readAmcConfig(gate.admin)]);
    const rights = fieldWorkRights(gate, "call_outs", scope.ownerId);
    if (!scope.found || !rights.view) return notFound();
    const detail = await callOutDetail(gate.admin, id, config);
    return NextResponse.json({ ...detail, canEdit: rights.edit, canOverride: rights.override }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the call out");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const parsed = callOutActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = await callOutOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, "call_outs", scope.ownerId);
    if (!scope.found || !rights.view) return notFound();
    if (!rights.edit) return NextResponse.json({ error: "You cannot change this call out." }, { status: 403 });
    return NextResponse.json(await performCallOutAction(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin)));
  } catch (error) {
    return contractErrorResponse(error, "Could not update the call out");
  }
}
