import { NextRequest, NextResponse } from "next/server";

import { invoiceEmailRequestSchema } from "@/lib/finance/invoice-email";
import { invoiceEmailDraft, sendInvoiceEmail } from "@/lib/server/finance/invoice-email";
import { actorOf } from "@/lib/server/finance/route-helpers";
import { InvoicingError } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Email the MAHER invoice to the client (BRD v1.4/v1.5 Step 10, TC28).
 * GET: the client's addresses from Zoho FSM, the subject, where a send
 * would go, and what was sent already. POST { to, cc?, message? }: send it
 * with the uploaded PDF attached, and record who, when and to whom.
 * Finance queue Approve, as recording the invoice is.
 */

export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,40}$/;
const INVOICE_ID = /^[0-9a-f-]{36}$/i;

type Ctx = { params: Promise<{ id: string; invoiceId: string }> };

async function gateAndIds(ctx: Ctx) {
  const { id, invoiceId } = await ctx.params;
  if (!ID.test(id) || !INVOICE_ID.test(invoiceId)) return { response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.APPROVE);
  if (!gate.ok) return { response: gate.response };
  return { id, invoiceId, gate };
}

function failure(error: unknown, context: string) {
  if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error(`Invoice email ${context} error:`, error);
  return NextResponse.json({ error: context === "send" ? "Something went wrong. Nothing was sent." : "Could not load the invoice email" }, { status: 500 });
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const r = await gateAndIds(ctx);
  if ("response" in r) return r.response;
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await invoiceEmailDraft(admin, r.id, r.invoiceId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error, "draft");
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const r = await gateAndIds(ctx);
  if ("response" in r) return r.response;
  const parsed = invoiceEmailRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid email" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await sendInvoiceEmail(admin, r.id, r.invoiceId, parsed.data, actorOf(r.gate.access.profile)));
  } catch (error) {
    return failure(error, "send");
  }
}
