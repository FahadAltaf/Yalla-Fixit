import { NextRequest, NextResponse } from "next/server";

import { createEnquirySchema } from "@/lib/amc/enquiries";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse } from "@/lib/server/amc/contract-access";
import { createEnquiry, listEnquiries } from "@/lib/server/amc/enquiries";
import { requireEnquiryAccess } from "@/lib/server/amc/enquiry-access";
import { UUID } from "@/lib/server/amc/business-schemas";
import { pageParams } from "@/lib/server/snagging/search";
import { ActionType } from "@/types/types";

/**
 * AMC enquiries (BRD 5.1, DEV-358). GET: one page, filtered by stage
 * ("open" = not Won or Lost), owner, source, follow-up (overdue, today,
 * week), idle only, client, and a search. POST: log one; a new prospect is
 * created with it, or an existing client linked.
 */
export async function GET(req: NextRequest) {
  const gate = await requireEnquiryAccess();
  if (!gate.ok) return gate.response;
  const params = req.nextUrl.searchParams;
  const { page, pageSize, from, to } = pageParams(params, { defaultSize: 25 });
  const followUp = params.get("followUp");
  const ownerId = params.get("owner");
  const customerId = params.get("customer");
  try {
    const config = await readAmcConfig(gate.admin);
    const result = await listEnquiries(
      gate.admin,
      {
        stage: params.get("stage") || null,
        ownerId: ownerId === "me" ? gate.actor.id : ownerId && UUID.test(ownerId) ? ownerId : null,
        source: params.get("source") || null,
        followUp: followUp === "overdue" || followUp === "today" || followUp === "week" ? followUp : null,
        idleOnly: params.get("idle") === "1",
        customerId: customerId && UUID.test(customerId) ? customerId : null,
        q: params.get("q"),
        from,
        to,
      },
      config,
    );
    return NextResponse.json({ ...result, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not load enquiries");
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireEnquiryAccess(ActionType.CREATE);
  if (!gate.ok) return gate.response;
  const parsed = createEnquirySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const enquiry = await createEnquiry(gate.admin, parsed.data, gate.actor, await readAmcConfig(gate.admin));
    return NextResponse.json({ enquiry }, { status: 201 });
  } catch (error) {
    return contractErrorResponse(error, "Could not log the enquiry");
  }
}
