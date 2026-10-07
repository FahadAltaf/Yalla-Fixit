import { NextRequest, NextResponse } from "next/server";

import { consentSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { setMarketingConsent } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Marketing consent, kept apart from the contact details, with when, how and who (BRD 5.9). */
export async function POST(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const parsed = consentSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customers", customerId);
    if (refused) return refused;
    await setMarketingConsent(gate.admin, customerId, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return contractErrorResponse(error, "Could not record the consent");
  }
}
