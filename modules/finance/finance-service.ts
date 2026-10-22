import { executeRESTBackend } from "@/lib/rest-server";
import type { PeriodMetrics, QueueMetrics, QueueSummary } from "@/lib/finance/metrics";
import type { QueueAction, QueueStatus } from "@/lib/server/finance/queue";
import type { QueueItemDetail, QueueRow } from "@/lib/server/finance/queue-read";
import type { ScanProposal } from "@/lib/server/finance/invoice-scan";
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

export type FinanceMetricsResponse = { summary: QueueSummary; metrics: QueueMetrics; period: PeriodMetrics };

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
    filePath?: string | null;
    scan?: Record<string, unknown> | null;
  }) => executeRESTBackend<{ invoiceId: string }>("/api/finance/invoices", { method: "POST", body: input }),

  /** A one-time upload URL for a MAHER invoice to be read (503 when scanning is not set up). */
  signInvoiceUpload: (input: { fileName: string; contentType: string; size: number }) =>
    executeRESTBackend<{ path: string; signedUrl: string; contentType: string }>("/api/finance/invoices/upload", { method: "POST", body: input }),

  /** Reads the uploaded invoice and proposes the lines it covers; records nothing. */
  scanInvoice: (input: { path: string; workOrderId?: string | null }) =>
    executeRESTBackend<ScanProposal>("/api/finance/invoices/scan", { method: "POST", body: input }),

  /** Ready to invoice: pick up, release, query, hold, resume, answer a query. */
  workOrderAction: (
    id: string,
    input: { action: "pick_up" | "release" | "raise_query" | "answer_query" | "put_on_hold" | "resume"; expectedStatus: string; note?: string | null },
  ) => executeRESTBackend<{ status: string }>(`/api/finance/work-orders/${id}/action`, { method: "POST", body: input }),

  /** A work order marked not to be invoiced, for verification. */
  requestWorkOrderExclusion: (id: string, input: { reason: string; notes?: string | null; evidence?: string[] }) =>
    executeRESTBackend<{ exclusionId: string }>(`/api/finance/work-orders/${id}/exclusion`, { method: "POST", body: input }),

  decideWorkOrderExclusion: (exclusionId: string, input: { decision: "verified" | "rejected"; note?: string | null }) =>
    executeRESTBackend<{ status: string }>(`/api/finance/work-orders/exclusions/${exclusionId}/decision`, { method: "POST", body: input }),

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
