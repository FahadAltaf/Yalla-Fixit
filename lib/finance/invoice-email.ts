import { z } from "zod";

import { clientEmailHtml, escapeEmailHtml } from "@/lib/email-brand";

/**
 * The MAHER invoice emailed to the client from the portal (BRD v1.4/v1.5
 * Step 10, TC28): until Zoho Finance is live, Finance uploads the invoice
 * against the work order and sends it from here, by email, not WhatsApp.
 * Pure: the wording and the checks, so the route and the tests agree.
 *
 * The wording, the sender and the copy list are still open in the BRD
 * (section 7); Finance can add its own message above the details.
 */

const EMAIL = z.string().trim().toLowerCase().email("Enter a valid email address").max(254);

export const invoiceEmailRequestSchema = z
  .object({
    to: z.array(EMAIL).min(1, "Add the client's email address").max(10, "At most 10 addresses"),
    cc: z.array(EMAIL).max(10, "At most 10 addresses in copy").default([]),
    message: z.string().trim().max(2000).nullish(),
  })
  .strict();

export type InvoiceEmailRequest = z.infer<typeof invoiceEmailRequestSchema>;

/** Addresses typed into one box: split on commas, semicolons and spaces, de-duplicated. */
export function splitEmails(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export const isEmail = (value: string) => EMAIL.safeParse(value).success;

export type InvoiceEmailFacts = {
  invoiceNumber: string;
  /** YYYY-MM-DD. */
  invoiceDate: string;
  /** The total printed on the MAHER invoice, when Finance entered it. */
  maherTotal: number | null;
  workOrderNumber: string | null;
  clientName: string | null;
  message?: string | null;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (date: string) => `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const aed = (n: number) => `AED ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function invoiceEmailSubject(f: Pick<InvoiceEmailFacts, "invoiceNumber" | "workOrderNumber">): string {
  return `Invoice ${f.invoiceNumber}${f.workOrderNumber ? ` for work order ${f.workOrderNumber}` : ""} | Yalla Fix It`;
}

/** The email body: the client layout, Finance's message, the invoice's details; the PDF goes as an attachment. */
export function invoiceEmailHtml(f: InvoiceEmailFacts, options: { redirectedFrom?: string[] | null } = {}): string {
  const message = (f.message ?? "").trim();
  const paragraphs = [
    ...(message
      ? message
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeEmailHtml(p).replace(/\n/g, "<br>")}</p>`)
      : [`<p>Please find attached our invoice ${escapeEmailHtml(f.invoiceNumber)}${f.workOrderNumber ? ` for work order ${escapeEmailHtml(f.workOrderNumber)}` : ""}.</p>`]),
    "<p>If you have any question about it, simply reply to this email.</p>",
  ];
  const html = clientEmailHtml({
    eyebrow: "Invoice",
    heading: `Invoice ${f.invoiceNumber}`,
    greeting: f.clientName ? `Dear ${f.clientName},` : "Dear customer,",
    paragraphs,
    details: [
      { label: "Invoice number", value: f.invoiceNumber },
      { label: "Invoice date", value: longDate(f.invoiceDate) },
      ...(f.maherTotal !== null ? [{ label: "Amount", value: aed(f.maherTotal) }] : []),
      ...(f.workOrderNumber ? [{ label: "Work order", value: f.workOrderNumber }] : []),
    ],
    footnote: "The invoice is attached to this email as a PDF.",
  });
  /* Development only (NOTIFY_REDIRECT_TO): say who it was really for. */
  if (!options.redirectedFrom?.length) return html;
  return (
    `<div style="border:1px solid #f59e0b;background:#fffbeb;padding:8px 12px;margin-bottom:12px;font:13px sans-serif">` +
    `<strong>Test copy.</strong> FINANCE_NOTIFY_LIVE is not on, so this invoice email was not sent to the client.<br>` +
    `It was for: ${escapeEmailHtml(options.redirectedFrom.join(", "))}</div>` +
    html
  );
}
