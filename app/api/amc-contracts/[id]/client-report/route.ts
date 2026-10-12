import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { clientReportFacts, clientReportHtml, sendClientReport } from "@/lib/server/amc/client-report";
import { readAmcConfig } from "@/lib/server/amc/config";
import { contractErrorResponse, requireContractAccess, requireManagedContract } from "@/lib/server/amc/contract-access";

/**
 * The client report of one contract (DEV-410).
 *
 *   GET            the report as a page (preview, print), for whoever may read the contract
 *   GET ?format=json   the figures behind it
 *   POST {to?}     store the PDF, email it to the client (owner copied), and return the
 *                  prepared WhatsApp text; whoever operates the contract
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  try {
    const managed = await requireManagedContract(gate, id, "read");
    if (!managed.ok) return managed.response;
    const report = await clientReportFacts(gate.admin, id, await readAmcConfig(gate.admin));
    if (req.nextUrl.searchParams.get("format") === "json") return NextResponse.json({ report }, { headers: { "Cache-Control": "no-store" } });
    return new NextResponse(clientReportHtml(report), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return contractErrorResponse(error, "Could not build the client report");
  }
}

const sendSchema = z.object({ to: z.string().trim().email().max(200).optional().nullable() }).strict();

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireContractAccess();
  if (!gate.ok) return gate.response;
  const { id } = await ctx.params;
  const parsed = sendSchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  try {
    const managed = await requireManagedContract(gate, id, "write");
    if (!managed.ok) return managed.response;
    return NextResponse.json(await sendClientReport(gate.admin, id, { id: gate.userId, label: gate.label }, await readAmcConfig(gate.admin), parsed.data.to));
  } catch (error) {
    return contractErrorResponse(error, "Could not send the client report");
  }
}
