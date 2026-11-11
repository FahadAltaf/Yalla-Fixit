import type { z } from "zod";

import type { additionalWorkActionSchema, additionalWorkCreateSchema } from "@/lib/amc/call-outs";
import type { AdditionalWorkRecord, WorkSlot } from "@/lib/server/amc/additional-works";
import type { FieldVisitHistoryItem } from "@/lib/server/amc/field-visits";
import type { CallOutSuggestion } from "@/modules/amc-contracts/call-outs-service";
import type { WorkPhoto } from "@/lib/server/amc/call-outs";
import { amcRequest } from "@/lib/amc/http-cache";

/**
 * Browser calls for AMC additional works (Phase 11: DEV-407): the list,
 * raising one from a visit, a call out or by hand, one work with its
 * actions (finding, parties, quotation, share, approve ... paid) and its
 * photos. The server checks who may change what; `canCreate` and
 * `canEdit` only decide what is offered.
 */

export type { AdditionalWorkRecord, WorkPhoto, WorkSlot };

/** Technicians for a slot: the same answer as a call out's. */
export type WorkCrewSuggestion = CallOutSuggestion;

/** What a screen sends: the schemas' input, before their trims and defaults. */
export type AdditionalWorkCreateBody = z.input<typeof additionalWorkCreateSchema>;
export type AdditionalWorkActionInput = z.input<typeof additionalWorkActionSchema>;

export type WorkPhotoKind = "finding" | "before" | "after" | "other";
export type ShareOutcome = "sent" | "failed" | "no_recipient";

export interface AdditionalWorksResponse {
  migrated: boolean;
  works: AdditionalWorkRecord[];
  canCreate: boolean;
}

export interface AdditionalWorkResponse {
  work: AdditionalWorkRecord;
  photos: WorkPhoto[];
  /** When and who does the work (20261112100000). */
  slot: WorkSlot;
  canEdit: boolean;
}

export interface WorkActionResult {
  ok: true;
  /** share: how the quotation email went, and the prepared WhatsApp text. */
  outcome?: ShareOutcome;
  documentId?: string;
  message?: string;
  whatsapp?: string | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  return amcRequest<T>(url, init);
}

const workUrl = (id: string) => `/api/amc-additional-works/${encodeURIComponent(id)}`;

export const additionalWorksService = {
  list(params: { contractId?: string | null; callOutId?: string | null; visitId?: string | null } = {}) {
    const query = new URLSearchParams();
    if (params.contractId) query.set("contractId", params.contractId);
    if (params.callOutId) query.set("callOutId", params.callOutId);
    if (params.visitId) query.set("visitId", params.visitId);
    const qs = query.toString();
    return request<AdditionalWorksResponse>(`/api/amc-additional-works${qs ? `?${qs}` : ""}`);
  },
  create(input: AdditionalWorkCreateBody) {
    return request<{ id: string; workNo: string }>("/api/amc-additional-works", { method: "POST", body: JSON.stringify(input) });
  },
  work(id: string) {
    return request<AdditionalWorkResponse>(workUrl(id));
  },
  /** Technicians with the work's trade for a slot, and the suggested crew. */
  suggest(id: string, date: string, time: string, durationMinutes: number) {
    const params = new URLSearchParams({ suggest: "1", date, time, duration: String(durationMinutes) });
    return request<WorkCrewSuggestion>(`${workUrl(id)}?${params.toString()}`);
  },
  /** Everything that happened to the work, newest first (its page's History tab). */
  history(id: string) {
    return request<{ history: FieldVisitHistoryItem[] }>(`${workUrl(id)}/history`);
  },
  action(id: string, action: AdditionalWorkActionInput) {
    return request<WorkActionResult>(workUrl(id), { method: "POST", body: JSON.stringify(action) });
  },
  /** multipart/form-data: the browser sets the boundary, so no JSON content type here. */
  async addPhoto(id: string, input: { file: File; kind: WorkPhotoKind; caption?: string | null }) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.caption?.trim()) form.append("caption", input.caption.trim());
    return request<{ photo: { id: string } }>(`${workUrl(id)}/photos`, { method: "POST", body: form });
  },
  removePhoto(id: string, photoId: string) {
    return request<{ ok: true }>(`${workUrl(id)}/photos?photoId=${encodeURIComponent(photoId)}`, { method: "DELETE" });
  },
};

/* The same calls as plain functions, for screens that import them one by one. */
export const { list, create, work, action, addPhoto, removePhoto } = additionalWorksService;
