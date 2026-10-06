import { NextRequest, NextResponse } from "next/server";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { customerOverview, updateCustomer } from "@/lib/server/amc/business";
import { UUID, customerSchema } from "@/lib/server/amc/business-schemas";

/**
 * A customer's AMC view: details, properties, contracts (each separately,
 * only those the caller can see), assessments, additional-service quotes
 * and a summary. PATCH edits the live customer record; signed contract
 * snapshots never change.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  try {
    return NextResponse.json({
      overview: await customerOverview(gate.admin, { userId: gate.userId, canApprove: gate.seesAll }, customerId),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the customer");
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const parsed = customerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customers", customerId);
    if (refused) return refused;
    const customer = await updateCustomer(gate.admin, customerId, { ...parsed.data, email: parsed.data.email || null }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ customer });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the customer");
  }
}
