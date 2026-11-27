import { amcRequest } from "@/lib/amc/http-cache";
import type { SendChannel } from "@/lib/amc/send-channels";
import type { FsmQuotationState } from "@/lib/server/amc/fsm-quotation";
import type { AmcQuotation, AmcQuoteKind } from "@/lib/server/amc/quotations";
import type { SnaggingQuoteDoc } from "@/lib/snagging/quotation-template-data";

/* A call out's or additional work's quotation (27 Nov 2026): the browser side. */

export type { AmcQuotation, AmcQuoteKind };

export interface QuotationResponse {
  ready: boolean;
  quotation: AmcQuotation | null;
  fsmQuotation: FsmQuotationState;
  canEdit: boolean;
  /** Still before the work goes ahead: a quotation can be generated and shared. */
  quotable: boolean;
  /** This server creates quotations in Zoho FSM (live); off locally. */
  fsmWrites: boolean;
  /** Why Generate quotation cannot run yet (no services), or null. */
  blocker?: string | null;
}

export interface ShareQuotationResult {
  url: string;
  message: string;
  whatsapp: string | null;
  emailed: boolean;
  quotation: AmcQuotation;
}

const url = (kind: AmcQuoteKind, id: string) => `/api/amc-field-work/${kind}/${encodeURIComponent(id)}/quotation`;
const post = <T,>(kind: AmcQuoteKind, id: string, body: Record<string, unknown>) => amcRequest<T>(url(kind, id), { method: "POST", body: JSON.stringify(body) });

export const amcQuotationsService = {
  get: (kind: AmcQuoteKind, id: string) => amcRequest<QuotationResponse>(url(kind, id)),
  generate: (kind: AmcQuoteKind, id: string) => post<{ quotation: AmcQuotation; fsmProblem: string | null }>(kind, id, { action: "generate" }),
  share: (kind: AmcQuoteKind, id: string, channel: SendChannel, pdfBase64: string | null) => post<ShareQuotationResult>(kind, id, { action: "share", channel, pdfBase64 }),
  retryFsm: (kind: AmcQuoteKind, id: string) => post<{ fsmProblem: string | null }>(kind, id, { action: "retry_fsm" }),
  setNumber: (kind: AmcQuoteKind, id: string, number: string) => post<{ ok: true }>(kind, id, { action: "set_number", number }),
};

/** The quotation as the Snagging template reads it, so the PDF, the preview and the client's page are one document. */
export function amcQuoteDoc(q: AmcQuotation): SnaggingQuoteDoc {
  const s = q.clientSnapshot as Record<string, string | number | null | undefined>;
  return {
    quote_number: q.quoteNumber,
    status: q.status,
    created_at: q.createdAt,
    sent_at: q.sentAt,
    currency: q.currency,
    subtotal: q.subtotal,
    tax_rate: q.taxRate,
    tax_amount: q.taxAmount,
    total: q.total,
    lines: q.lines,
    scope_of_work: q.scopeOfWork,
    terms: q.terms,
    property: {
      unit_label: (s.unit_label as string) ?? null,
      building_name: (s.building_name as string) ?? null,
      community: (s.community as string) ?? null,
      developer_name: (s.developer_name as string) ?? null,
      property_type: (s.property_type as string) ?? null,
      bedrooms: (s.bedrooms as number) ?? null,
      built_up_area_sqft: (s.built_up_area_sqft as number) ?? null,
      client_name: (s.client_name as string) ?? null,
      client_email: (s.client_email as string) ?? null,
      client_phone: (s.client_phone as string) ?? null,
      client_ref: (s.client_ref as string) ?? null,
    },
  };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** The quotation PDF, built in the browser as Snagging's is (the live server has no browser to print with). */
export async function amcQuotePdf(q: AmcQuotation): Promise<Blob> {
  const [{ generateQuotationPDFBlob }, { snaggingQuoteToTemplateData, SNAGGING_QUOTATION_SECTION_STYLE }] = await Promise.all([
    import("@/components/dashboard/extensions/quotation-templates/pdf-utils"),
    import("@/lib/snagging/quotation-template-data"),
  ]);
  return generateQuotationPDFBlob("yalla-classic", snaggingQuoteToTemplateData(amcQuoteDoc(q)), { scale: 2, sectionStyle: SNAGGING_QUOTATION_SECTION_STYLE }, "without");
}

/**
 * Shares the quotation, generating it first when there is none open (the
 * old Share quotation button does this too): by email with the PDF
 * attached, else a link to copy or send on WhatsApp.
 */
export async function shareGeneratedQuotation(kind: AmcQuoteKind, id: string, channel: SendChannel): Promise<ShareQuotationResult> {
  const current = await amcQuotationsService.get(kind, id);
  let quotation = current.quotation && (current.quotation.status === "draft" || current.quotation.status === "sent") ? current.quotation : null;
  if (!quotation) quotation = (await amcQuotationsService.generate(kind, id)).quotation;
  const pdf = channel === "email" ? await blobToBase64(await amcQuotePdf(quotation)).catch(() => null) : null;
  return amcQuotationsService.share(kind, id, channel, pdf);
}
