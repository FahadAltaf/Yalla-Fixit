import { NextRequest, NextResponse } from "next/server";

import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import {
  approveQuotation,
  QuotationDecisionError,
  rejectQuotation,
  type QuoteRef,
} from "@/lib/server/snagging/quotation";
import { hashReportToken } from "@/lib/server/snagging/report-token";

/**
 * Public client quotation page (FR-2.06, §5). No login: the bearer of the
 * hashed-at-rest token is the client. GET returns the quotation to render;
 * POST records their approve/reject decision (once only).
 */
const SELECT =
  "id, job_id, quote_number, status, currency, subtotal, tax_rate, tax_amount, total, lines, " +
  "scope_of_work, terms, property_snapshot, created_at, sent_at, approved_at, decided_at, " +
  "rejected_reason, approved_by_name, approval_token_expires_at";

type QuoteRow = Record<string, unknown> & {
  id: string;
  job_id: string;
  quote_number: string;
  status: string;
  approval_token_expires_at: string | null;
};

async function findByToken(token: string) {
  if (!token || token.length < 16) return { error: NextResponse.json({ error: "Invalid link" }, { status: 404 }) };
  const admin = await createAdminServerClient();
  const { data, error } = await admin
    .from("snagging_quotations")
    .select(SELECT)
    .eq("approval_token_hash", hashReportToken(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { error: NextResponse.json({ error: "This quotation link is not available" }, { status: 404 }) };
  const quote = data as unknown as QuoteRow;
  if (quote.approval_token_expires_at && new Date(quote.approval_token_expires_at).getTime() < Date.now()) {
    return { error: NextResponse.json({ error: "This quotation link has expired" }, { status: 410 }) };
  }
  return { admin, quote };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;
    return NextResponse.json(
      { data: found.quote },
      { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
    );
  } catch (error) {
    console.error("Public quotation GET error:", error);
    return NextResponse.json({ error: "Failed to load the quotation" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await ctx.params;
    const found = await findByToken(token);
    if (found.error) return found.error;
    const { admin, quote } = found;

    const body = await req.json().catch(() => ({}));
    const decision = String(body.decision ?? "");
    const name = typeof body.name === "string" ? body.name.trim() || null : null;
    const contact = typeof body.contact === "string" ? body.contact.trim() || null : null;
    const ref = quote as unknown as QuoteRef;

    try {
      if (decision === "approve") {
        const data = await approveQuotation(admin, ref, { name, contact, origin: "client" });
        return NextResponse.json({ data });
      }
      if (decision === "reject") {
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) return NextResponse.json({ error: "A reason is required to reject" }, { status: 400 });
        const data = await rejectQuotation(admin, ref, { reason, name, contact, origin: "client" });
        return NextResponse.json({ data });
      }
      return NextResponse.json({ error: "Choose approve or reject" }, { status: 400 });
    } catch (e) {
      if (e instanceof QuotationDecisionError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }
  } catch (error) {
    console.error("Public quotation POST error:", error);
    return NextResponse.json({ error: "Failed to record your decision" }, { status: 500 });
  }
}
