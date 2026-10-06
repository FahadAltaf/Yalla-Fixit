import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createProperty, getCustomer, listProperties } from "@/lib/server/amc/business";
import { UUID, propertySchema } from "@/lib/server/amc/business-schemas";

/** A customer's properties: list, and add one. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  try {
    return NextResponse.json({ properties: await listProperties(gate.admin, customerId) });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the properties");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const parsed = propertySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await getCustomer(gate.admin, customerId);
    const property = await createProperty(gate.admin, { ...parsed.data, customerId }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ property }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the property");
  }
}
