import { NextRequest, NextResponse } from "next/server";

import { actorOf } from "@/lib/server/finance/route-helpers";
import { InvoicingError, invoiceRequestSchema, recordLineInvoice } from "@/lib/server/finance/work-orders";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Record a MAHER invoice against line items, in full or in part (BRD 5.1
 * Step 7, partial amounts decided 22 Oct). Lines may come from several
 * work orders. Finance queue Approve, which administrators do not get by
 * default. A retried submission with the same key returns the first one.
 *
 * Body: { idempotencyKey, number, date, total, note?, allocations: [{ line, amount }], filePath?, scan? }
 */
export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;

  const parsed = invoiceRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid invoice" }, { status: 400 });
  }

  try {
    const admin = await createAdminServerClient();
    const invoiceId = await recordLineInvoice(admin, parsed.data, actorOf(gate.access.profile));
    return NextResponse.json({ invoiceId });
  } catch (error) {
    if (error instanceof InvoicingError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Finance invoice error:", error);
    return NextResponse.json({ error: "Something went wrong. Nothing was recorded." }, { status: 500 });
  }
}
