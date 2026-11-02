import { randomUUID } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { EVIDENCE_BUCKET, safeEvidenceName } from "@/lib/finance/evidence";
import { matchInvoice, referenceKey, scannedReferences, type CandidateLine, type MatchResult, type ScannedInvoice } from "@/lib/finance/invoice-match";
import { addDaysToDateString, todayInZone, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { fetchWorkOrderLive, fetchWorkOrdersLive } from "@/lib/server/finance/fsm-live";
import { invoiceCapsFor, WORK_ORDER_MAX_DAYS } from "@/lib/server/finance/work-orders";

/**
 * Reading a MAHER invoice (22 Oct: AI reading; 27 Oct: with Claude, a light
 * model, as the user asked). The file goes to the private finance-evidence bucket under
 * invoices/; the model reads the invoice number, date, totals, the work
 * order and quotation numbers on it and its lines; lib/finance/
 * invoice-match.ts proposes which work-order lines it covers. Nothing is
 * recorded until a person confirms (POST /api/finance/invoices).
 *
 * Needs ANTHROPIC_API_KEY (and optionally ANTHROPIC_INVOICE_MODEL; Claude
 * Haiku 5.5 by default). Without the key the upload says scanning is not set
 * up, and invoices are recorded by hand on the work order.
 */

export const INVOICE_PREFIX = "invoices/";
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, "pdf" | "image"> = {
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
};

export class InvoiceScanError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const invoiceScanConfigured = () => Boolean(process.env.ANTHROPIC_API_KEY);

/* A light, fast model is enough to read printed fields (27 Oct). */
const INVOICE_MODEL = process.env.ANTHROPIC_INVOICE_MODEL || "claude-haiku-5-5";

function contentTypeOf(fileName: string, browserType: string): string | null {
  if (browserType in TYPES) return browserType;
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null;
}

/** A one-time upload URL for the invoice file. */
export async function signInvoiceUpload(admin: SupabaseClient, input: { fileName: string; contentType: string; size: number }) {
  const contentType = contentTypeOf(input.fileName, input.contentType);
  if (!contentType) throw new InvoiceScanError(`${input.fileName}: a PDF or a photo (JPG, PNG, WEBP) of the invoice`, 400);
  if (input.size > MAX_BYTES) throw new InvoiceScanError(`${input.fileName} is over 10 MB`, 400);
  const path = `${INVOICE_PREFIX}${randomUUID()}-${safeEvidenceName(input.fileName)}`;
  const { data, error } = await admin.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(error.message);
  return { path, signedUrl: data.signedUrl, contentType };
}

/* Structured output: every field present, null when not on the invoice. */
const InvoiceSchema = z.object({
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable().describe("YYYY-MM-DD"),
  currency: z.string().nullable(),
  subtotal: z.number().nullable(),
  vat: z.number().nullable(),
  total: z.number().nullable(),
  references: z
    .array(z.string())
    .describe("Every work order number (like WO3546) and quotation or estimate number printed anywhere on the invoice."),
  lines: z.array(
    z.object({
      description: z.string(),
      quantity: z.number().nullable(),
      unitPrice: z.number().nullable(),
      amount: z.number().nullable().describe("The line's amount as printed."),
      reference: z.string().nullable().describe("A work order or quotation number printed on this line, if any."),
    }),
  ),
});

const PROMPT = `You are reading an invoice issued from the MAHER accounting system by a property maintenance company in the UAE.
Extract exactly what is printed; do not guess or calculate missing values (use null).
- invoiceNumber: the invoice number as printed (for example a MAHER invoice number).
- invoiceDate: the invoice's date (labelled Invoice Date, Date or Dated), written as YYYY-MM-DD whatever format is printed. Dates in the UAE are day-first: 05/10/2026 is 5 October 2026. Use null when the document shows no invoice date; do not use a signature, visit or due date instead.
- subtotal, vat, total: the invoice's totals as printed (AED unless another currency is shown).
- references: every work order number (often like WO3546) and quotation/estimate number anywhere on the invoice.
- lines: each billed line with its description, quantity, unit price, line amount, and any work order or quotation number printed on that line.`;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/*
  The invoice date as YYYY-MM-DD, whatever format the model gave back: the
  ISO form asked for, day-first numbers (05/10/2026), or with a month name
  ("Oct 23, 2026", "23 October 2026"). Null when it is not a real date.
*/
export function invoiceDateOf(text: string | null | undefined): string | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const real = (y: number, m: number, d: number) => {
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
  };
  const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return real(Number(m[1]), Number(m[2]), Number(m[3]));
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return real(year(m[3]), Number(m[2]), Number(m[1]));
  const month = (name: string) => MONTHS.indexOf(name.slice(0, 3)) + 1;
  m = t.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && month(m[1]) > 0) return real(Number(m[3]), month(m[1]), Number(m[2]));
  m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)\.?[\s,-]+(\d{4})$/);
  if (m && month(m[2]) > 0) return real(Number(m[3]), month(m[2]), Number(m[1]));
  return null;
}

