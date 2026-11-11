import { NextRequest, NextResponse } from "next/server";

import { communicationSchema } from "@/lib/amc/client-profile";
import { getCustomer } from "@/lib/server/amc/business";
import { UUID } from "@/lib/server/amc/business-schemas";
import { addCommunication, listCommunications } from "@/lib/server/amc/client-profile";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";

/**
 * A client's communication log (BRD 5.9). Any AMC user who can open the
 * client may log a call, message or meeting; entries are never edited or
 * deleted. Portal sends add system entries in later phases.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const params = req.nextUrl.searchParams;
  try {
    return NextResponse.json(
      await listCommunications(
        gate.admin,
        customerId,
        Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200),
        Math.max(Number(params.get("offset")) || 0, 0),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return contractErrorResponse(error, "Could not load the communication log");
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ customerId: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { customerId } = await ctx.params;
  if (!UUID.test(customerId)) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const parsed = communicationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    await getCustomer(gate.admin, customerId);
    await addCommunication(gate.admin, customerId, parsed.data, { id: gate.userId, label: gate.label });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not log the communication");
  }
}
