import { NextRequest, NextResponse } from "next/server";

import { mobileListQuerySchema } from "@/lib/amc/mobile-sync";
import { listMobileVisits, mobileErrorResponse, requireMobileTechnician } from "@/lib/server/amc/mobile-sync";

/**
 * GET /api/amc-sync/visits -- the mobile app's AMC visits, as cards.
 *
 * Only what a card shows: when, the short place, the type, the status and
 * how many services. A visit's contents come from /api/amc-sync/visits/[id]
 * when it is opened.
 *
 *   ?list=active                       Today and Upcoming (the default)
 *   ?list=done&limit=20                Done, newest first
 *   &before=<day>&before_id=<id>       Done's next page (next_before / next_before_id)
 *
 * The signed-in technician's visits only (their crew, or the site visits
 * they assess). Bearer token, Mobile App permission.
 */
export async function GET(req: NextRequest) {
  const gate = await requireMobileTechnician(req);
  if (!gate.ok) return gate.response;
  const parsed = mobileListQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    return NextResponse.json({ data: await listMobileVisits(gate.tech, parsed.data) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mobileErrorResponse(error, "Could not load your visits");
  }
}
