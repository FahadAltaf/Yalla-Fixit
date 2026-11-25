import type { z } from "zod";

import type { jobSheetSchema, reportState, ReviewReason } from "@/lib/amc/job-sheets";
import type { JobSheetView } from "@/lib/server/amc/job-sheets";
import type { ServiceReportFacts } from "@/lib/amc/service-report";
import { amcRequest } from "@/lib/amc/http-cache";
import type { SendChannel, SendOutcome } from "@/lib/amc/send-channels";
import { additionalWorksService } from "./additional-works-service";
import { callOutsService } from "./call-outs-service";

/**
 * Browser calls for an AMC visit's job sheet (Phase 10: DEV-402, 403,
 * 404): the sheet itself, its photos, the supervisor's review (return or
 * close) and the service report, plus the review queue. The server checks
 * who may change what; `canEdit` and `canReview` only decide what is
 * offered.
 */

export type { JobSheetView };

/** What a screen sends: the schema's input, before its trims and defaults. */
export type JobSheetInput = z.input<typeof jobSheetSchema>;

export type PhotoKind = "before" | "after" | "fault" | "other";
export type ReportState = ReturnType<typeof reportState>;
export type ReportOutcome = SendOutcome;

export type JobSheetResponse = JobSheetView & {
  canEdit: boolean;
  canReview: boolean;
  /** A call out's or additional work's FSM quotation number (DEV-508); absent on a PPM visit. */
  fsmQuotation?: { migrated: boolean; value: string | null; required: boolean } | null;
  /** A handyman job's teams, time on site and the team-hours to record (DEV-495); absent otherwise. */
  handyman?: { teams: number; fromCrew: boolean; hoursUsed: number | null; hoursChargeable: number | null; minutesOnSite: number | null; suggestedHours: number | null } | null;
};

export interface SaveJobSheetResult {
  ok: true;
  reviewReasons: ReviewReason[];
}

export interface ServiceReportResult {
  outcome: ReportOutcome;
  documentId: string;
  /** The prepared WhatsApp text. */
  message: string;
  /** A wa.me link, or null without a phone number on file. */
  whatsapp: string | null;
  /** The report's own link, to copy. */
  link: string | null;
  /** The stored report, to download and attach to WhatsApp (18 Nov 2026). */
  file?: { url: string; name: string } | null;
}

export interface CloseJobSheetResult {
  ok: true;
  status: string;
  /** The new visit planned for the remaining trade, if any. */
  remainderVisitId: string | null;
  report: ServiceReportResult | null;
}

export interface JobReviewItem {
  /** DEV-497: a planned visit's, a call out's or an additional work's job sheet. */
  kind: "ppm" | "call_out" | "additional_work";
  /** "Visit 3", "CO-2026-0004", "AW-2026-0001". */
  ref: string;
  /** Where it is reviewed: its page, on the Job sheet tab. */
  href: string;
  visitId: string;
  contractId: string;
  contractNumber: string;
  customerName: string;
  propertyLabel: string;
  visitNo: number;
  submittedAt: string;
  reviewRequired: boolean;
  reviewReasons: ReviewReason[];
  returnCount: number;
  reportState: ReportState;
}

export interface JobReviewsResponse {
  migrated: boolean;
  items: JobReviewItem[];
  canReview: boolean;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return amcRequest<T>(url, init);
}

const sheetUrl = (visitId: string) => `/api/amc-visits/${encodeURIComponent(visitId)}/job-sheet`;

