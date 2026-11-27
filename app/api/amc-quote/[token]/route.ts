import { NextRequest, NextResponse } from "next/server";

import { performWorkAction } from "@/lib/server/amc/additional-works";
import { readAmcConfig } from "@/lib/server/amc/config";
import { ContractError } from "@/lib/server/amc/contracts";
import { decideAmcQuotation, publicQuotation, quotationByToken } from "@/lib/server/amc/quotations";
import { clientAddress, rateLimited } from "@/lib/server/request-origin";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * An AMC quotation's client link (27 Nov 2026), as Snagging's
 * /api/snagging/quotation/[token]: no login, the bearer of the token is the
 * client. GET returns the document to render; POST records their approve
 * (with their name) or reject (with a reason), once.
 */

const headers = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (rateLimited(`amc-quote:get:${clientAddress(req.headers)}`, 120, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  try {
    const { token } = await ctx.params;
    const admin = await createAdminServerClient();
    const found = await quotationByToken(admin, token);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status, headers });
    return NextResponse.json({ data: publicQuotation(found.row) }, { headers });
  } catch (error) {
    console.error("AMC quotation link GET error:", error);
    return NextResponse.json({ error: "Failed to load the quotation" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (rateLimited(`amc-quote:post:${clientAddress(req.headers)}`, 30, 10 * 60_000)) {
    return NextResponse.json({ error: "Too many requests. Try again later." }, { status: 429 });
  }
  try {
    const { token } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const decision = body?.decision === "approve" || body?.decision === "reject" ? (body.decision as "approve" | "reject") : null;
    if (!decision) return NextResponse.json({ error: "Choose approve or reject" }, { status: 400 });
    const name = typeof body.name === "string" ? body.name : "";
    const reason = typeof body.reason === "string" ? body.reason : null;
    const admin = await createAdminServerClient();
    const config = await readAmcConfig(admin);
    const found = await quotationByToken(admin, token);
    if ("error" in found) return NextResponse.json({ error: found.error }, { status: found.status });
    const workId = String(found.row.entity_id);
    const result = await decideAmcQuotation(admin, token, { decision, name, reason }, async (d, input) => {
      const actor = { id: null, label: `${input.name} (client)` };
      if (d === "approve") {
        await performWorkAction(
          admin,
          workId,
          { action: "approve", evidence: `Approved by ${input.name} on the client link (quotation ${input.quoteNumber})`, approvedBy: input.name },
          actor,
          config,
        );
      } else {
        await performWorkAction(admin, workId, { action: "reject", reason: `Rejected by ${input.name} on the client link: ${input.reason ?? ""}`.slice(0, 500) }, actor, config);
      }
    });
    return NextResponse.json({ data: result }, { headers });
  } catch (error) {
    if (error instanceof ContractError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("AMC quotation link POST error:", error);
    return NextResponse.json({ error: "Failed to record your decision" }, { status: 500 });
  }
}
