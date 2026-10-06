import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { getDiscountConfig, saveDiscountConfig } from "@/lib/server/amc/business";
import { discountConfigSchema } from "@/lib/server/amc/business-schemas";

/**
 * The AMC discount on additional services. Off, with no rate, until an AMC
 * approver sets one (BUSINESS DECISION REQUIRED: no 25% is assumed). Only
 * listed services and categories qualify.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    return NextResponse.json({ config: await getDiscountConfig(gate.admin), canEdit: gate.canApprove });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the discount settings");
  }
}

export async function PUT(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  if (!gate.canApprove) return NextResponse.json({ error: "Only AMC approvers can change the discount." }, { status: 403 });
  const parsed = discountConfigSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ config: await saveDiscountConfig(gate.admin, parsed.data, { id: gate.userId, label: gate.label }), canEdit: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the discount settings");
  }
}
