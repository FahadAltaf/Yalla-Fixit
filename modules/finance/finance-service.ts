import { executeRESTBackend } from "@/lib/rest-server";
import type { PeriodMetrics, QueueMetrics, QueueSummary } from "@/lib/finance/metrics";
import type { QueueAction, QueueStatus } from "@/lib/server/finance/queue";
import type { QueueItemDetail, QueueRow } from "@/lib/server/finance/queue-read";
import type { ScanProposal } from "@/lib/server/finance/invoice-scan";
import type { LiveAttachment, LiveServiceReport } from "@/lib/server/finance/fsm-live";
import type { FsmCompletionResult } from "@/lib/server/finance/fsm-completion";
import type { QueryKind, QueryReplyAction, QuerySide } from "@/lib/server/finance/queries";
import type { WorkOrderDetail } from "@/lib/server/finance/work-orders";

export type QueueListFilters = {
  statuses: QueueStatus[];
  client?: string;
  coordinator?: string;
  from?: string;
  to?: string;
  aged?: boolean;
  q?: string;
  page: number;
  pageSize: number;
};

export type QueueListResponse = {
  rows: QueueRow[];
  total: number;
  summary: QueueSummary;
  options: { clients: string[]; coordinators: string[] };
  agedAfterDays: number;
};

export type QueueItemResponse = QueueItemDetail & {
  can: { view: boolean; work: boolean; recordInvoice: boolean; coordinate: boolean; verify: boolean };
};

export type FinanceMetricsResponse = { summary: QueueSummary; metrics: QueueMetrics; period: PeriodMetrics; ledgerReady?: boolean };

export const financeService = {
  listQueue: (filters: QueueListFilters, signal?: AbortSignal) => {
    const params: Record<string, string | number> = { page: filters.page, pageSize: filters.pageSize };
    if (filters.statuses.length) params.status = filters.statuses.join(",");
    if (filters.client) params.client = filters.client;
    if (filters.coordinator) params.coordinator = filters.coordinator;
    if (filters.from) params.from = filters.from;
    if (filters.to) params.to = filters.to;
    if (filters.aged) params.aged = "1";
    if (filters.q) params.q = filters.q;
    return executeRESTBackend<QueueListResponse>("/api/finance/queue", { params, signal });
  },

  /** One work order read again from Zoho FSM (one or two calls). */
  refreshWorkOrder: (id: string) =>
    executeRESTBackend<{ data: WorkOrderDetail }>(`/api/finance/work-orders/${id}`, { params: { refresh: "1" } }).then((r) => r.data),

  /** Lines (or, with none given, the whole work order) Ready to invoice, or not. */
  setReady: (workOrderId: string, input: { lines?: string[]; ready: boolean; note?: string | null }) =>
    executeRESTBackend<{ changed: number }>(`/api/finance/work-orders/${workOrderId}/ready`, { method: "POST", body: input }),

  /** A MAHER invoice against lines, in full or in part. */
  recordLineInvoice: (input: {
    idempotencyKey: string;
    number: string;
    date: string;
    total: number;
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
    executeRESTBackend<{ data: { recorded: number; fsm: FsmCompletionResult | null } }>(`/api/finance/work-orders/${workOrderId}/progress`, {
      method: "POST",
      body: input,
    }),

  /** The files on a work order and its appointments (service reports), from FSM. */
  workOrderFiles: (workOrderId: string, refresh = false) =>
    executeRESTBackend<{ data: { serviceReports: LiveServiceReport[]; files: LiveAttachment[]; appointments: number } }>(`/api/finance/work-orders/${workOrderId}/attachments`, {
      params: refresh ? { refresh: "1" } : undefined,
    }).then((r) => r.data),

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

  getItem: (id: string) => executeRESTBackend<QueueItemResponse>(`/api/finance/queue/${id}`),

  act: (id: string, input: { action: QueueAction; expectedStatus: QueueStatus; note?: string | null }) =>
    executeRESTBackend<{ status: QueueStatus }>(`/api/finance/queue/${id}/action`, { method: "POST", body: input }),

  recordInvoice: (
    id: string,
    input: { idempotencyKey: string; number: string; date: string; amount: number; varianceReason?: string | null },
  ) => executeRESTBackend<{ invoiceId: string }>(`/api/finance/queue/${id}/invoice`, { method: "POST", body: input }),

  requestExclusion: (id: string, input: { reason: string; notes?: string | null; evidence?: string[] }) =>
    executeRESTBackend<{ exclusionId: string }>(`/api/finance/queue/${id}/exclusion`, { method: "POST", body: input }),

  signEvidenceUpload: (id: string, input: { fileName: string; contentType: string; size: number }) =>
    executeRESTBackend<{ path: string; signedUrl: string; contentType: string }>(`/api/finance/queue/${id}/evidence`, {
      method: "POST",
      body: input,
    }),

  /** Opens through the API, which checks the file belongs to the item, then redirects to a one-minute link. */
  evidenceUrl: (id: string, path: string) => `/api/finance/queue/${id}/evidence?path=${encodeURIComponent(path)}`,

  decideExclusion: (exclusionId: string, input: { decision: "verified" | "rejected"; note?: string | null }) =>
    executeRESTBackend<{ status: QueueStatus }>(`/api/finance/exclusions/${exclusionId}/decision`, {
      method: "POST",
      body: input,
    }),

  metrics: (days = 30, signal?: AbortSignal) =>
    executeRESTBackend<FinanceMetricsResponse>("/api/finance/metrics", { params: { days }, signal }),
};
