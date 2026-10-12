import type { z } from "zod";

import type { additionalWorkActionSchema, additionalWorkCreateSchema } from "@/lib/amc/call-outs";
import type { AdditionalWorkRecord } from "@/lib/server/amc/additional-works";
import type { WorkPhoto } from "@/lib/server/amc/call-outs";

/**
 * Browser calls for AMC additional works (Phase 11: DEV-407): the list,
 * raising one from a visit, a call out or by hand, one work with its
 * actions (finding, parties, quotation, share, approve ... paid) and its
 * photos. The server checks who may change what; `canCreate` and
 * `canEdit` only decide what is offered.
 */

export type { AdditionalWorkRecord, WorkPhoto };

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
  action(id: string, action: AdditionalWorkActionInput) {
    return request<WorkActionResult>(workUrl(id), { method: "POST", body: JSON.stringify(action) });
  },
  /** multipart/form-data: the browser sets the boundary, so no JSON content type here. */
  async addPhoto(id: string, input: { file: File; kind: WorkPhotoKind; caption?: string | null }) {
    const form = new FormData();
    form.append("file", input.file);
    form.append("kind", input.kind);
    if (input.caption?.trim()) form.append("caption", input.caption.trim());
    const response = await fetch(`${workUrl(id)}/photos`, { method: "POST", body: form });
    return parse<{ photo: { id: string } }>(response);
  },
  removePhoto(id: string, photoId: string) {
    return request<{ ok: true }>(`${workUrl(id)}/photos?photoId=${encodeURIComponent(photoId)}`, { method: "DELETE" });
  },
};

/* The same calls as plain functions, for screens that import them one by one. */
export const { list, create, work, action, addPhoto, removePhoto } = additionalWorksService;
