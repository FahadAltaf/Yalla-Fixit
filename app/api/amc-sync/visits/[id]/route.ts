import { NextRequest, NextResponse } from "next/server";

import { mobileDetailQuerySchema } from "@/lib/amc/mobile-sync";
import { mobileErrorResponse, mobileVisitDetail, requireMobileTechnician } from "@/lib/server/amc/mobile-sync";

/**
 * GET /api/amc-sync/visits/[id]?kind=ppm&version=<v> -- one visit, when the
 * mobile app opens it.
 *
 * The top of the visit (when and where, client and access, crew, services)
 * and, for a planned visit, its job sheet: trades, checklist, photos (links
 * valid for an hour), the property's assets. A later open sends the version
 * it holds and hears { unchanged: true } when nothing moved, which costs two
 * small reads instead of the whole visit.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMobileTechnician(req);
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Visit not found." }, { status: 404 });
  const parsed = mobileDetailQuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const data = await mobileVisitDetail(gate.tech, parsed.data.kind, id, parsed.data.version);
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mobileErrorResponse(error, "Could not load the visit");
  }
}
