import { executeRESTBackend } from "@/lib/rest-server";
import type {
  CreateAreaInput,
  UpdateAreaInput,
} from "@/modules/snagging/schemas";
import type {
  SnaggingAnalytics,
  SnaggingAnalyticsDrilldown,
  SnaggingAnalyticsGranularity,
  SnaggingAnalyticsMetric,
  SnaggingArea,
  SnaggingAuditEvent,
  SnaggingFloorPlan,
  SnaggingProperty,
  SnaggingPropertyType,
  SnaggingCatalogueArea,
  CatalogueCategory,
  CatalogueDefect,
  CatalogueSubcategory,
  SnaggingCatalogueEntry,
  SnaggingChecklistLibraryItem,
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
import type { SnaggingJobVisit } from "@/types/types";
import type {
  CatalogueEntryInput,
  ChecklistItemInput,
  CreateTaskInput,
  RejectTaskInput,
  UpdateTaskInput,
} from "@/modules/snagging/schemas";

export interface SnaggingTaskFilters {
  status?: string;
  search?: string;
  developer?: string;
  assigneeId?: string;
  /** Only this client's jobs. */
  clientId?: string;
  from?: string;
  to?: string;
  /** Raised between these dates (YYYY-MM-DD), as opposed to scheduled. */
  createdFrom?: string;
  createdTo?: string;
  queue?: "approval";
  sortBy?: string;
  sortDirection?: "asc" | "desc";
}

export interface SnaggingTaskListResponse {
  data: SnaggingTaskSummary[];
  totalCount: number;
}

/** What the checklist library screen reads (N1). */
export interface ChecklistLibraryResponse {
  items: SnaggingChecklistLibraryItem[];
  /** Every group in the library, not just the filtered page. */
  groups: string[];
  totalCount: number;
  activeCount: number;
  mandatoryCount: number;
}

export interface CatalogueResponse {
  entries: SnaggingCatalogueEntry[];
  areas: SnaggingCatalogueArea[];
  area_elements: Array<{
    area_code: string;
    element_code: string;
    sort_order: number;
  }>;
  total?: number;
}

/** One property type's row on the rate card (BRD v7 §9.3). */
export interface SnaggingRateCardType {
  unfurnished_min: number;
  unfurnished_max: number;
  furnished: number;
  minimum_charge: number;
  /** Null where the card says "to be confirmed", as it does for commercial. */
  desnag_min: number | null;
  desnag_max: number | null;
}

export interface SnaggingRateCard {
  types: Record<string, SnaggingRateCardType>;
  external_min: number;
  external_max: number;
  additional_visit_price: number;
}

export interface SnaggingPricingConfig {
  currency: string;
  /** Null only on a database the rate card migration has not reached. */
  rate_card: SnaggingRateCard | null;
  out_of_hours_percent: number;
  tax_rate: number;
  scope_of_work: string | null;
  terms: string | null;
  updated_at?: string;
  /*
    The pre-card model. Nothing prices against these any more, but they are
    still returned and still written, because quotations issued before the
    card carry them in their own snapshot.
  */
  rate_per_sqft?: number;
  external_rate_per_sqft?: number;
  multipliers?: Record<string, number>;
  desnag_price?: number;
  additional_visit_price?: number;
}

/** One row of the Quotations list: what the table shows and filters on. */
export interface SnaggingQuotationSummary {
  id: string;
  quote_number: string;
  status: "draft" | "sent" | "approved" | "rejected";
  quote_kind: "inspection" | "visit" | "desnag";
  currency: string;
  total: number;
  created_at: string;
  /** Null until an approved quotation has been turned into a job. */
  job_id: string | null;
  job_code: string | null;
  /** A de-snag quotation's original inspection, which its round is opened on. */
  source_job_id?: string | null;
  source_job_code?: string | null;
  client_name: string | null;
  unit_label: string | null;
  building_name: string | null;
}

export interface SnaggingQuoteLine {
  description: string;
  qty: number;
  unit: string;
  unit_price: number;
  amount: number;
}

/** One additional visit, with everything that belongs to it. */
export interface SnaggingVisitDetail {
  visit: SnaggingJobVisit;
  job: {
    id: string;
    unit_label: string | null;
    building_name: string | null;
    status: string;
  } | null;
  /** The Quotation tab loads the document itself, by this id. */
  quotation: { id: string; status: string } | null;
  /** For the header counts only; the list is the job's snags for this visit. */
  snags: Array<{
    id: string;
    severity: "low" | "medium" | "high";
    photos: Array<{ id: string }>;
  }>;
  checklist: Array<{
    id: string;
    group_name: string | null;
    label: string;
    status: string;
    reason: string | null;
  }>;
  revisit_areas: Array<{
    id: string;
    name: string;
    access_state: string;
    access_reason: string | null;
    elements_not_checked: string | null;
  }>;
}

export interface SnaggingQuotation {
  /** Null on a preview: nothing has been written for it yet. */
  id: string | null;
  /** True when this is what the job *would* be quoted, not a saved one. */
  preview?: boolean;
  /** Null on an inspection quotation raised before its job exists. */
  job_id: string | null;
  /** Who and what is being quoted, carried by the quotation itself. */
  client_id?: string | null;
  property_id?: string | null;
  quote_kind?: "inspection" | "visit" | "desnag";
  /** The original inspection a de-snag quotation returns to (change 31). */
  source_job_id?: string | null;
  quote_number: string;
  status: "draft" | "sent" | "approved" | "rejected";
  currency: string;
  subtotal: number;
  tax_rate: number;
  tax_amount: number;
  total: number;
  scope_of_work: string | null;
  terms: string | null;
  lines: SnaggingQuoteLine[];
  sent_at: string | null;
  sent_to: string | null;
  rejected_reason: string | null;
  created_at: string;
  // Snapshot + client-decision fields (FR-2.06, §10).
  property_snapshot?: Record<string, unknown> | null;
  decided_at?: string | null;
  approved_by_name?: string | null;
  /** Returned by the "send" action so the coordinator can copy the client link. */
  approval_url?: string | null;

  /* ── The pricing decisions this document records (FR-2.04, FR-2.15) ── */

  /** What the client declared when it was raised. */
  furnished?: boolean;
  /** Whether it carries the out-of-hours surcharge. Null on older quotations. */
  out_of_hours?: boolean | null;
  /** The built-up rate it was actually priced at. */
  rate_per_sqft?: number | null;
  /** What the size rule proposed, for comparison. */
  rate_suggested?: number | null;
  /** The external-areas rate, where the property has any. */
  external_rate_per_sqft?: number | null;
  external_rate_suggested?: number | null;
  /** True when the rate sits outside the card band; blocks sending. */
  rate_outside_band?: boolean;
  rate_override_reason?: string | null;
  rate_approved_at?: string | null;
  /**
   * Whether the CURRENT reader may sign off pricing outside the band.
   *
   * Computed by the server, because the answer depends on the approval
   * manager of the job this quotation belongs to — which the quotation
   * itself does not carry.
   */
  can_approve_rate?: boolean;

  /**
   * The live client and property behind the document, beside the frozen
   * snapshot the PDF renders from.
   *
   * Only the edit form reads these. The snapshot is deliberately a
   * five-field copy taken when the quotation was priced, so filling an
   * edit form from it would silently drop the plot area, the map pin and
   * everything else it never held.
   */
  property?: Record<string, unknown> | null;
  client?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
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
  notes?: string | null;
  created_at?: string | null;
  /** Only asked for by the Clients page; the picker does not pay for it. */
  job_count?: number;
}

function toParams(
  filters: SnaggingTaskFilters,
  page: number,
  pageSize: number,
) {
  const params: Record<string, string | number> = { page, pageSize };
  Object.entries(filters).forEach(([key, value]) => {
    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      value !== "all"
    ) {
      params[key] = String(value);
    }
  });
  return params;
}

