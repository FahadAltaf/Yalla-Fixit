import type { SupabaseClient } from "@supabase/supabase-js";

import { EVIDENCE_BUCKET } from "@/lib/finance/evidence";
import { invoiceEmailHtml, invoiceEmailSubject, type InvoiceEmailRequest } from "@/lib/finance/invoice-email";
import { deliveryMode, planEmail, type DeliveryMode } from "@/lib/server/finance/delivery-policy";
import { fetchClientEmailsLive, type ClientEmail } from "@/lib/server/finance/fsm-live";
import { InvoicingError } from "@/lib/server/finance/work-orders";
import { sendEmail } from "@/lib/server/send-email";

/**
 * Emailing the MAHER invoice to the client (BRD v1.4/v1.5 Step 10, TC28).
 *
 * Finance uploads the invoice PDF when it records the invoice; from the
 * work order it sends that PDF to the client by email, and the portal
 * records who sent it, when and to which addresses (finance.invoice_emails,
 * migration 20261126100000).
 *
 * The client is a real customer, so the email goes through the Finance
 * delivery policy, which fails closed: to the client only with
 * FINANCE_NOTIFY_LIVE=on; otherwise to NOTIFY_REDIRECT_TO alone, marked as
 * a test copy; with neither set, nothing is sent and Finance is told why.
 */

export type InvoiceEmailRecord = {
  id: string;
  to: string[];
  cc: string[];
  delivery: "live" | "redirect";
  sentBy: string | null;
  sentAt: string;
};

const missing = (error: { code?: string; message?: string } | null) =>
  Boolean(error && /invoice_emails|record_invoice_email|PGRST20[25]|42P01|42883|schema cache/i.test(`${error.code ?? ""} ${error.message ?? ""}`));

/** Whether migration 20261126100000 is applied (sending is refused until it is, so no send goes unrecorded). */
async function storageReady(admin: SupabaseClient): Promise<boolean> {
  const { error } = await admin.schema("finance").from("invoice_emails").select("id").limit(1);
  if (error && !missing(error)) throw new Error(error.message);
  return !error;
}

/** The emails sent for a work order's invoices, newest first, by invoice. Empty before the migration. */
export async function invoiceEmailsFor(admin: SupabaseClient, workOrderId: string): Promise<Map<string, InvoiceEmailRecord[]>> {
  const out = new Map<string, InvoiceEmailRecord[]>();
  const { data, error } = await admin
    .schema("finance")
    .from("invoice_emails")
    .select("id, invoice_id, to_emails, cc_emails, delivery, sent_by_label, sent_at")
    .eq("fsm_work_order_id", workOrderId)
    .order("sent_at", { ascending: false });
  if (error) {
    if (missing(error)) return out;
    throw new Error(error.message);
  }
  for (const r of data ?? []) {
    const id = String(r.invoice_id);
    out.set(id, [
      ...(out.get(id) ?? []),
      {
        id: String(r.id),
        to: (r.to_emails as string[]) ?? [],
        cc: (r.cc_emails as string[]) ?? [],
        delivery: r.delivery === "live" ? "live" : "redirect",
        sentBy: (r.sent_by_label as string | null) ?? null,
        sentAt: String(r.sent_at),
      },
    ]);
  }
  return out;
}

type InvoiceRow = { id: string; maher_invoice_number: string; invoice_date: string; file_path: string | null; maher_total?: number | null };

/** The invoice, only when it covers a line of this work order. */
async function invoiceOn(admin: SupabaseClient, workOrderId: string, invoiceId: string): Promise<InvoiceRow> {
  const fin = admin.schema("finance");
  const { data: covered, error: coverError } = await fin
    .from("line_invoice_allocations")
    .select("invoice_id")
    .eq("fsm_work_order_id", workOrderId)
    .eq("invoice_id", invoiceId)
    .limit(1);
  if (coverError) throw new Error(coverError.message);
  if (!covered?.length) throw new InvoicingError("That invoice is not on this work order.", 404);
  /* Every column: maher_total arrives with 20261118150000. */
  const { data, error } = await fin.from("line_invoices").select("*").eq("id", invoiceId).maybeSingle<InvoiceRow>();
  if (error) throw new Error(error.message);
  if (!data) throw new InvoicingError("That invoice is not on this work order.", 404);
  return data;
}

export type InvoiceEmailDraft = {
  /** The addresses Zoho FSM holds: the company's, and the one on the work order (they can be different people). Finance picks. */
  suggested: ClientEmail[];
  subject: string;
  clientName: string | null;
  workOrderNumber: string | null;
  hasFile: boolean;
  /** Where a send goes now: to the client (live), to the test inbox (redirect), or nowhere (blocked). */
  delivery: DeliveryMode;
  storageReady: boolean;
  sent: InvoiceEmailRecord[];
};

