import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { listChecklist, saveChecklistItem } from "@/lib/server/amc/business";
import { checklistItemSchema } from "@/lib/server/amc/business-schemas";

/**
 * The assessment checklist. Everyone with AMC access can read it; AMC
 * approvers edit it. New assessments copy the active items; past
 * assessments keep the labels they were made with.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ items: await listChecklist(gate.admin, true), canEdit: gate.canApprove });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the checklist");
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.canApprove) return NextResponse.json({ error: "Only AMC approvers can edit the checklist." }, { status: 403 });
  const parsed = checklistItemSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ items: await saveChecklistItem(gate.admin, parsed.data, { id: gate.userId, label: gate.label }), canEdit: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the checklist item");
  }
}
