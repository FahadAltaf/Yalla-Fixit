import { NextRequest, NextResponse } from "next/server";

import { EVIDENCE_BUCKET } from "@/lib/finance/evidence";
import { workOrderAbilities } from "@/lib/server/finance/route-helpers";
import { requireResourceAccess } from "@/lib/server/require-access";
import { createAdminServerClient } from "@/lib/supabase/supabase-helpers";

/**
 * Open the MAHER invoice file recorded with an invoice (27 Oct): a
 * one-minute signed link to it. Only an invoice that covers a line of this
 * work order, for whoever may see the work order.
 */

export const dynamic = "force-dynamic";

const ID = /^[0-9A-Za-z_-]{1,40}$/;
const INVOICE_ID = /^[0-9A-Za-z-]{1,64}$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; invoiceId: string }> }) {
  const { id, invoiceId } = await ctx.params;
  if (!ID.test(id) || !INVOICE_ID.test(invoiceId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await requireResourceAccess(null, null);
  if (!gate.ok) return gate.response;
  const can = workOrderAbilities(gate.access.accessUser);
  if (!can.view && !can.verify) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const admin = await createAdminServerClient();
    const fin = admin.schema("finance");
    const { data: covered, error: coverError } = await fin
      .from("line_invoice_allocations")
      .select("invoice_id")
      .eq("fsm_work_order_id", id)
      .eq("invoice_id", invoiceId)
      .limit(1);
    if (coverError) throw new Error(coverError.message);
    if (!covered?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { data: invoice, error: invoiceError } = await fin.from("line_invoices").select("file_path").eq("id", invoiceId).maybeSingle();
    if (invoiceError) throw new Error(invoiceError.message);
    const path = invoice?.file_path ? String(invoice.file_path) : null;
    if (!path || path.includes("..")) return NextResponse.json({ error: "No file was recorded with this invoice" }, { status: 404 });

    const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUrl(path, 60);
    if (error) throw new Error(error.message);
    return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice file open error:", error);
    return NextResponse.json({ error: "Could not open the file" }, { status: 500 });
  }
}
