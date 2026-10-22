import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";

import { EVIDENCE_BUCKET, safeEvidenceName } from "@/lib/finance/evidence";
import { matchInvoice, referenceKey, scannedReferences, type CandidateLine, type MatchResult, type ScannedInvoice } from "@/lib/finance/invoice-match";
import { lineRemaining } from "@/lib/finance/line-status";
import { addDaysToDateString, todayInZone, zonedTimeToUtc } from "@/lib/scheduling/org-time";
import { fetchWorkOrderLive, fetchWorkOrdersLive } from "@/lib/server/finance/fsm-live";
import { WORK_ORDER_MAX_DAYS } from "@/lib/server/finance/work-orders";

/**
 * Reading a MAHER invoice (decided with the user, 22 Oct: AI reading with
 * OpenAI). The file goes to the private finance-evidence bucket under
 * invoices/; the model reads the invoice number, date, totals, the work
 * order and quotation numbers on it and its lines; lib/finance/
 * invoice-match.ts proposes which work-order lines it covers. Nothing is
 * recorded until a person confirms (POST /api/finance/invoices).
 *
 * Needs OPENAI_API_KEY (and optionally OPENAI_INVOICE_MODEL). Without the
 * key the upload says scanning is not set up, and invoices are recorded by
 * hand on the work order.
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

export const invoiceScanConfigured = () => Boolean(process.env.OPENAI_API_KEY);

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

const nullable = (type: "string" | "number") => ({ type: [type, "null"] });

/* Strict structured output: every field present, null when not on the invoice. */
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["invoiceNumber", "invoiceDate", "currency", "subtotal", "vat", "total", "references", "lines"],
  properties: {
    invoiceNumber: nullable("string"),
    invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD" },
    currency: nullable("string"),
    subtotal: nullable("number"),
    vat: nullable("number"),
    total: nullable("number"),
    references: {
      type: "array",
      description: "Every work order number (like WO3546) and quotation or estimate number printed anywhere on the invoice.",
      items: { type: "string" },
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["description", "quantity", "unitPrice", "amount", "reference"],
        properties: {
          description: { type: "string" },
          quantity: nullable("number"),
          unitPrice: nullable("number"),
          amount: { type: ["number", "null"], description: "The line's amount as printed." },
          reference: { type: ["string", "null"], description: "A work order or quotation number printed on this line, if any." },
        },
      },
    },
  },
} as const;

const PROMPT = `You are reading an invoice issued from the MAHER accounting system by a property maintenance company in the UAE.
Extract exactly what is printed; do not guess or calculate missing values (use null).
- invoiceNumber: the invoice number. invoiceDate: the invoice date as YYYY-MM-DD.
- subtotal, vat, total: the invoice's totals as printed (AED unless another currency is shown).
- references: every work order number (often like WO3546) and quotation/estimate number anywhere on the invoice.
- lines: each billed line with its description, quantity, unit price, line amount, and any work order or quotation number printed on that line.`;

/** Reads the uploaded invoice with the model. */
export async function scanInvoiceFile(admin: SupabaseClient, path: string): Promise<ScannedInvoice> {
  if (!invoiceScanConfigured()) throw new InvoiceScanError("Invoice scanning is not set up yet (OPENAI_API_KEY).", 503);
  if (!path.startsWith(INVOICE_PREFIX) || path.includes("..")) throw new InvoiceScanError("Not an uploaded invoice", 400);

  const { data: blob, error } = await admin.storage.from(EVIDENCE_BUCKET).download(path);
  if (error || !blob) throw new InvoiceScanError("The uploaded invoice could not be read back. Upload it again.", 404);
  const contentType = blob.type && blob.type in TYPES ? blob.type : (contentTypeOf(path, "") ?? "application/pdf");
  const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
  const fileName = path.slice(path.lastIndexOf("/") + 1);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.responses.create({
    model: process.env.OPENAI_INVOICE_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: PROMPT },
          TYPES[contentType] === "pdf"
            ? { type: "input_file", filename: fileName, file_data: `data:application/pdf;base64,${base64}` }
            : { type: "input_image", image_url: `data:${contentType};base64,${base64}`, detail: "high" },
        ],
      },
    ],
    text: { format: { type: "json_schema", name: "maher_invoice", strict: true, schema: SCHEMA as unknown as Record<string, unknown> } },
  });

  let parsed: ScannedInvoice;
  try {
    parsed = JSON.parse(response.output_text) as ScannedInvoice;
  } catch {
    throw new InvoiceScanError("The invoice could not be read. Try a clearer PDF or photo, or record it by hand.", 422);
  }
  return {
    invoiceNumber: parsed.invoiceNumber?.trim() || null,
    invoiceDate: /^\d{4}-\d{2}-\d{2}$/.test(parsed.invoiceDate ?? "") ? parsed.invoiceDate : null,
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
  const candidates = await openLinesOf(admin, ids.slice(0, MAX_SCAN_WORK_ORDERS));
  return { ...matchInvoice(scanned, candidates), scanned, candidates, notFound };
}

/** The lines of these work orders, as FSM has them now, with something left to invoice. */
async function openLinesOf(admin: SupabaseClient, workOrderIds: string[]): Promise<CandidateLine[]> {
  if (!workOrderIds.length) return [];
  const [orders, states] = await Promise.all([
    Promise.all(workOrderIds.map((id) => fetchWorkOrderLive(admin, id))),
    admin.schema("finance").from("line_states").select("fsm_line_id, ready, invoiced_amount").in("fsm_work_order_id", workOrderIds),
  ]);
  if (states.error && !/line_states|schema cache/i.test(states.error.message)) throw new Error(states.error.message);
  const stateOf = new Map((states.data ?? []).map((s) => [String(s.fsm_line_id), s]));
  return orders
    .filter((o): o is NonNullable<typeof o> => Boolean(o))
    .flatMap((o) =>
      o.lines.map((l) => {
        const state = stateOf.get(String(l.fsm_line_id));
        const amount = Number(l.amount ?? 0);
        return {
          workOrderId: o.workOrder.id,
          workOrderNumber: o.workOrder.number,
          quotationNumber: o.workOrder.estimateNumber,
          lineId: String(l.fsm_line_id),
          name: l.name,
          description: l.description,
          amount,
          remaining: lineRemaining({ amount, ready: Boolean(state?.ready), invoicedAmount: Number(state?.invoiced_amount ?? 0) }),
        };
      }),
    )
    .filter((c) => c.remaining > 0.005);
}
