import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { InvoiceScanError, proposeAllocations, scanInvoiceFile } from "@/lib/server/finance/invoice-scan";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Read an uploaded MAHER invoice with the AI and propose which work-order
 * lines it covers, and how much of each. Records nothing: the person
 * confirms on the review screen, which posts to /api/finance/invoices.
 *
 * Body: { path, workOrderId? } (the work order it was uploaded from, if any)
 */
export const maxDuration = 120;

const bodySchema = z
  .object({ path: z.string().min(10).max(500), workOrderId: z.string().regex(/^[0-9A-Za-z_-]{1,40}$/).nullish() })
  .strict();

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  try {
    const admin = await createAdminServerClient();
    const scanned = await scanInvoiceFile(admin, parsed.data.path);
    return NextResponse.json(await proposeAllocations(admin, scanned, { workOrderId: parsed.data.workOrderId }));
  } catch (error) {
    if (error instanceof InvoiceScanError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Invoice scan error:", error);
    return NextResponse.json({ error: "The invoice could not be read. Try again, or record it by hand." }, { status: 502 });
  }
}
