import { NextRequest, NextResponse } from "next/server";

import { contactSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { createContact, listContacts } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** A client's contacts (BRD 5.9): primary, alternate, accounts, tenant, owner, signatory, on site. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  try {
    return NextResponse.json(await listContacts(gate.admin, customerId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the contacts");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const parsed = contactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customers", customerId);
    if (refused) return refused;
    const contact = await createContact(gate.admin, customerId, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not add the contact");
  }
}