/** Reads the uploaded invoice with the model. */
export async function scanInvoiceFile(admin: SupabaseClient, path: string): Promise<ScannedInvoice> {
  if (!invoiceScanConfigured()) throw new InvoiceScanError("Invoice scanning is not set up yet (ANTHROPIC_API_KEY).", 503);
  if (!path.startsWith(INVOICE_PREFIX) || path.includes("..")) throw new InvoiceScanError("Not an uploaded invoice", 400);

  const { data: blob, error } = await admin.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) throw new InvoiceScanError("The uploaded invoice could not be read back. Upload it again.", 404);
  const contentType = blob.type && blob.type in TYPES ? blob.type : (contentTypeOf(path, "") ?? "application/pdf");
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.messages.parse({
      model: INVOICE_MODEL,
      max_tokens: 16000,
      /* Reading printed fields: low effort is enough and keeps the scan quick. */
      output_config: { effort: "low", format: zodOutputFormat(InvoiceSchema) },
      messages: [
        {
          role: "user",
          content: [
            TYPES[contentType] === "pdf"
              ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
              : { type: "image", source: { type: "base64", media_type: contentType as "image/jpeg" | "image/png" | "image/webp", data: base64 } },
            { type: "text", text: PROMPT },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new InvoiceScanError("Invoice reading is busy. Try again in a minute.", 429);
    if (error instanceof Anthropic.AuthenticationError) throw new InvoiceScanError("Invoice scanning is not set up correctly (ANTHROPIC_API_KEY).", 503);
    if (error instanceof Anthropic.BadRequestError) throw new InvoiceScanError("This file could not be read. Try a clearer PDF or photo, or record it by hand.", 422);
    throw error;
  }
  /* Declined, cut off, or not in the shape asked for: say so; the invoice can be recorded by hand. */
  const parsed = response.stop_reason === "refusal" || response.stop_reason === "max_tokens" ? null : response.parsed_output;
  if (!parsed) throw new InvoiceScanError("The invoice could not be read. Try a clearer PDF or photo, or record it by hand.", 422);
  return {
    invoiceNumber: parsed.invoiceNumber?.trim() || null,
    invoiceDate: invoiceDateOf(parsed.invoiceDate),
    currency: parsed.currency ?? null,
    subtotal: parsed.subtotal ?? null,
    vat: parsed.vat ?? null,
    total: parsed.total ?? null,
    references: (parsed.references ?? []).filter(Boolean),
    lines: (parsed.lines ?? []).filter((l) => l.description || l.amount),
  };
}

export type ScanProposal = MatchResult & {
  scanned: ScannedInvoice;
  /** Every open line of the work orders found, for choosing a line by hand. */
  candidates: CandidateLine[];
  /** Numbers on the invoice that match no work order or quotation in FSM's last four months. */
  notFound: string[];
  /** Work orders named on the invoice with nothing ready to invoice yet (27 Oct): why their lines are not offered. */
  notReady: string[];
};

/** Work orders read in full for one scan, at most: each costs a call when not read in the last ten minutes. */
const MAX_SCAN_WORK_ORDERS = 8;

/**
 * The work-order lines the invoice may cover: those of the work orders and
 * quotations named on it (found in FSM's last four months, read live), plus
 * the work order it was uploaded from.
 */
export async function proposeAllocations(
  admin: SupabaseClient,
  scanned: ScannedInvoice,
  context: { workOrderId?: string | null } = {},
): Promise<ScanProposal> {
  const keys = scannedReferences(scanned);
  const ids: string[] = context.workOrderId ? [context.workOrderId] : [];
  const notFound: string[] = [];
  if (keys.length) {
    const today = todayInZone();
    const from = zonedTimeToUtc(addDaysToDateString(today, -(WORK_ORDER_MAX_DAYS - 1))).toISOString();
    const to = zonedTimeToUtc(addDaysToDateString(today, 1)).toISOString();
    const { rows } = await fetchWorkOrdersLive(admin, { fromIso: from, toIso: to });
    for (const key of keys) {
      const hits = rows.filter((w) => referenceKey(w.number) === key || referenceKey(w.estimateNumber) === key);
      if (!hits.length) notFound.push(key);
      for (const w of hits) if (!ids.includes(w.id)) ids.push(w.id);
    }
  }
  const { lines: candidates, notReady } = await openLinesOf(admin, ids.slice(0, MAX_SCAN_WORK_ORDERS));
  return { ...matchInvoice(scanned, candidates), scanned, candidates, notFound, notReady };
}

/**
 * The lines of these work orders, as FSM has them now, that may be invoiced
 * now (lib/finance/progress.ts: Completed and flagged, or as far as
 * Operations' percentage allows), with how much.
 */
async function openLinesOf(admin: SupabaseClient, workOrderIds: string[]): Promise<{ lines: CandidateLine[]; notReady: string[] }> {
  if (!workOrderIds.length) return { lines: [], notReady: [] };
  const orders = (await Promise.all(workOrderIds.map((id) => fetchWorkOrderLive(admin, id)))).filter(
    (o): o is NonNullable<typeof o> => Boolean(o),
  );
  const out: CandidateLine[] = [];
  const notReady: string[] = [];
  for (const o of orders) {
    const caps = await invoiceCapsFor(admin, o);
    if (![...caps.values()].some((cap) => cap > 0.005)) notReady.push(o.workOrder.number ?? o.workOrder.id);
    for (const l of o.lines) {
      const lineId = String(l.fsm_line_id);
      const cap = caps.get(lineId) ?? 0;
      if (cap <= 0.005) continue;
      out.push({
        workOrderId: o.workOrder.id,
        workOrderNumber: o.workOrder.number,
        quotationNumber: o.workOrder.estimateNumber,
        lineId,
        name: l.name,
        description: l.description,
        amount: Number(l.amount ?? 0),
        amountWithVat: l.line_amount,
        remaining: cap,
      });
    }
  }
  return { lines: out, notReady };
}
