import { executeRESTBackend } from "@/lib/rest-server";
import type {
  SnaggingAnalytics,
  SnaggingOverview,
  SnaggingCatalogueArea,
  SnaggingCatalogueEntry,
  SnaggingTask,
  SnaggingTaskSummary,
} from "@/types/types";
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
  projectId?: string;
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

  createTask: async (input: CreateTaskInput): Promise<{ id: string; code: string }> =>
    executeRESTBackend(`/api/snagging/tasks`, {
      method: "POST",
      body: input as unknown as Record<string, unknown>,
    }),

  updateTask: async (id: string, input: UpdateTaskInput): Promise<{ id: string }> =>
    executeRESTBackend(`/api/snagging/tasks/${id}`, {
      method: "PATCH",
      body: input as unknown as Record<string, unknown>,
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

  getAnalytics: async (range: { from?: string; to?: string } = {}): Promise<SnaggingAnalytics> =>
    executeRESTBackend<SnaggingAnalytics>("/api/snagging/analytics", {
      method: "GET",
      params: {
        ...(range.from ? { from: range.from } : {}),
        ...(range.to ? { to: range.to } : {}),
      },
    }),
};
