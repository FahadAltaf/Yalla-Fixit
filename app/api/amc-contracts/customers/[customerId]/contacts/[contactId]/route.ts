import { NextRequest, NextResponse } from "next/server";

import { contactSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { updateContact } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Edit a contact, or deactivate it (active: false). Contacts are kept, never deleted. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ customerId: string; contactId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId, contactId } = await ctx.params;
  if (!UUID.test(customerId) || !UUID.test(contactId)) return NextResponse.json({ error: "Contact not found." }, { status: 404 });
  const parsed = contactSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customers", customerId);
    if (refused) return refused;
    const contact = await updateContact(gate.admin, customerId, contactId, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ contact });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the contact");
  }
}
