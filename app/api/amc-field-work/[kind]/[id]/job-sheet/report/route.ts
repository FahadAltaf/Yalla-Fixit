import { NextRequest, NextResponse } from "next/server";

import { additionalWorkOwner } from "@/lib/server/amc/additional-works";
import { callOutOwner } from "@/lib/server/amc/call-outs";
import { contractErrorResponse, requireContractAccess } from "@/lib/server/amc/contract-access";
import { fieldReportFacts, fieldReportLink } from "@/lib/server/amc/field-job-sheets";
import { UUID, fieldWorkRights } from "@/lib/server/amc/field-work-access";

/**
 * Opens a call out's or additional work's stored service report (a link
 * that expires in five minutes), or with ?facts=1 the report's facts, which
 * the portal draws and builds the PDF from (18 Nov 2026).
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ kind: string; id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { kind, id } = await ctx.params;
  const notFound = NextResponse.json({ error: "Not found." }, { status: 404 });
  if ((kind !== "call_out" && kind !== "additional_work") || !UUID.test(id)) return notFound;
  try {
    const scope = kind === "call_out" ? await callOutOwner(gate.admin, id) : await additionalWorkOwner(gate.admin, id);
    const rights = fieldWorkRights(gate, kind === "call_out" ? "call_outs" : "additional_works", scope.ownerId);
    if (!scope.found || !rights.view) return notFound;
    if (req.nextUrl.searchParams.get("facts")) {
      return NextResponse.json({ facts: await fieldReportFacts(gate.admin, kind, id) }, { headers: { "Cache-Control": "no-store" } });
    }
    const url = await fieldReportLink(gate.admin, kind, id);
    if (!url) return NextResponse.json({ error: "There is no service report yet." }, { status: 404 });
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not open the report");
  }
}
