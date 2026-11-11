import { NextRequest, NextResponse } from "next/server";

import { technicianProfileSchema } from "@/lib/amc/visits";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { saveTechnicianProfile } from "@/lib/server/amc/visits";

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
