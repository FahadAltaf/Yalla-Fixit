import type { CreateEnquiryInput, FollowUpInput, SiteVisitInput, StageChangeInput, UpdateEnquiryInput } from "@/lib/amc/enquiries";
import type { EnquiryRecord, FollowUpRecord, SiteVisitSummary } from "@/lib/server/amc/enquiries";
import type { StatusHistoryItem } from "@/lib/server/amc/status-history";

/** Browser calls for the AMC enquiry pipeline (Phase 3). */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export type { CreateEnquiryInput, EnquiryRecord, FollowUpInput, FollowUpRecord, SiteVisitInput, SiteVisitSummary, StageChangeInput, StatusHistoryItem, UpdateEnquiryInput };

export interface EnquiryMeta {
  stages: string[];
  sources: string[];
  lostReasons: string[];
  idleDays: number;
  managementEscalationDays: number;
  siteVisitRule: "flag" | "block";
  siteVisitRequiredCategories: string[];
  people: Array<{ id: string; name: string; email: string | null }>;
  me: string;
  canCreate: boolean;
  canEdit: boolean;
  canExport: boolean;
}

export interface EnquiryListParams {
  stage?: string | null;
  owner?: string | null;
  source?: string | null;
  followUp?: "overdue" | "today" | "week" | null;
  idle?: boolean;
  customer?: string | null;
  q?: string | null;
  page?: number;
  pageSize?: number;
}

export interface EnquiryDetailResponse {
  enquiry: EnquiryRecord;
  followUps: FollowUpRecord[];
  siteVisits: SiteVisitSummary[];
  history: StatusHistoryItem[];
  canEdit: boolean;
}

type StageResult = { enquiry: EnquiryRecord; warning: string | null };

export const enquiriesService = {
  meta() {
    return request<EnquiryMeta>("/api/amc-enquiries/meta");
  },
  list(params: EnquiryListParams = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "" || value === false) continue;
      query.set(key, value === true ? "1" : String(value));
    }
    return request<{ enquiries: EnquiryRecord[]; total: number; page: number; pageSize: number; migrated: boolean }>(`/api/amc-enquiries?${query.toString()}`);
  },
  get(id: string) {
    return request<EnquiryDetailResponse>(`/api/amc-enquiries/${id}`);
  },
  create(input: CreateEnquiryInput) {
    return request<{ enquiry: EnquiryRecord }>("/api/amc-enquiries", { method: "POST", body: JSON.stringify(input) });
  },
  update(id: string, patch: UpdateEnquiryInput) {
    return request<{ enquiry: EnquiryRecord }>(`/api/amc-enquiries/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  changeStage(id: string, input: StageChangeInput) {
    return request<StageResult>(`/api/amc-enquiries/${id}/stage`, { method: "POST", body: JSON.stringify(input) });
  },
  addFollowUp(id: string, input: FollowUpInput) {
    return request<StageResult>(`/api/amc-enquiries/${id}/follow-ups`, { method: "POST", body: JSON.stringify(input) });
  },
  scheduleSiteVisit(id: string, input: SiteVisitInput) {
    return request<{ assessmentId: string; enquiry: EnquiryRecord }>(`/api/amc-enquiries/${id}/site-visit`, { method: "POST", body: JSON.stringify(input) });
  },
};
