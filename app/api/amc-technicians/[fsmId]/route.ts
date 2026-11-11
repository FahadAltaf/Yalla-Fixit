import { NextRequest, NextResponse } from "next/server";

import { technicianProfileSchema } from "@/lib/amc/visits";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { getTechnicianRecord, saveTechnicianProfile } from "@/lib/server/amc/visits";
import { ActionType, ResourceType } from "@/types/types";

/** One technician's AMC profile and skills, for the AMC skills dialog on Workforce -> People. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ fsmId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.visits.edit && !gate.can(ResourceType.AMC_TECHNICIANS, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC technician skills." }, { status: 403 });
  }
  const { fsmId } = await ctx.params;
  try {
    return NextResponse.json({ ...(await getTechnicianRecord(gate.admin, decodeURIComponent(fsmId))), canEdit: gate.visits.edit });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the technician");
  }
}

/** Saves a technician's AMC profile and skills. AMC Visits (Edit). */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ fsmId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.visits.edit) return NextResponse.json({ error: "Changing technician skills needs AMC Visits (Edit)." }, { status: 403 });
  const { fsmId } = await ctx.params;
  const parsed = technicianProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await saveTechnicianProfile(gate.admin, decodeURIComponent(fsmId), parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the technician");
  }
}
