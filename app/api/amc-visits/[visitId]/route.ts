import { NextRequest, NextResponse } from "next/server";

import { canOperateContract, canReadContract } from "@/lib/amc/access";
import { visitActionSchema } from "@/lib/amc/visits";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { suggestForVisit, visitDetail, performVisitAction } from "@/lib/server/amc/visits";

/**
 * One AMC visit (DEV-396, 398, 399): its crew need, the client's
 * confirmation and every attempt, access and its pass.
 *
 *   GET                         the visit
 *   GET ?suggest&date&time      competent, free technicians for a slot, and the suggested crew
 *   POST                        request confirmation / log an attempt / set access
 *
 * Read: AMC Visits (View), or anyone who may read the contract. Change:
 * AMC Visits (Create or Edit), or whoever operates the contract.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  try {
    const config = await readAmcConfig(gate.admin);
    const detail = await visitDetail(gate.admin, visitId, config);
    if (!gate.visits.view && !gate.seesAll && !canReadContract(gate.actor, detail.ownerId)) {
      return NextResponse.json({ error: "Visit not found." }, { status: 404 });
    }
    const params = req.nextUrl.searchParams;
    if (params.has("suggest")) {
      const date = params.get("date") ?? detail.targetDate;
      const time = params.get("time") ?? "09:00";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: "Use a date and a time." }, { status: 400 });
      const duration = Number(params.get("duration")) || null;
      return NextResponse.json(await suggestForVisit(gate.admin, visitId, date, time, config, duration));
    }
    return NextResponse.json({
      visit: detail,
      canEdit: gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, detail.ownerId),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the visit");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ visitId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { visitId } = await ctx.params;
  if (!UUID.test(visitId)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const parsed = visitActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const canChange = (ownerId: string | null) => gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, ownerId);
  try {
    const result = await performVisitAction(gate.admin, visitId, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin), canChange);
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not update the visit");
  }
}
