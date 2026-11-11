import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { saveServiceMapping, serviceMappingOverview } from "@/lib/server/amc/fsm-integration";
import { ActionType, ResourceType } from "@/types/types";

/**
 * AMC service -> Zoho FSM service mapping. AMC users can see it; only AMC
 * approvers change it. No OAuth credential is ever returned.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  /* The FSM mapping page's own permission (as Snagging's per-page permissions). */
  if (!gate.can(ResourceType.AMC_FSM_MAPPING, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC FSM mapping." }, { status: 403 });
  }
  try {
    return NextResponse.json({ ...(await serviceMappingOverview(gate.admin)), canEdit: gate.canApprove });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the service mapping");
  }
}

const schema = z
  .object({
    amcServiceId: z.string().trim().min(1).max(100),
    /** Null removes the mapping. */
    fsmServiceId: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/, "Use the FSM service id").nullable(),
    fsmServiceName: z.string().trim().max(200).nullable().optional(),
    active: z.boolean().default(true),
  })
  .strict();

export async function PUT(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.can(ResourceType.AMC_FSM_MAPPING, ActionType.VIEW)) {
    return NextResponse.json({ error: "Your role does not include AMC FSM mapping." }, { status: 403 });
  }
  if (!gate.canApprove) {
    return NextResponse.json({ error: "Only AMC approvers can change the FSM service mapping." }, { status: 403 });
  }
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  try {
    await saveServiceMapping(gate.admin, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json(await serviceMappingOverview(gate.admin));
  } catch (error) {
    return contractErrorResponse(error, "Could not save the service mapping");
  }
}
