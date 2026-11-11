import { NextRequest, NextResponse } from "next/server";

import { UUID } from "@/lib/server/amc/business-schemas";
import { clientAdditionalWorkTotals, clientPaymentsReceived, clientSchedule, clientServiceHistory } from "@/lib/server/amc/client-history";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * A client's history across their contracts (BRD 5.9), for the client page:
 *
 *   ?part=schedule        planned visits, upcoming and past
 *   ?part=service         visits done, call outs, additional work
 *   ?part=payments        payments received (AMC Payments, View)
 *   ?part=additional_work the additional-work totals (BRD 5.14 roll-up)
 *
 * Any AMC user who can open the client, as the client's other tabs.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const part = req.nextUrl.searchParams.get("part") ?? "service";
  const headers = { "Cache-Control": "no-store" };
  try {
    if (part === "schedule") return NextResponse.json(await clientSchedule(gate.admin, customerId), { headers });
    if (part === "service") return NextResponse.json(await clientServiceHistory(gate.admin, customerId), { headers });
    if (part === "additional_work") return NextResponse.json(await clientAdditionalWorkTotals(gate.admin, customerId), { headers });
    if (part === "payments") {
      if (!gate.payments.view && !gate.seesAll) return NextResponse.json({ error: "Payments need AMC Payments (View)." }, { status: 403 });
      return NextResponse.json(await clientPaymentsReceived(gate.admin, customerId), { headers });
    }
    return NextResponse.json({ error: "Unknown part." }, { status: 400 });
  } catch (error) {
    return contractErrorResponse(error, "Could not load the client's history");
  }
}