/** The parts of a job record that are fetched separately (see getTask). */
export type TaskSection =
  | "checklist"
  | "snags"
  | "floor_plans"
  | "visit_status"
  | "desnag_quotation";
const ALL_TASK_SECTIONS: ReadonlyArray<TaskSection> = [
  "checklist",
  "snags",
  "floor_plans",
  "visit_status",
  "desnag_quotation",
];

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

  /**
   * The whole job record, as one object: the core job plus its checklist,
   * snags, floor plans, visit status and de-snag quotation.
   *
   * These are separate endpoints now, fetched here in parallel and merged
   * into the shape this call always returned, so the pages that want the
   * whole record (review, report, visit, de-snag builder) are unchanged.
   * The job page itself reads the sections one by one, through
   * JobDetailContext, so each renders the moment it arrives.
   */
  getTask: async (
    id: string,
    init: { signal?: AbortSignal } = {},
    /*
      Only the sections the page uses. Each is its own request, and the
      de-snag builder, say, reads two of the six -- asking for all of them
      put four wasted requests in front of every page that called this.
      Leaving it out asks for everything, as before.
    */
    sections: ReadonlyArray<TaskSection> = ALL_TASK_SECTIONS,
  ): Promise<SnaggingTask> => {
    const want = new Set(sections);
    const [core, checklist, snags, floorPlans, visitStatus, desnag] = await Promise.all([
      snaggingService.getTaskCore(id, init),
      want.has("checklist") ? snaggingService.getTaskChecklist(id, init) : undefined,
      want.has("snags") ? snaggingService.getTaskSnags(id, init) : undefined,
      want.has("floor_plans") ? snaggingService.listFloorPlans(id, init) : undefined,
      want.has("visit_status") ? snaggingService.getTaskVisitStatus(id, init) : undefined,
      want.has("desnag_quotation") ? snaggingService.getTaskDesnagQuotation(id, init) : undefined,
    ]);
    return {
      ...core,
      ...(floorPlans !== undefined ? { floor_plans: floorPlans } : {}),
      ...(snags !== undefined ? { snags } : {}),
      ...(checklist !== undefined ? { checklist } : {}),
      ...(visitStatus !== undefined
        ? { unapproved_visit_ids: visitStatus.unapproved_visit_ids }
        : {}),
      ...(desnag !== undefined ? { desnag_quotation: desnag } : {}),
    };
  },

  /** The job itself: header, property, areas, sign-off. The fast section. */
  getTaskCore: async (id: string, init: { signal?: AbortSignal } = {}): Promise<SnaggingTask> =>
    executeRESTBackend<SnaggingTask>(`/api/snagging/tasks/${id}`, {
      method: "GET",
      signal: init.signal,
    }),

  getTaskChecklist: async (
    id: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<NonNullable<SnaggingTask["checklist"]>> =>
    executeRESTBackend<NonNullable<SnaggingTask["checklist"]>>(
      `/api/snagging/tasks/${id}/checklist`,
      { method: "GET", signal: init.signal },
    ),

  /** The snags this record shows (a root's include its visits'), photos signed. */
  getTaskSnags: async (
    id: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<NonNullable<SnaggingTask["snags"]>> =>
    executeRESTBackend<NonNullable<SnaggingTask["snags"]>>(`/api/snagging/tasks/${id}/snags`, {
      method: "GET",
      signal: init.signal,
    }),

  /** Corrects the reason on a checklist item from the portal; empty clears it. */
  updateChecklistReason: async (
    taskId: string,
    itemId: string,
    reason: string | null,
  ): Promise<{ id: string; reason: string | null }> =>
    executeRESTBackend<{ id: string; reason: string | null }>(
      `/api/snagging/tasks/${taskId}/checklist`,
      { method: "PATCH", body: { item_id: itemId, reason } },
    ),

  /** Corrects the comment given with a de-snag verdict; empty clears it. */
  updateSnagVerdictNote: async (snagId: string, note: string | null) =>
    executeRESTBackend<{ id: string; verdict_note: string | null }>(`/api/snagging/snags/${snagId}`, {
      method: "PATCH",
      body: { verdict_note: note },
    }),

  /** Leaves the inspector a note on a snag, shown on their phone; empty clears it. */
  updateSnagReviewNote: async (snagId: string, note: string | null) =>
    executeRESTBackend<{ id: string; review_note: string | null }>(`/api/snagging/snags/${snagId}`, {
      method: "PATCH",
      body: { review_note: note },
    }),

  /** Corrects a snag's note from the portal; empty text clears it. */
  updateSnagNote: async (snagId: string, note: string | null): Promise<{ id: string; note: string | null }> =>
    executeRESTBackend<{ id: string; note: string | null }>(`/api/snagging/snags/${snagId}`, {
      method: "PATCH",
      body: { note },
    }),

  getTaskVisitStatus: async (
    id: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<{ unapproved_visit_ids: string[] }> =>
    executeRESTBackend<{ unapproved_visit_ids: string[] }>(
      `/api/snagging/tasks/${id}/visit-status`,
      { method: "GET", signal: init.signal },
    ),

  getTaskDesnagQuotation: async (
    id: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<SnaggingTask["desnag_quotation"]> =>
    executeRESTBackend<SnaggingTask["desnag_quotation"]>(
      `/api/snagging/tasks/${id}/desnag-quotation`,
      { method: "GET", signal: init.signal },
    ),

  /**
   * One page of the audit trail, newest first by default.
   *
   * Carries the total alongside the rows: the trail on a job that has been
   * through rounds runs to hundreds of entries, and a pager that cannot say
   * how many there are can only offer "next" until it runs out.
   */
  getAudit: async (
    id: string,
    options?: {
      page?: number;
      pageSize?: number;
      order?: "asc" | "desc";
      signal?: AbortSignal;
    },
  ): Promise<{ data: SnaggingAuditEvent[]; totalCount: number }> =>
    executeRESTBackend<{ data: SnaggingAuditEvent[]; totalCount: number }>(
      `/api/snagging/tasks/${id}/audit`,
      {
        method: "GET",
        params: {
          page: options?.page ?? 0,
          pageSize: options?.pageSize ?? 25,
          order: options?.order ?? "desc",
        },
        signal: options?.signal,
      },
    ),

  createTask: async (
    input: CreateTaskInput,
  ): Promise<{ id: string; code: string }> =>
    executeRESTBackend(`/api/snagging/tasks`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  /** The best few matches for a picker; the server searches, not the page. */
  searchClients: async (
    search?: string,
    options?: { limit?: number },
  ): Promise<SnaggingClientOption[]> =>
    executeRESTBackend<SnaggingClientOption[]>("/api/snagging/clients", {
      method: "GET",
      params: {
        ...(search ? { search } : {}),
        limit: String(options?.limit ?? 20),
      },
    }),

  /** One page of the Clients table, with each client's job count. */
  listClientsPage: async (query: {
    search?: string;
    page: number;
    pageSize: number;
    sortBy?: string;
    sortDirection?: "asc" | "desc";
  }): Promise<{ data: SnaggingClientOption[]; totalCount: number }> =>
    executeRESTBackend<{ data: SnaggingClientOption[]; totalCount: number }>(
      "/api/snagging/clients",
      {
        method: "GET",
        params: {
          ...(query.search ? { search: query.search } : {}),
          with_counts: "true",
          ...(query.sortBy ? { sortBy: query.sortBy } : {}),
          ...(query.sortDirection ? { sortDirection: query.sortDirection } : {}),
          page: String(query.page),
          pageSize: String(query.pageSize),
        },
      },
    ),

  // ── Quotation (F1-F13) ────────────────────────────────────────────────
  getPricing: async (): Promise<SnaggingPricingConfig> =>
    executeRESTBackend<SnaggingPricingConfig>("/api/snagging/pricing", {
      method: "GET",
    }),

  updatePricing: async (
    input: Partial<SnaggingPricingConfig>,
  ): Promise<SnaggingPricingConfig> =>
    executeRESTBackend<SnaggingPricingConfig>("/api/snagging/pricing", {
      method: "PUT",
      body: input as unknown as Record<string, unknown>,
    }),

  /**
   * The job's quotation. With `preview`, a job that has never been quoted
   * comes back with the document it *would* be quoted — priced by the
   * same code the generate action runs, and saved nowhere.
   */
  getQuotation: async (
    taskId: string,
    options: { preview?: boolean; signal?: AbortSignal } = {},
  ): Promise<SnaggingQuotation | null> =>
    executeRESTBackend<SnaggingQuotation | null>(
      `/api/snagging/tasks/${taskId}/quotation`,
      {
        method: "GET",
        params: options.preview ? { preview: "1" } : {},
        signal: options.signal,
      },
    ),

  quotationAction: async (
    taskId: string,
    action: "generate" | "send" | "share_link" | "approve" | "reject",
    extra?: Record<string, unknown>,
  ): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(
      `/api/snagging/tasks/${taskId}/quotation`,
      {
        method: "POST",
        body: { action, ...(extra ?? {}) },
      },
    ),

  // ── Quotations as their own section (BA v2, changes 1-3) ─────────────
  /**
   * Every quotation, newest first — including the ones with no job yet,
   * which is what the Quotations section exists to show.
   */
  /** One page of quotations, with the total and a count per status. */
  listQuotations: async (filters: {
    status?: string;
    kind?: string;
    search?: string;
    page: number;
    pageSize: number;
  }): Promise<{
    data: SnaggingQuotationSummary[];
    totalCount: number;
    counts: Record<string, number>;
  }> =>
    executeRESTBackend("/api/snagging/quotations", {
      method: "GET",
      params: {
        ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
        ...(filters.kind && filters.kind !== "all" ? { kind: filters.kind } : {}),
        ...(filters.search ? { search: filters.search } : {}),
        page: String(filters.page),
        pageSize: String(filters.pageSize),
      },
    }),

  /** Quotes a client's property before any job exists (change 1). */
  createQuotation: async (input: {
    client_id?: string;
    property_id?: string;
    property: Record<string, unknown>;
    /** What the client declared for this quotation (FR-2.15). */
    furnished?: boolean;
    /** Booked outside working hours: adds the out-of-hours surcharge (FR-2.08). */
    out_of_hours?: boolean;
    /** The coordinator's rate, if they moved it off the suggestion (FR-2.04). */
    rate_per_sqft?: number;
    /** The same choice for external areas, where they apply (FR-2.07). */
    external_rate_per_sqft?: number;
    /** Required when the rate sits outside the published band. */
    rate_override_reason?: string;
  }): Promise<SnaggingQuotationSummary> =>
    executeRESTBackend<SnaggingQuotationSummary>("/api/snagging/quotations", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  /**
   * Quotes a return visit to verify fixes on a job already done (change 31).
   * Everything it needs is on the original, so it takes only that job.
   */
  createDesnagQuotation: async (
    sourceJobId: string,
    /** The chosen amount, inside the card's de-snagging range. */
    price?: number,
  ): Promise<SnaggingQuotationSummary> =>
    executeRESTBackend<SnaggingQuotationSummary>("/api/snagging/quotations", {
      method: "POST",
      body: { quote_kind: "desnag", source_job_id: sourceJobId, price },
    }),

  getQuotationById: async (id: string): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(`/api/snagging/quotations/${id}`, {
      method: "GET",
    }),

  /**
   * Corrects a quotation that has not gone out yet.
   *
   * Takes the same shape as createQuotation, because it is the same form:
   * a draft is edited in the wizard it was written in rather than in a
   * second, smaller copy of it that would drift on the first field either
   * of them gained.
   */
  updateQuotation: async (
    id: string,
    input: {
      client_id?: string;
      property: Record<string, unknown>;
      furnished?: boolean;
      out_of_hours?: boolean;
      rate_per_sqft?: number;
      external_rate_per_sqft?: number;
      rate_override_reason?: string;
    },
  ): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(`/api/snagging/quotations/${id}`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    }),

  /** send / share_link / regenerate / approve / reject, by quotation id. */
  /** Admin sign-off on a rate outside the published band (FR-2.04). */
  approveQuotationRate: async (id: string): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(`/api/snagging/quotations/${id}`, {
      method: "POST",
      body: { action: "approve_rate" },
    }),

  quotationActionById: async (
    id: string,
    action: "send" | "share_link" | "regenerate" | "approve" | "reject",
    extra?: Record<string, unknown>,
  ): Promise<SnaggingQuotation> =>
    executeRESTBackend<SnaggingQuotation>(`/api/snagging/quotations/${id}`, {
      method: "POST",
      body: { action, ...(extra ?? {}) },
    }),

  /** Persists a brand-new client and returns it (with its id). */
  createClient: async (input: {
    client_name: string;
    client_email?: string;
    client_phone?: string;
    company?: string;
  }): Promise<SnaggingClientOption> =>
    executeRESTBackend<SnaggingClientOption>("/api/snagging/clients", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  /** Corrects a client's details (FR-1.11). Only what is sent changes. */
  updateClient: async (input: {
    id: string;
    client_name?: string;
    client_email?: string | null;
    client_phone?: string | null;
    company?: string | null;
    notes?: string | null;
  }): Promise<SnaggingClientOption> =>
    executeRESTBackend<SnaggingClientOption>("/api/snagging/clients", {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
    }),

  // ── Properties (BR-1) ──────────────────────────────────────────────────
  listProperties: async (clientId?: string): Promise<SnaggingProperty[]> =>
    executeRESTBackend<SnaggingProperty[]>("/api/snagging/properties", {
      method: "GET",
      params: clientId ? { client_id: clientId } : {},
    }),

  createProperty: async (
    input: SnaggingPropertyInput,
  ): Promise<SnaggingProperty> =>
    executeRESTBackend<SnaggingProperty>("/api/snagging/properties", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateProperty: async (
    id: string,
    input: SnaggingPropertyInput,
  ): Promise<SnaggingProperty> =>
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

    const response = await fetch("/api/snagging/floor-plans", {
      method: "POST",
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error ?? "Failed to upload the floor plan");
    }
    return payload.data;
  },

  listFloorPlans: async (
    taskId: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<SnaggingFloorPlan[]> =>
    executeRESTBackend<SnaggingFloorPlan[]>("/api/snagging/floor-plans", {
      method: "GET",
      params: { task_id: taskId },
      signal: init.signal,
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

  renameFloorPlan: async (
    id: string,
    label: string,
  ): Promise<{ id: string; label: string }> =>
    executeRESTBackend<{ id: string; label: string }>(
      "/api/snagging/floor-plans",
      {
        method: "PATCH",
        body: { id, label },
      },
    ),

  // Area management (FR-3.05 / FR-3.07).
  listAreas: async (taskId: string): Promise<SnaggingArea[]> =>
    executeRESTBackend<SnaggingArea[]>(`/api/snagging/tasks/${taskId}/areas`, {
      method: "GET",
    }),

  createArea: async (
    taskId: string,
    input: CreateAreaInput,
  ): Promise<SnaggingArea> =>
    executeRESTBackend<SnaggingArea>(`/api/snagging/tasks/${taskId}/areas`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateArea: async (
    taskId: string,
    input: UpdateAreaInput,
  ): Promise<SnaggingArea> =>
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
    const response = await fetch("/api/snagging/documents", {
      method: "POST",
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(payload?.error ?? "Failed to upload the document");
    return payload.data;
  },

  updateTask: async (
    id: string,
    input: UpdateTaskInput,
  ): Promise<{ id: string }> =>
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
  /** Starts the review; `complete` also completes it, in the same request. */
  reviewTask: async (id: string, comment?: string, options: { complete?: boolean } = {}) =>
    executeRESTBackend(`/api/snagging/tasks/${id}/review`, {
      method: "POST",
      body: { comment: comment ?? "", ...(options.complete ? { complete_review: true } : {}) },
    }),

  /**
   * FR-6.01 — the reviewer handing the job to the approval manager.
   *
   * The status stays `in_review`; this is what unlocks the decision, so
   * approve and reject both refuse until it has been called.
   */
  completeReview: async (id: string, comment?: string) =>
    executeRESTBackend(`/api/snagging/tasks/${id}/review/complete`, {
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
      /** A wa.me link with the message filled in, for the WhatsApp channel. */
      whatsapp_url?: string | null;
    }>(`/api/snagging/tasks/${id}/deliver`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  /** Renders a report version's PDF again, after a failed or stuck render. */
  retryReportVersion: async (id: string, versionId: string) =>
    executeRESTBackend<{ status: "generated"; version: number; duration_ms: number }>(
      `/api/snagging/tasks/${id}/report/versions`,
      { method: "POST", body: { action: "retry", versionId } },
    ),

  openRound: async (
    id: string,
    input: {
      /** Required: a round is a new site visit and books its own slot. */
      scheduled_date: string;
      appointment_at?: string | null;
      technician_ids?: string[];
      notes?: string;
      snag_ids?: string[];
      approval_manager_id?: string | null;
      /** The approved de-snag quotation this round spends, when known. */
      quotation_id?: string | null;
    },
  ) =>
    executeRESTBackend<{
      id: string;
      code: string;
      round_number: number;
      carried_snags: number;
    }>(`/api/snagging/tasks/${id}/rounds`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  // ── Additional visits (BA v2, changes 25-30) ─────────────────────────
  //
  // A visit is an appointment on the job, not a job of its own, so these
  // all address a row under `/tasks/:id/visits` rather than a second task.

  listVisits: async (
    id: string,
    init: { signal?: AbortSignal } = {},
  ): Promise<{ visits: SnaggingJobVisit[]; versions: unknown[] }> =>
    executeRESTBackend<{ visits: SnaggingJobVisit[]; versions: unknown[] }>(
      `/api/snagging/tasks/${id}/visits`,
      { method: "GET", signal: init.signal },
    ),

  createVisit: async (
    id: string,
    input: {
      /** Required: a visit is a trip and is requested for a specific slot. */
      scheduled_date: string;
      appointment_at?: string | null;
      technician_ids?: string[];
      notes?: string;
      reason?: string;
      approval_manager_id?: string | null;
      /** How the client pays for it (change 26). */
      charge_method?: "quotation" | "payment_link";
      payment_reference?: string;
    },
  ) =>
    executeRESTBackend<{
      id: string;
      visit_number: number;
      charge: number | null;
      charge_method: string;
    }>(`/api/snagging/tasks/${id}/visits`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateVisit: async (
    id: string,
    visitId: string,
    input: Partial<{
      charge_method: "quotation" | "payment_link";
      payment_reference: string | null;
      quotation_id: string | null;
      scheduled_date: string | null;
      appointment_at: string | null;
      inspector_id: string | null;
      /** Everyone attending. Replaces the set; the first becomes inspector_id. */
      technician_ids: string[];
      status: "requested" | "scheduled" | "in_progress" | "completed" | "cancelled";
      notes: string | null;
    }>,
  ): Promise<SnaggingJobVisit> =>
    executeRESTBackend<SnaggingJobVisit>(
      `/api/snagging/tasks/${id}/visits/${visitId}`,
      { method: "PATCH", body: input as unknown as Record<string, unknown> },
    ),

  /**
   * Raises the quotation a visit is charged by, from this job, and links
   * it to the visit (BA v2, change 26). The visit can be booked once the
   * client approves it.
   */
  raiseVisitQuotation: async (
    id: string,
    visitId: string,
  ): Promise<{ id: string; quote_number: string; status: string; total: number }> =>
    executeRESTBackend<{ id: string; quote_number: string; status: string; total: number }>(
      `/api/snagging/tasks/${id}/visits/${visitId}/quotation`,
      { method: "POST" },
    ),

  /** One visit with its snags, quotation, checklist answers and rooms. */
  getVisit: async (id: string, visitId: string): Promise<SnaggingVisitDetail> =>
    executeRESTBackend<SnaggingVisitDetail>(
      `/api/snagging/tasks/${id}/visits/${visitId}`,
      { method: "GET" },
    ),

  /**
   * The approval manager's decision on a submitted visit. Approving
   * reissues the client's report with what the visit found.
   */
  reviewVisit: async (
    id: string,
    visitId: string,
    input: { decision: "approve" } | { decision: "send_back"; reason: string },
  ): Promise<{
    status: string;
    generation?: { status: "pending" | "generated" | "failed"; version: number; error?: string } | null;
  }> =>
    executeRESTBackend(`/api/snagging/tasks/${id}/visits/${visitId}/review`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  cancelVisit: async (id: string, visitId: string) =>
    executeRESTBackend<{ id: string; status: string }>(
      `/api/snagging/tasks/${id}/visits/${visitId}`,
      { method: "DELETE" },
    ),

  listCatalogue: async (
    filters: { search?: string; element?: string; activeOnly?: boolean } = {},
  ): Promise<CatalogueResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.search) params.search = filters.search;
    if (filters.element && filters.element !== "all")
      params.element = filters.element;
    if (filters.activeOnly) params.activeOnly = "true";

    return executeRESTBackend<CatalogueResponse>("/api/snagging/catalogue", {
      method: "GET",
      params,
    });
  },

  createCatalogueEntry: async (
    input: CatalogueEntryInput,
  ): Promise<SnaggingCatalogueEntry> =>
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

  // ---------------------------------------------------------------
  // Catalogue v2: category > sub-category > defect (Action Points P1, P6)
  // ---------------------------------------------------------------

  /**
   * The whole tree in one call.
   *
   * All three levels together rather than one request per level: a picker
   * cannot narrow anything until it has all three, and three round trips
   * on a site connection is the difference between the sheet opening and
   * the inspector giving up.
   */
  getCatalogueTree: async (
    activeOnly = false,
  ): Promise<{
    categories: CatalogueCategory[];
    subcategories: CatalogueSubcategory[];
    defects: CatalogueDefect[];
  }> =>
    executeRESTBackend("/api/snagging/catalogue/v2", {
      method: "GET",
      params: activeOnly ? { activeOnly: "true" } : {},
    }),

  createCatalogueNode: async (
    level: "category" | "subcategory" | "defect",
    input: Record<string, unknown>,
  ) =>
    executeRESTBackend("/api/snagging/catalogue/v2", {
      method: "POST",
      body: { ...input, level },
    }),

  updateCatalogueNode: async (
    level: "category" | "subcategory" | "defect",
    input: Record<string, unknown>,
  ) =>
    executeRESTBackend("/api/snagging/catalogue/v2", {
      method: "PATCH",
      body: { ...input, level },
    }),

  /** BR-8: retire rather than delete, so historical reports resolve. */
  setCatalogueNodeActive: async (
    level: "category" | "subcategory" | "defect",
    id: string,
    active: boolean,
  ) =>
    executeRESTBackend("/api/snagging/catalogue/v2", {
      method: "PATCH",
      body: { level, id, active },
    }),

  // ---------------------------------------------------------------
  // Checklist library (N1, FR-4.13)
  // ---------------------------------------------------------------

  listChecklistLibrary: async (
    filters: {
      search?: string;
      group?: string;
      propertyType?: string;
      activeOnly?: boolean;
      /** Which list to read (N1). Defaults to the technician one. */
      audience?: "technician" | "client";
    } = {},
  ): Promise<ChecklistLibraryResponse> => {
    const params: Record<string, string | number> = {};
    if (filters.search) params.search = filters.search;
    if (filters.group && filters.group !== "all") params.group = filters.group;
    if (filters.propertyType && filters.propertyType !== "all")
      params.propertyType = filters.propertyType;
    if (filters.activeOnly) params.activeOnly = "true";
    if (filters.audience) params.audience = filters.audience;

    return executeRESTBackend<ChecklistLibraryResponse>("/api/snagging/checklist", {
      method: "GET",
      params,
    });
  },

  createChecklistItem: async (
    input: ChecklistItemInput,
  ): Promise<SnaggingChecklistLibraryItem> =>
    executeRESTBackend("/api/snagging/checklist", {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateChecklistItem: async (
    id: string,
    changes: Partial<Omit<ChecklistItemInput, "code">>,
  ): Promise<SnaggingChecklistLibraryItem> =>
    executeRESTBackend("/api/snagging/checklist", {
      method: "PATCH",
      body: { id, ...changes } as unknown as Record<string, unknown>,
    }),

  /**
   * Deactivate rather than delete: a job checklist row still points at this
   * item, so removing it would blank the link on inspections already sent.
   */
  setChecklistItemActive: async (id: string, active: boolean) =>
    executeRESTBackend("/api/snagging/checklist", {
      method: "PATCH",
      body: { id, active },
    }),

  /**
   * The summary carries every grain of the completion chart, so the
   * day / week / month toggle is a local switch and this is only called
   * when the date range actually changes.
   */
  getAnalytics: async (
    range: { from?: string; to?: string } = {},
  ): Promise<SnaggingAnalytics> =>
    executeRESTBackend<SnaggingAnalytics>("/api/snagging/analytics", {
      method: "GET",
      params: {
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
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
    /** Zero-based page; ignored when `all` is set. */
    page?: number;
    pageSize?: number;
    /** Every row, for an export. */
    all?: boolean;
    /** Unit, building or job code. */
    search?: string;
  }): Promise<SnaggingAnalyticsDrilldown> =>
    executeRESTBackend<SnaggingAnalyticsDrilldown>(
      "/api/snagging/analytics/records",
      {
        method: "GET",
        params: {
          metric: query.metric,
          ...(query.value ? { value: query.value } : {}),
          ...(query.from ? { from: query.from } : {}),
          ...(query.to ? { to: query.to } : {}),
          ...(query.granularity ? { granularity: query.granularity } : {}),
          ...(query.search ? { search: query.search } : {}),
          ...(query.all
            ? { all: "1" }
            : {
                page: String(query.page ?? 0),
                pageSize: String(query.pageSize ?? 25),
              }),
        },
      },
    ),
};