export const jobSheetsService = {
  jobSheet(visitId: string) {
    return request<JobSheetResponse>(sheetUrl(visitId));
  },
  save(visitId: string, sheet: JobSheetInput) {
    return request<SaveJobSheetResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "save", sheet }) });
  },
  submit(visitId: string, sheet: JobSheetInput) {
    return request<SaveJobSheetResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "submit", sheet }) });
  },
  /** pdfBase64: the report as the portal built it (18 Nov 2026); without it the server prints its own. */
  /* fsmQuotationNo is for a call out or additional work (DEV-508); a PPM visit ignores it. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- same calls as a call out's sheet; a PPM visit has no FSM quotation or handyman hours
  close(visitId: string, comment: string | null, send: SendChannel = "email", pdfBase64: string | null = null, _fsmQuotationNo: string | null = null, _hoursUsed: number | null = null) {
    return request<CloseJobSheetResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "close", comment, send, ...(pdfBase64 ? { pdfBase64 } : {}) }) });
  },
  returnSheet(visitId: string, comment: string) {
    return request<{ ok: true }>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "return", comment }) });
  },
  resendReport(visitId: string, channel: SendChannel = "email", pdfBase64: string | null = null) {
    return request<ServiceReportResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "resend_report", channel, ...(pdfBase64 ? { pdfBase64 } : {}) }) });
  },
  /** DEV-404: the coordinator sent the report themselves (WhatsApp, by hand); this stops the clock. */
  markReportSent(visitId: string, channel: "whatsapp" | "link" | "other", note: string | null) {
    return request<{ ok: true; reportSentAt: string }>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "mark_report_sent", channel, note }) });
  },
  /** The report's facts, drawn by the viewer and built into the PDF (18 Nov 2026). */
  reportFacts(visitId: string) {
    return request<{ facts: ServiceReportFacts }>(`${sheetUrl(visitId)}/report?facts=1`);
  },
  /** multipart/form-data: the browser sets the boundary, so no JSON content type here. */
  async addPhoto(visitId: string, input: { file: File; kind: PhotoKind; lineId?: string | null; assetId?: string | null; caption?: string | null }) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.lineId) form.append("lineId", input.lineId);
    if (input.assetId) form.append("assetId", input.assetId);
    if (input.caption?.trim()) form.append("caption", input.caption.trim());
    return request<{ photo: { id: string } }>(`${sheetUrl(visitId)}/photos`, { method: "POST", body: form });
  },
  removePhoto(visitId: string, photoId: string) {
    return request<{ ok: true }>(`${sheetUrl(visitId)}/photos/${encodeURIComponent(photoId)}`, { method: "DELETE" });
  },
  /** Opens in a new tab: the route redirects to the stored report. */
  reportHref(visitId: string) {
    return `${sheetUrl(visitId)}/report`;
  },
  reviews() {
    return request<JobReviewsResponse>("/api/amc-job-reviews");
  },
};

/*
  A call out's or additional work's job sheet (18 Nov 2026): the same calls,
  so the job sheet panel reads and reviews either. The id is the call out's
  or the work's; photos go to their own photo routes.
*/
export type JobSheetCalls = Pick<typeof jobSheetsService, "jobSheet" | "save" | "submit" | "close" | "returnSheet" | "resendReport" | "markReportSent" | "reportFacts" | "addPhoto" | "removePhoto" | "reportHref">;
export type FieldSheetKind = "call_out" | "additional_work";
const fieldSheetUrl = (kind: FieldSheetKind, id: string) => `/api/amc-field-work/${kind}/${encodeURIComponent(id)}/job-sheet`;

export function fieldJobSheetCalls(kind: FieldSheetKind): JobSheetCalls {
  const post = <T,>(id: string, body: Record<string, unknown>) => request<T>(fieldSheetUrl(kind, id), { method: "POST", body: JSON.stringify(body) });
  return {
    jobSheet: (id) => request<JobSheetResponse>(fieldSheetUrl(kind, id)),
    save: (id, sheet) => post<SaveJobSheetResult>(id, { action: "save", sheet }),
    submit: (id, sheet) => post<SaveJobSheetResult>(id, { action: "submit", sheet }),
    close: (id, comment, send = "email", pdfBase64 = null, fsmQuotationNo = null, hoursUsed = null) =>
      post<CloseJobSheetResult>(id, {
        action: "close",
        comment,
        send,
        ...(pdfBase64 ? { pdfBase64 } : {}),
        ...(fsmQuotationNo ? { fsmQuotationNo } : {}),
        ...(hoursUsed !== null ? { hoursUsed } : {}),
      }),
    returnSheet: (id, comment) => post<{ ok: true }>(id, { action: "return", comment }),
    resendReport: (id, channel = "email", pdfBase64 = null) => post<ServiceReportResult>(id, { action: "resend_report", channel, ...(pdfBase64 ? { pdfBase64 } : {}) }),
    markReportSent: (id, channel, note) => post<{ ok: true; reportSentAt: string }>(id, { action: "mark_report_sent", channel, note }),
    reportFacts: (id) => request<{ facts: ServiceReportFacts }>(`${fieldSheetUrl(kind, id)}/report?facts=1`),
    addPhoto: async (id, input) => {
      const kindOf = input.kind === "fault" ? "finding" : input.kind;
      const done = kind === "call_out" ? await callOutsService.addPhoto(id, { file: input.file, kind: kindOf, caption: input.caption }) : await additionalWorksService.addPhoto(id, { file: input.file, kind: kindOf, caption: input.caption });
      return done as unknown as { photo: { id: string } };
    },
    removePhoto: (id, photoId) => (kind === "call_out" ? callOutsService.removePhoto(id, photoId) : additionalWorksService.removePhoto(id, photoId)) as Promise<{ ok: true }>,
    reportHref: (id) => `${fieldSheetUrl(kind, id)}/report`,
  };
}

/* The same calls as plain functions, for screens that import them one by one. */
export const { jobSheet, save, submit, close, returnSheet, resendReport, reportFacts, addPhoto, removePhoto, reportHref, reviews } = jobSheetsService;
