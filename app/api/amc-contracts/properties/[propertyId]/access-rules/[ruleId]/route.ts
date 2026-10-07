import { NextRequest, NextResponse } from "next/server";

import { accessRuleSchema } from "@/lib/amc/client-profile";
import { UUID } from "@/lib/server/amc/business-schemas";
import { updateAccessRule } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { refuseCustomerEdit } from "@/lib/server/amc/customer-access";

/** Edit an access rule, or switch it off (active: false). */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ propertyId: string; ruleId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { propertyId, ruleId } = await ctx.params;
  if (!UUID.test(propertyId) || !UUID.test(ruleId)) return NextResponse.json({ error: "Access rule not found." }, { status: 404 });
  const parsed = accessRuleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const refused = await refuseCustomerEdit(gate, "customer_properties", propertyId);
    if (refused) return refused;
    return NextResponse.json({ rule: await updateAccessRule(gate.admin, propertyId, ruleId, parsed.data, { id: gate.userId, label: gate.label }) });
  } catch (error) {
    return contractErrorResponse(error, "Could not save the access rule");
  }
}
