import { NextRequest, NextResponse } from "next/server";

import { additionalWorkActionSchema } from "@/lib/amc/call-outs";
import { additionalWorkDetail, additionalWorkOwner, performWorkAction } from "@/lib/server/amc/additional-works";
import { crewSuggestion } from "@/lib/server/amc/call-outs";
import type { Trade } from "@/lib/amc/visits";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * One additional work (DEV-407).
 *
 *   GET    the finding, parties, quotation, status, photos and the slot and crew
 *   GET ?suggest&date&time&duration   technicians with the trade for a slot (free, or why not) and a suggested crew
 *   POST   update / quote / share / approve / reject / schedule / complete / invoice / pay
 */
const notFound = () => NextResponse.json({ error: "Additional work not found." }, { status: 404 });

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  try {
    const scope = await additionalWorkOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return notFound();
    const params = req.nextUrl.searchParams;
    if (params.has("suggest")) {
      const date = params.get("date") ?? "";
      const time = params.get("time") ?? "09:00";
      const duration = Math.min(1440, Math.max(15, Number(params.get("duration")) || 120));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: "Use a date and a time." }, { status: 400 });
      /* Only the work's trade and contract are needed to find a crew. */
      const { data: row } = await gate.admin.from("amc_additional_works").select("trade, contract_id").eq("id", id).maybeSingle<{ trade: Trade | null; contract_id: string }>();
      if (!row) return notFound();
      return NextResponse.json(await crewSuggestion(gate.admin, { contractId: row.contract_id, trade: row.trade, date, time, durationMinutes: duration, ignoreIds: [id] }));
    }
    return NextResponse.json({ ...(await additionalWorkDetail(gate.admin, id)), canEdit: rights.edit }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the additional work");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return notFound();
  const parsed = additionalWorkActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const scope = await additionalWorkOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return notFound();
    if (!rights.edit) return NextResponse.json({ error: "You cannot change this additional work." }, { status: 403 });
    return NextResponse.json(await performWorkAction(gate.admin, id, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin)));
  } catch (error) {
    return contractErrorResponse(error, "Could not update the additional work");
  }
}
