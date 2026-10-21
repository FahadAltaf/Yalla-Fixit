import { executeRESTBackend } from "@/lib/rest-server";
import type { QueueMetrics, QueueSummary } from "@/lib/finance/metrics";
import type { QueueAction, QueueStatus } from "@/lib/server/finance/queue";
import type { QueueItemDetail, QueueRow } from "@/lib/server/finance/queue-read";

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

  metrics: () => executeRESTBackend<{ summary: QueueSummary; metrics: QueueMetrics }>("/api/finance/metrics"),
};
