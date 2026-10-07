import { NextRequest, NextResponse } from "next/server";

import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { createCustomer, searchCustomers } from "@/lib/server/amc/business";
import { customerSchema } from "@/lib/server/amc/business-schemas";

/**
 * Shared customers (one record per real customer, used by AMC today and
 * meant to be shared by other modules). GET searches by name, Customer ID,
 * phone, email or company; POST creates one.
 */
export async function GET(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  try {
    const lifecycle = req.nextUrl.searchParams.get("lifecycle");
    return NextResponse.json({
      customers: await searchCustomers(
        gate.admin,
        req.nextUrl.searchParams.get("q") ?? "",
        Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 25, 1), 200),
        lifecycle === "prospect" || lifecycle === "client" || lifecycle === "former" ? lifecycle : null,
      ),
    });
  } catch (error) {
    return contractErrorResponse(error, "Could not load customers");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = customerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const customer = await createCustomer(gate.admin, { ...parsed.data, email: parsed.data.email || null }, { id: gate.userId, label: gate.label });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not create the customer");
  }
}
