import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { InvoiceScanError, invoiceScanConfigured, signInvoiceUpload } from "@/lib/server/finance/invoice-scan";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";
import { ActionType, ResourceType } from "@/types/types";

/**
 * Upload a MAHER invoice to be read: a one-time upload URL into the private
 * finance-evidence bucket (invoices/). Finance queue Approve, as recording
 * the invoice is. Says first whether scanning is set up, so a file is not
 * uploaded for nothing.
 *
 * Body: { fileName, contentType, size }
 */
const bodySchema = z
  .object({ fileName: z.string().trim().min(1).max(255), contentType: z.string().max(200).default(""), size: z.number().int().positive() })
  .strict();

export async function POST(req: NextRequest) {
  const gate = await requireResourceAccess(ResourceType.FINANCE_QUEUE, ActionType.APPROVE);
  if (!gate.ok) return gate.response;
  if (!invoiceScanConfigured()) {
    return NextResponse.json({ error: "Invoice scanning is not set up yet (OPENAI_API_KEY). Record the invoice by hand on the work order." }, { status: 503 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid file" }, { status: 400 });
  try {
    const admin = await createAdminServerClient();
    return NextResponse.json(await signInvoiceUpload(admin, parsed.data));
  } catch (error) {
    if (error instanceof InvoiceScanError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Invoice upload error:", error);
    return NextResponse.json({ error: "Could not prepare the upload" }, { status: 500 });
  }
}
