import { executeRESTBackend } from "@/lib/rest-server";
import type { PeriodMetrics, QueueMetrics, QueueSummary } from "@/lib/finance/metrics";
import type { ScanProposal } from "@/lib/server/finance/invoice-scan";
import type { LiveAttachment, LiveServiceReport } from "@/lib/server/finance/fsm-live";
import type { FsmCompletionResult } from "@/lib/server/finance/fsm-completion";
import type { InvoiceEmailDraft } from "@/lib/server/finance/invoice-email";
import type { QueryKind, QueryReplyAction, QuerySide } from "@/lib/server/finance/queries";
import type { WorkOrderDetail } from "@/lib/server/finance/work-orders";

export type FinanceMetricsResponse = { summary: QueueSummary; metrics: QueueMetrics; period: PeriodMetrics; ledgerReady?: boolean };

export const financeService = {
  /** One work order read again from Zoho FSM (one or two calls). */
  refreshWorkOrder: (id: string) =>
    /* executeRESTBackend already takes the answer out of its { data } envelope. */
    executeRESTBackend<WorkOrderDetail>(`/api/finance/work-orders/${id}`, { params: { refresh: "1" } }),

  /** Lines (or, with none given, the whole work order) Ready to invoice, or not. */
  setReady: (workOrderId: string, input: { lines?: string[]; ready: boolean; note?: string | null }) =>
    executeRESTBackend<{ changed: number }>(`/api/finance/work-orders/${workOrderId}/ready`, { method: "POST", body: input }),

  /** A MAHER invoice against lines, in full or in part. */
  recordLineInvoice: (input: {
    idempotencyKey: string;
    number: string;
    date: string;
    total: number;
    /** The total printed on the MAHER invoice, with VAT. */
    maherTotal: number;
    /** Required when maherTotal differs from the lines' total by more than AED 1.00. */
    varianceReason?: string | null;
    note?: string | null;
    allocations: Array<{ line: string; workOrder: string; amount: number }>;
    filePath: string;
    scan?: Record<string, unknown> | null;
  }) => executeRESTBackend<{ invoiceId: string }>("/api/finance/invoices", { method: "POST", body: input }),

  /** Operations: "X % done" against the whole work order (line: null) or some lines, to invoice or for revenue only. */
  recordProgress: (
    workOrderId: string,
    input: { entries: Array<{ line: string | null; percent: number; purpose: "invoice" | "revenue_only" }>; note?: string | null },
  ) =>
    executeRESTBackend<{ recorded: number; fsm: FsmCompletionResult | null }>(`/api/finance/work-orders/${workOrderId}/progress`, {
      method: "POST",
      body: input,
    }),

  /** The files on a work order and its appointments (service reports), from FSM. */
  workOrderFiles: (workOrderId: string, refresh = false) =>
    executeRESTBackend<{ serviceReports: LiveServiceReport[]; files: LiveAttachment[]; appointments: number }>(`/api/finance/work-orders/${workOrderId}/attachments`, {
      params: refresh ? { refresh: "1" } : undefined,
    }),

  /** BRD v1.5 Step 10: what emailing an invoice to the client would do (addresses from FSM, where it goes, what was sent). */
  invoiceEmailDraft: (workOrderId: string, invoiceId: string) =>
    executeRESTBackend<InvoiceEmailDraft>(`/api/finance/work-orders/${encodeURIComponent(workOrderId)}/invoices/${encodeURIComponent(invoiceId)}/email`),

  /** Email the uploaded MAHER invoice to the client; the portal records who, when and to whom. */
  sendInvoiceEmail: (workOrderId: string, invoiceId: string, input: { to: string[]; cc: string[]; message?: string | null }) =>
    executeRESTBackend<{ id: string; delivery: "live" | "redirect"; deliveredTo: string[] }>(
      `/api/finance/work-orders/${encodeURIComponent(workOrderId)}/invoices/${encodeURIComponent(invoiceId)}/email`,
      { method: "POST", body: input },
    ),

  /** Where a recorded MAHER invoice's file opens (a short-lived link to it). */
  invoiceFileUrl: (workOrderId: string, invoiceId: string) =>
    `/api/finance/work-orders/${encodeURIComponent(workOrderId)}/invoices/${encodeURIComponent(invoiceId)}/file`,

  /** Where a work order's FSM file opens (inline; &download=1 to save it). */
  workOrderFileUrl: (workOrderId: string, fileId: string) =>
    `/api/finance/work-orders/${encodeURIComponent(workOrderId)}/attachments/${encodeURIComponent(fileId)}`,

  /** A one-time upload URL for a MAHER invoice to be read (503 when scanning is not set up). */
  signInvoiceUpload: (input: { fileName: string; contentType: string; size: number; scan?: boolean }) =>
    executeRESTBackend<{ path: string; signedUrl: string; contentType: string }>("/api/finance/invoices/upload", { method: "POST", body: input }),

  /** Reads the uploaded invoice and proposes the lines it covers; records nothing. */
  scanInvoice: (input: { path: string; workOrderId?: string | null }) =>
    executeRESTBackend<ScanProposal>("/api/finance/invoices/scan", { method: "POST", body: input }),

  /** Ready to invoice: put on hold, resume. */
  workOrderAction: (id: string, input: { action: "put_on_hold" | "resume"; expectedStatus: string; note?: string | null; as?: "finance" | "operations" }) =>
    executeRESTBackend<{ status: string }>(`/api/finance/work-orders/${id}/action`, { method: "POST", body: input }),

  /** Finance or Operations marks a work order not invoiceable, at once; the other side is told. */
  markNotInvoiceable: (id: string, input: { reason: string; notes?: string | null; evidence?: string[]; as?: "finance" | "operations" }) =>
    executeRESTBackend<{ exclusionId: string }>(`/api/finance/work-orders/${id}/exclusion`, { method: "POST", body: input }),

  /** Either side marks it invoiceable again; the other side is told. */
  markInvoiceable: (id: string, input: { note?: string | null; as?: "finance" | "operations" }) =>
    executeRESTBackend<{ status: string }>(`/api/finance/work-orders/${id}/exclusion`, { method: "DELETE", body: input }),

  /** Queries (2 Nov): raise one on a work order. */
  openQuery: (input: {
    workOrderId: string;
    kind: QueryKind;
    body: string;
    lineIds?: string[];
    taggedUserId?: string | null;
    as?: QuerySide;
  }) => executeRESTBackend<{ id: string }>("/api/finance/queries", { method: "POST", body: input }),

  /** Reply on a query, or close it: either side. */
  replyQuery: (id: string, input: { action: QueryReplyAction; body?: string | null; taggedUserId?: string | null; as?: QuerySide }) =>
    executeRESTBackend<{ status: "open" | "resolved" }>(`/api/finance/queries/${id}`, {
      method: "POST",
      body: input,
    }),

  signWorkOrderEvidenceUpload: (id: string, input: { fileName: string; contentType: string; size: number }) =>
    executeRESTBackend<{ path: string; signedUrl: string; contentType: string }>(`/api/finance/work-orders/${id}/evidence`, {
      method: "POST",
      body: input,
    }),

  workOrderEvidenceUrl: (id: string, path: string) => `/api/finance/work-orders/${id}/evidence?path=${encodeURIComponent(path)}`,

  metrics: (days = 30, signal?: AbortSignal) =>
    executeRESTBackend<FinanceMetricsResponse>("/api/finance/metrics", { params: { days }, signal }),
};
