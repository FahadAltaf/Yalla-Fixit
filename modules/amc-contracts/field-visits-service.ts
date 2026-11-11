import { amcRequest } from "@/lib/amc/http-cache";
import type { FieldVisitKind, FieldVisitStage, FieldVisitWhen } from "@/lib/amc/field-visits";
import type { FieldVisitHistoryItem, FieldVisitRow } from "@/lib/server/amc/field-visits";

export type { FieldVisitHistoryItem, FieldVisitRow };

export interface FieldVisitsResponse {
  migrated: boolean;
  visits: FieldVisitRow[];
  total: number;
  stageCounts: Record<FieldVisitStage, number>;
  today: string;
  page: number;
  pageSize: number;
}

export interface FieldVisitQuery {
  kind?: FieldVisitKind | null;
  stage?: FieldVisitStage | "open" | "all";
  when?: FieldVisitWhen;
  technician?: string | null;
  contract?: string | null;
  customer?: string | null;
  q?: string;
  page: number;
  pageSize: number;
}

/** AMC -> Visits (lib/server/amc/field-visits.ts). Reads go through the AMC cache: a page asked twice at once is one request. */
export const fieldVisitsService = {
  list(query: FieldVisitQuery) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "" || value === "any" || (key === "stage" && value === "open")) continue;
      params.set(key, String(value));
    }
    return amcRequest<FieldVisitsResponse>(`/api/amc-field-visits?${params.toString()}`);
  },
  /** One visit, as the list shows it (the visit page's header). */
  visit(id: string) {
    return amcRequest<{ visit: FieldVisitRow }>(`/api/amc-field-visits/${id}`);
  },
  /** Everything that happened to it, newest first. */
  history(id: string) {
    return amcRequest<{ history: FieldVisitHistoryItem[] }>(`/api/amc-field-visits/${id}/history`);
  },
  /** The active technicians (a stable list, cached for minutes). */
  technicians() {
    return amcRequest<{ technicians: Array<{ id: string; name: string }> }>("/api/amc-field-visits/technicians");
  },
};
