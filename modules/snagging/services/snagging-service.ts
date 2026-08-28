import { executeRESTBackend } from "@/lib/rest-server";
import type { CreateAreaInput, UpdateAreaInput } from "@/modules/snagging/schemas";
import type {
  SnaggingAnalytics,
  SnaggingAnalyticsDrilldown,
  SnaggingAnalyticsGranularity,
  SnaggingAnalyticsMetric,
  SnaggingArea,
  SnaggingAuditEvent,
  SnaggingFloorPlan,
  SnaggingOverview,
  SnaggingProperty,
  SnaggingPropertyType,
  SnaggingCatalogueArea,
  SnaggingCatalogueEntry,
  SnaggingTask,
  SnaggingTaskSummary,
} from "@/types/types";

/** Payload for creating or editing a property record (BR-1). */
export interface SnaggingPropertyInput {
  client_id: string;
  unit_label: string;
  building_name?: string;
  community?: string;
  property_type: SnaggingPropertyType;
  developer_name?: string;
  bedrooms?: number | null;
  built_up_area_sqft?: number | null;
  plot_area_sqft?: number | null;
  external_areas_in_scope?: boolean;
  floors?: number | null;
  location_lat?: number | null;
  location_lng?: number | null;
  title_deed_path?: string;
  noc_required?: boolean;
  noc_path?: string;
}
import type {
  CatalogueEntryInput,
  CreateTaskInput,
  RejectTaskInput,
  UpdateTaskInput,
} from "@/modules/snagging/schemas";

export interface SnaggingTaskFilters {
  status?: string;
  search?: string;
  developer?: string;
  assigneeId?: string;
  from?: string;
  to?: string;
  queue?: "approval";
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

export interface SnaggingTaskListResponse {
  data: SnaggingTaskSummary[];
  totalCount: number;
}

export interface CatalogueResponse {
  entries: SnaggingCatalogueEntry[];
  areas: SnaggingCatalogueArea[];
  area_elements: Array<{ area_code: string; element_code: string; sort_order: number }>;
  total?: number;
}

export interface SnaggingPricingConfig {
  currency: string;
  rate_per_sqft: number;
  external_rate_per_sqft: number;
  multipliers: Record<string, number>;
  tax_rate: number;
  desnag_price: number;
  additional_visit_price: number;
  scope_of_work: string | null;
  terms: string | null;
  updated_at?: string;
}

export interface SnaggingQuoteLine {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

export interface SnaggingQuotation {
  id: string;
  job_id: string;
  quote_number: string;
  status: "draft" | "sent" | "approved" | "rejected";
  currency: string;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  scope_of_work: string | null;
  terms: string | null;
  lines: SnaggingQuoteLine[];
  sent_at: string | null;
  sent_to: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  created_at: string;
  // Snapshot + client-decision fields (FR-2.06, §10).
  property_snapshot?: Record<string, unknown> | null;
  pricing_snapshot?: Record<string, unknown> | null;
  decided_at?: string | null;
  approved_by_name?: string | null;
  approved_by_contact?: string | null;
  /** Returned by the "send" action so the coordinator can copy the client link. */
  approval_url?: string | null;
}

export interface SnaggingClientOption {
  /** Present for persisted clients (from snagging_clients). */
  id?: string;
  client_name: string;
  client_email: string | null;
  client_phone: string | null;
  company?: string | null;
  developer_name?: string | null;
  property_count?: number;
}

function toParams(filters: SnaggingTaskFilters, page: number, pageSize: number) {
  const params: Record<string, string | number> = { page, pageSize };
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "" && value !== "all") {
      params[key] = String(value);
    }
  });
  return params;
}