export async function invoiceEmailDraft(admin: SupabaseClient, workOrderId: string, invoiceId: string): Promise<InvoiceEmailDraft> {
  const invoice = await invoiceOn(admin, workOrderId, invoiceId);
  const [client, ready, sent] = await Promise.all([
    /* FSM unreachable: Finance types the address. */
    fetchClientEmailsLive(admin, workOrderId).catch(() => ({ workOrderNumber: null, clientName: null, emails: [] as ClientEmail[] })),
    storageReady(admin),
    invoiceEmailsFor(admin, workOrderId),
  ]);
  return {
    suggested: client.emails,
    subject: invoiceEmailSubject({ invoiceNumber: invoice.maher_invoice_number, workOrderNumber: client.workOrderNumber }),
    clientName: client.clientName,
    workOrderNumber: client.workOrderNumber,
    hasFile: Boolean(invoice.file_path),
    delivery: deliveryMode(),
    storageReady: ready,
    sent: sent.get(invoiceId) ?? [],
  };
}

export async function sendInvoiceEmail(
  admin: SupabaseClient,
  workOrderId: string,
  invoiceId: string,
  input: InvoiceEmailRequest,
  actor: { id: string; label: string },
): Promise<{ id: string; delivery: "live" | "redirect"; deliveredTo: string[] }> {
  const invoice = await invoiceOn(admin, workOrderId, invoiceId);
  const path = invoice.file_path;
  if (!path || path.includes("..")) throw new InvoicingError("Upload the MAHER invoice PDF first: there is nothing to attach.", 400);
  if (!(await storageReady(admin))) {
    throw new InvoicingError("Sending invoices is not set up yet: a database update (20261126100000) is still to be applied.", 503);
  }

  const client = await fetchClientEmailsLive(admin, workOrderId).catch(() => ({ workOrderNumber: null, clientName: null, emails: [] as ClientEmail[] }));
  const to = [...new Set(input.to)];
  const cc = [...new Set(input.cc)].filter((e) => !to.includes(e));
  const subject = invoiceEmailSubject({ invoiceNumber: invoice.maher_invoice_number, workOrderNumber: client.workOrderNumber });
  /* Live: the client and the copies; otherwise the test inbox only, saying who it was for; else nothing. */
  const plan = planEmail({ to: [...to, ...cc], subject });
  if (!plan.send) throw new InvoicingError(`Nothing was sent: ${plan.reason}.`, 503);
  const live = plan.redirectedFrom === null;

  const { data: blob, error: downloadError } = await admin.storage.from(EVIDENCE_BUCKET).download(path);
  if (downloadError || !blob) throw new InvoicingError("The uploaded invoice file could not be read. Nothing was sent.", 502);
  const content = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const filename = `Invoice-${invoice.maher_invoice_number.replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;

  const html = invoiceEmailHtml(
    {
      invoiceNumber: invoice.maher_invoice_number,
      invoiceDate: String(invoice.invoice_date).slice(0, 10),
      maherTotal: invoice.maher_total === null || invoice.maher_total === undefined ? null : Number(invoice.maher_total),
      workOrderNumber: client.workOrderNumber,
      clientName: client.clientName,
      message: input.message,
    },
    { redirectedFrom: plan.redirectedFrom },
  );
  const sent = await sendEmail({
    to: live ? to : plan.to,
    cc: live && cc.length ? cc : undefined,
    subject: plan.subject,
    html,
    attachment: { filename, content, contentType: blob.type || "application/pdf" },
  });

  const deliveredTo = live ? [...to, ...cc] : plan.to;
  const { data: id, error } = await admin.schema("finance").rpc("record_invoice_email", {
    p_invoice_id: invoiceId,
    p_work_order_id: workOrderId,
    p_to: to,
    p_cc: cc,
    p_subject: plan.subject,
    p_message: input.message ?? null,
    p_delivery: live ? "live" : "redirect",
    p_delivered_to: deliveredTo,
    p_provider_message_id: sent.data?.id ?? null,
    p_actor: actor.id,
    p_actor_label: actor.label,
  });
  if (error) {
    /* The email has gone; say so rather than inviting a second send. */
    console.error("[finance] invoice email sent but not recorded:", error.message);
    throw new InvoicingError("The email was sent, but the portal could not record it. Do not send it again; tell the portal team.", 500);
  }
  return { id: String(id), delivery: live ? "live" : "redirect", deliveredTo };
}
