import { NextRequest, NextResponse } from "next/server";

import { canOperateContract } from "@/lib/amc/access";
import { todayInDubai } from "@/lib/amc/contracts";
import { boardActionSchema } from "@/lib/amc/visits";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { boardData, performBoardAction } from "@/lib/server/amc/visits";

/**
 * The AMC visit board (DEV-392, 393, 394): a day of technicians with their
 * AMC visits, live jobs and leave (read only), and the visits still to
 * place. Placing, moving and reassigning need AMC Visits (Create or Edit)
 * or to operate the visit's contract. AMC coordinators publish these
 * changes without an approval step: AMC visits are not on the live board
 * until they are published to FSM (Phase 15).
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.visits.view && !gate.visits.edit && !gate.seesAll) {
    return NextResponse.json({ error: "The visit board needs AMC Visits (View)." }, { status: 403 });
  }
  const date = req.nextUrl.searchParams.get("date");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayInDubai();
  try {
    return NextResponse.json({ ...(await boardData(gate.admin, day)), canEdit: gate.visits.create || gate.visits.edit });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the board");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = boardActionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  const canChange = (ownerId: string | null) => gate.visits.create || gate.visits.edit || canOperateContract(gate.actor, ownerId);
  try {
    const result = await performBoardAction(gate.admin, parsed.data, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin), canChange);
    return NextResponse.json(result);
  } catch (error) {
    return contractErrorResponse(error, "Could not change the board");
  }
}