export const snaggingService = {
  listTasks: async (
    filters: SnaggingTaskFilters = {},
    page = 0,
    pageSize = 25,
  ): Promise<SnaggingTaskListResponse> =>
    executeRESTBackend<SnaggingTaskListResponse>("/api/snagging/tasks", {
      method: "GET",
      params: toParams(filters, page, pageSize),
    }),

  getOverview: async (): Promise<SnaggingOverview> =>
    executeRESTBackend<SnaggingOverview>("/api/snagging/overview", { method: "GET" }),

  getTask: async (id: string): Promise<SnaggingTask> =>
    executeRESTBackend<SnaggingTask>(`/api/snagging/tasks/${id}`, { method: "GET" }),

  getAudit: async (id: string): Promise<SnaggingAuditEvent[]> =>
    executeRESTBackend<SnaggingAuditEvent[]>(`/api/snagging/tasks/${id}/audit`, { method: "GET" }),

  createTask: async (input: CreateTaskInput): Promise<{ id: string; code: string }> =>
    executeRESTBackend(`/api/snagging/tasks`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  searchClients: async (search?: string): Promise<SnaggingClientOption[]> =>
    executeRESTBackend<SnaggingClientOption[]>("/api/snagging/clients", {
      method: "GET",
      params: search ? { search } : {},
    }),

  // ── Quotation (F1-F13) ────────────────────────────────────────────────
  getPricing: async (): Promise<SnaggingPricingConfig> =>
    executeRESTBackend<SnaggingPricingConfig>("/api/snagging/pricing", { method: "GET" }),

  updatePricing: async (input: Partial<SnaggingPricingConfig>): Promise<SnaggingPricingConfig> =>
    executeRESTBackend<SnaggingPricingConfig>("/api/snagging/pricing", {
      method: "PUT",
      body: input as unknown as Record<string, unknown>,
    }),

  getQuotation: async (taskId: string): Promise<SnaggingQuotation | null> =>
    executeRESTBackend<SnaggingQuotation | null>(`/api/snagging/tasks/${taskId}/quotation`, {
      method: "GET",
    }),

  quotationAction: async (
    taskId: string,
    action: "generate" | "send" | "approve" | "reject",
    extra?: Record<string, unknown>,
  ): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(`/api/snagging/tasks/${taskId}/quotation`, {
      method: "POST",
      body: { action, ...(extra ?? {}) },
    }),

  /** Persists a brand-new client and returns it (with its id). */
  createClient: async (input: {
    client_name: string;
    client_email?: string;
    client_phone?: string;
  }): Promise<SnaggingClientOption> =>
    executeRESTBackend<SnaggingClientOption>("/api/snagging/clients", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  // ── Properties (BR-1) ──────────────────────────────────────────────────
  listProperties: async (clientId?: string): Promise<SnaggingProperty[]> =>
    executeRESTBackend<SnaggingProperty[]>("/api/snagging/properties", {
      method: "GET",
      params: clientId ? { client_id: clientId } : {},
    }),

  createProperty: async (input: SnaggingPropertyInput): Promise<SnaggingProperty> =>
    executeRESTBackend<SnaggingProperty>("/api/snagging/properties", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateProperty: async (id: string, input: SnaggingPropertyInput): Promise<SnaggingProperty> =>
    executeRESTBackend<SnaggingProperty>("/api/snagging/properties", {
      method: "PATCH",
      body: { id, ...input } as unknown as Record<string, unknown>,
    }),

  /**
   * Uploads a floor plan to a job. Sent as multipart form data rather
   * than JSON because it carries the image file; the REST helper is
   * JSON-only, so this uses fetch directly.
   */
  uploadFloorPlan: async (
    taskId: string,
    file: File,
    meta: { label?: string; width?: number; height?: number },
  ): Promise<{ id: string }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("task_id", taskId);
    if (meta.label) form.append("label", meta.label);
    if (meta.width) form.append("width", String(meta.width));
    if (meta.height) form.append("height", String(meta.height));

    const response = await fetch("/api/snagging/floor-plans", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Failed to upload the floor plan");
    }
    return payload.data;
  },

  listFloorPlans: async (taskId: string): Promise<SnaggingFloorPlan[]> =>
    executeRESTBackend<SnaggingFloorPlan[]>("/api/snagging/floor-plans", {
      method: "GET",
      params: { task_id: taskId },
    }),

  deleteFloorPlan: async (id: string): Promise<{ id: string }> =>
    executeRESTBackend<{ id: string }>("/api/snagging/floor-plans", {
      method: "DELETE",
      params: { id },
    }),

  /** Reorder plans (FR-3.06): ids in the new floor sequence. */
  reorderFloorPlans: async (order: string[]): Promise<{ order: string[] }> =>
    executeRESTBackend<{ order: string[] }>("/api/snagging/floor-plans", {
      method: "PATCH",
      body: { order },
    }),

  renameFloorPlan: async (id: string, label: string): Promise<{ id: string; label: string }> =>
    executeRESTBackend<{ id: string; label: string }>("/api/snagging/floor-plans", {
      method: "PATCH",
      body: { id, label },
    }),

  // Area management (FR-3.05 / FR-3.07).
  listAreas: async (taskId: string): Promise<SnaggingArea[]> =>
    executeRESTBackend<SnaggingArea[]>(`/api/snagging/tasks/${taskId}/areas`, { method: "GET" }),

  createArea: async (taskId: string, input: CreateAreaInput): Promise<SnaggingArea> =>
    executeRESTBackend<SnaggingArea>(`/api/snagging/tasks/${taskId}/areas`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateArea: async (taskId: string, input: UpdateAreaInput): Promise<SnaggingArea> =>
    executeRESTBackend<SnaggingArea>(`/api/snagging/tasks/${taskId}/areas`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    }),

  deleteArea: async (taskId: string, areaId: string): Promise<{ id: string }> =>
    executeRESTBackend<{ id: string }>(`/api/snagging/tasks/${taskId}/areas`, {
      method: "DELETE",
      params: { areaId },
    }),

  /** Uploads a title deed (E8) or NOC (E10) and attaches it to the job. */
  uploadDocument: async (
    taskId: string,
    file: File,
    kind: "title_deed" | "noc",
  ): Promise<{ kind: string; storage_path: string }> => {
    const form = new FormData();
    form.append("file", file);
    form.append("task_id", taskId);
    form.append("kind", kind);
    const response = await fetch("/api/snagging/documents", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? "Failed to upload the document");
    return payload.data;
  },

  updateTask: async (id: string, input: UpdateTaskInput): Promise<{ id: string }> =>
    executeRESTBackend(`/api/snagging/tasks/${id}`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    }),

  /** Which inspectors are already booked on a day (FR-3.08 availability). */
  getAvailability: async (
    date: string,
    excludeJobId?: string,
  ): Promise<{ date: string; busy: Record<string, string> }> =>
    executeRESTBackend(`/api/snagging/availability`, {
      method: "GET",
      params: excludeJobId ? { date, excludeJobId } : { date },
    }),

  /** FR-6.01 — pick a submitted inspection up for review (submitted → in_review). */
  reviewTask: async (id: string, comment?: string) =>
    executeRESTBackend(`/api/snagging/tasks/${id}/review`, {
      method: "POST",
      body: { comment: comment ?? "" },
    }),

  approveTask: async (id: string, comment?: string) =>
    executeRESTBackend(`/api/snagging/tasks/${id}/approve`, {
      method: "POST",
      body: { comment: comment ?? "" },
    }),

  rejectTask: async (id: string, input: RejectTaskInput) =>
    executeRESTBackend(`/api/snagging/tasks/${id}/reject`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  deliverReport: async (
    id: string,
    input: { channel: "email" | "whatsapp" | "manual"; recipient: string },
  ) =>
    executeRESTBackend<{
      id: string;
      status: string;
      delivered_at: string;
      channel: string;
      recipient: string;
      report_url: string;
      expires_at: string;
      email_sent: boolean;
    }>(`/api/snagging/tasks/${id}/deliver`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  openRound: async (
    id: string,
    input: {
      scheduled_date?: string;
      technician_ids?: string[];
      notes?: string;
      snag_ids?: string[];
      approval_manager_id?: string | null;
    },
  ) =>
    executeRESTBackend<{ id: string; code: string; round_number: number; carried_snags: number }>(
      `/api/snagging/tasks/${id}/rounds`,
      { method: "POST", body: input as unknown as Record<string, unknown> },
    ),

  scheduleVisit: async (
    id: string,
    input: {
      scheduled_date?: string;
      technician_ids?: string[];
      notes?: string;
      reason?: string;
      approval_manager_id?: string | null;
    },
  ) =>
    executeRESTBackend<{ id: string; code: string; round_number: number; visit_charge: number | null }>(
      `/api/snagging/tasks/${id}/visits`,
      { method: "POST", body: input as unknown as Record<string, unknown> },
    ),

  listCatalogue: async (
    filters: { search?: string; element?: string; activeOnly?: boolean } = {},
  ): Promise<CatalogueResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.search) params.search = filters.search;
    if (filters.element && filters.element !== "all") params.element = filters.element;
    if (filters.activeOnly) params.activeOnly = "true";

    return executeRESTBackend<CatalogueResponse>("/api/snagging/catalogue", {
      method: "GET",
      params,
    });
  },

  createCatalogueEntry: async (input: CatalogueEntryInput): Promise<SnaggingCatalogueEntry> =>
    executeRESTBackend("/api/snagging/catalogue", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  /** BR-8: retire rather than delete, so historical reports resolve. */
  setCatalogueEntryActive: async (id: string, active: boolean) =>
    executeRESTBackend("/api/snagging/catalogue", {
      method: "PATCH",
      body: { id, active },
    }),

  getAnalytics: async (
    range: {
      from?: string;
      to?: string;
      granularity?: SnaggingAnalyticsGranularity;
    } = {},
  ): Promise<SnaggingAnalytics> =>
    executeRESTBackend<SnaggingAnalytics>("/api/snagging/analytics", {
      method: "GET",
      params: {
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
        ...(range.granularity ? { granularity: range.granularity } : {}),
      },
    }),

  /** The records behind one figure on the analytics page (FR-10.06). */
  getAnalyticsRecords: async (query: {
    metric: SnaggingAnalyticsMetric;
    /** Which slice of the metric: a status, a period key, a developer name. */
    value?: string | null;
    from?: string;
    to?: string;
    granularity?: SnaggingAnalyticsGranularity;
  }): Promise<SnaggingAnalyticsDrilldown> =>
    executeRESTBackend<SnaggingAnalyticsDrilldown>("/api/snagging/analytics/records", {
      method: "GET",
      params: {
        metric: query.metric,
        ...(query.value ? { value: query.value } : {}),
        ...(query.from ? { from: query.from } : {}),
        ...(query.to ? { to: query.to } : {}),
        ...(query.granularity ? { granularity: query.granularity } : {}),
      },
    }),
};
