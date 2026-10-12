import type { z } from "zod";

import type { jobSheetSchema, reportState, ReviewReason } from "@/lib/amc/job-sheets";
import type { JobSheetView } from "@/lib/server/amc/job-sheets";

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
export type ReportOutcome = "sent" | "failed" | "no_recipient";

export type JobSheetResponse = JobSheetView & { canEdit: boolean; canReview: boolean };

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
}

export interface CloseJobSheetResult {
  ok: true;
  status: string;
  /** The new visit planned for the remaining trade, if any. */
  remainderVisitId: string | null;
  report: ServiceReportResult | null;
}

export interface JobReviewItem {
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

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return parse<T>(response);
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
  close(visitId: string, comment: string | null) {
    return request<CloseJobSheetResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "close", comment }) });
  },
  returnSheet(visitId: string, comment: string) {
    return request<{ ok: true }>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "return", comment }) });
  },
  resendReport(visitId: string) {
    return request<ServiceReportResult>(sheetUrl(visitId), { method: "POST", body: JSON.stringify({ action: "resend_report" }) });
  },
  /** multipart/form-data: the browser sets the boundary, so no JSON content type here. */
  async addPhoto(visitId: string, input: { file: File; kind: PhotoKind; lineId?: string | null; assetId?: string | null; caption?: string | null }) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.lineId) form.append("lineId", input.lineId);
    if (input.assetId) form.append("assetId", input.assetId);
    if (input.caption?.trim()) form.append("caption", input.caption.trim());
    const response = await fetch(`${sheetUrl(visitId)}/photos`, { method: "POST", body: form });
    return parse<{ photo: { id: string } }>(response);
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

/* The same calls as plain functions, for screens that import them one by one. */
export const { jobSheet, save, submit, close, returnSheet, resendReport, addPhoto, removePhoto, reportHref, reviews } = jobSheetsService;
