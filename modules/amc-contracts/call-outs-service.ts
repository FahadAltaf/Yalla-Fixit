import type { z } from "zod";

import type { callOutActionSchema, callOutCreateSchema, CallOutPriority } from "@/lib/amc/call-outs";
import type { TechnicianFit, Trade } from "@/lib/amc/visits";
import type { AllowanceRow, CallOutRecord, CoveragePreview, WorkPhoto } from "@/lib/server/amc/call-outs";

/**
 * Browser calls for AMC call outs and allowances (Phase 11: DEV-405, 406,
 * 408, 409): the list, the coverage answer before logging, logging one,
 * one call out with its actions and photos, crew suggestions for a slot,
 * and a contract's allowances. The server checks who may change what;
 * `canCreate`, `canEdit` and `canOverride` only decide what is offered.
 */

export type { AllowanceRow, CallOutRecord, CoveragePreview, TechnicianFit, WorkPhoto };

/** What a screen sends: the schemas' input, before their trims and defaults. */
export type CallOutCreateBody = z.input<typeof callOutCreateSchema>;
export type CallOutActionInput = z.input<typeof callOutActionSchema>;

export type CallOutPhotoKind = "reported" | "before" | "after" | "finding" | "other";

export interface CallOutsResponse {
  migrated: boolean;
  callOuts: CallOutRecord[];
  canCreate: boolean;
  canOverride: boolean;
}

export interface CoverageQuery {
  contractId: string;
  priority: CallOutPriority;
  partsExpected: boolean;
  partsValueAed?: number | null;
  excluded: boolean;
}

export type CoverageResponse = CoveragePreview & {
  contract: { id: string; number: string; customerName: string; propertyLabel: string; status: string };
  canOverride: boolean;
};

export interface CreateCallOutResult {
  id: string;
  callOutNo: string;
  coverage: "covered" | "chargeable";
  reserved: boolean;
  reasons: string[];
  chargeableExtras: string[];
  /** The prepared acknowledgement text. */
  message: string;
  /** A wa.me link, or null without a phone number. */
  whatsapp: string | null;
  /** Emergencies only: logged within the configured minutes of the call. */
  loggedInTime: boolean | null;
}

export interface CallOutAllowance {
  serviceLabel: string;
  unlimited: boolean;
  included: number | null;
  used: number;
  reserved: number;
  remaining: number | null;
  nearZero: boolean;
}

export interface CallOutWorkSummary {
  id: string;
  workNo: string;
  status: string;
  finding: string;
  total: number;
  risk: string;
}

export interface CallOutDetailResponse {
  callOut: CallOutRecord;
  allowance: CallOutAllowance | null;
  photos: WorkPhoto[];
  additionalWorks: CallOutWorkSummary[];
  loggedInTime: boolean | null;
  minorFixHours: number;
  canEdit: boolean;
  canOverride: boolean;
}

export interface CallOutSuggestion {
  fits: TechnicianFit[];
  suggested: { technicianIds: string[]; uncovered: Trade[] };
}

export interface CallOutActionResult {
  ok: true;
  /** record: parts, or more than the minor-fix hours, make the corrective work additional work. */
  suggestAdditionalWork?: boolean;
}

export type AllowanceMovementKind = "consumption" | "adjustment" | "correction" | "reserve" | "release";

export interface AllowanceMovement {
  id: string;
  serviceLabel: string;
  kind: AllowanceMovementKind | string;
  quantity: number;
  occurredAt: string;
  source: string;
  notes: string | null;
  callOutNo: string | null;
  createdAt: string;
}

export interface WorkRollup {
  count: number;
  quoted: number;
  approved: number;
  rejected: number;
  invoiced: number;
  paid: number;
}

export interface AllowancesResponse {
  migrated: boolean;
  allowances: AllowanceRow[];
  movements: AllowanceMovement[];
  additionalWork: WorkRollup;
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return parse<T>(response);
}

const callOutUrl = (id: string) => `/api/amc-call-outs/${encodeURIComponent(id)}`;

export const callOutsService = {
  list(params: { contractId?: string | null; open?: boolean } = {}) {
    const query = new URLSearchParams();
    if (params.contractId) query.set("contractId", params.contractId);
    if (params.open) query.set("open", "1");
    const qs = query.toString();
    return request<CallOutsResponse>(`/api/amc-call-outs${qs ? `?${qs}` : ""}`);
  },
  coverage(input: CoverageQuery) {
    return request<CoverageResponse>("/api/amc-call-outs/coverage", { method: "POST", body: JSON.stringify(input) });
  },
  create(input: CallOutCreateBody) {
    return request<CreateCallOutResult>("/api/amc-call-outs", { method: "POST", body: JSON.stringify(input) });
  },
  callOut(id: string) {
    return request<CallOutDetailResponse>(callOutUrl(id));
  },
  suggest(id: string, date: string, time: string, duration?: number | null) {
    const params = new URLSearchParams({ suggest: "1", date, time });
    if (duration) params.set("duration", String(duration));
    return request<CallOutSuggestion>(`${callOutUrl(id)}?${params.toString()}`);
  },
  action(id: string, action: CallOutActionInput) {
    return request<CallOutActionResult>(callOutUrl(id), { method: "POST", body: JSON.stringify(action) });
  },
  /** multipart/form-data: the browser sets the boundary, so no JSON content type here. */
  async addPhoto(id: string, input: { file: File; kind: CallOutPhotoKind; caption?: string | null }) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.caption?.trim()) form.append("caption", input.caption.trim());
    const response = await fetch(`${callOutUrl(id)}/photos`, { method: "POST", body: form });
    return parse<{ photo: { id: string } }>(response);
  },
  removePhoto(id: string, photoId: string) {
    return request<{ ok: true }>(`${callOutUrl(id)}/photos?photoId=${encodeURIComponent(photoId)}`, { method: "DELETE" });
  },
  allowances(contractId: string) {
    return request<AllowancesResponse>(`/api/amc-contracts/${encodeURIComponent(contractId)}/allowances`);
  },
};

/* The same calls as plain functions, for screens that import them one by one. */
export const { list, coverage, create, callOut, suggest, action, addPhoto, removePhoto, allowances } = callOutsService;
