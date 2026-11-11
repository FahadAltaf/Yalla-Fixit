import { NextRequest, NextResponse } from "next/server";

import { bookSiteVisitSchema } from "@/lib/amc/enquiries";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { bookSiteVisit, listAmcPeople } from "@/lib/server/amc/enquiries";

/**
 * A site visit booked from a client or property page (as Book site visit on
 * an enquiry): GET gives who can be the assessor, POST books it.
 */
export async function GET() {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  return NextResponse.json({ people: await listAmcPeople(gate.admin), me: gate.userId }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const parsed = bookSiteVisitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json(await bookSiteVisit(gate.admin, parsed.data, { id: gate.userId, label: gate.label }), { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not book the site visit");
  }
}
