import { executeRESTBackend } from "@/lib/rest-server";
import type { SavedFilter } from "@/lib/server/reports/access";
import type { CapacityReport, UtilizationReport } from "@/lib/server/reports/planning";
import type { ActualTimesReport, QuotationReport, UnflaggedReport } from "@/lib/server/reports/reports";

export type ReportKey = "quotations" | "exceptions" | "utilization" | "capacity";
export type ReportFilters = Record<string, string>;
export type ReportCan = { can: { view: boolean; export: boolean } };

export type ReportRequestOptions = {
  page?: number;
  pageSize?: number;
  /** Log this load as an opening of the report (once per visit). */
  logView?: boolean;
  /** Every matching row, for a file; needs Export. */
  exportFormat?: "csv" | "xlsx";
  signal?: AbortSignal;
};

function paramsOf(filters: ReportFilters, options: ReportRequestOptions): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) if (value) params[key] = value;
  if (options.exportFormat) params.export = options.exportFormat;
  else {
    params.page = options.page ?? 0;
    params.pageSize = options.pageSize ?? 25;
  }
  if (options.logView) params.log = "view";
  return params;
}

export const reportsService = {
  quotations: (filters: ReportFilters, options: ReportRequestOptions = {}) =>
    executeRESTBackend<QuotationReport & ReportCan>("/api/reports/quotations", {
      params: paramsOf(filters, options),
      signal: options.signal,
    }),

  exceptions: (filters: ReportFilters, options: ReportRequestOptions = {}) =>
    executeRESTBackend<(UnflaggedReport | ActualTimesReport) & ReportCan>("/api/reports/exceptions", {
      params: paramsOf(filters, options),
      signal: options.signal,
    }),

  utilization: (filters: ReportFilters, options: ReportRequestOptions = {}) =>
    executeRESTBackend<UtilizationReport & ReportCan>("/api/reports/utilization", {
      params: paramsOf(filters, options),
      signal: options.signal,
    }),

  capacity: (filters: ReportFilters, options: ReportRequestOptions = {}) =>
    executeRESTBackend<CapacityReport & ReportCan>("/api/reports/capacity", {
      params: paramsOf(filters, options),
      signal: options.signal,
    }),

  savedFilters: (report: ReportKey) =>
    executeRESTBackend<{ lastUsed: ReportFilters | null; saved: SavedFilter[] }>("/api/reports/saved-filters", {
      params: { report },
    }),

  rememberFilters: (report: ReportKey, filters: ReportFilters) =>
    executeRESTBackend<{ ok: true }>("/api/reports/saved-filters", { method: "PUT", body: { report, filters } }),

  saveFilters: (report: ReportKey, name: string, filters: ReportFilters) =>
    executeRESTBackend<SavedFilter>("/api/reports/saved-filters", { method: "POST", body: { report, name, filters } }),

  deleteFilters: (id: string) =>
    executeRESTBackend<{ ok: true }>("/api/reports/saved-filters", { method: "DELETE", params: { id } }),
};
