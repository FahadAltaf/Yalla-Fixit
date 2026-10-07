import type {
  AccessRuleRecord,
  AssetRecord,
  CommunicationRecord,
  ContactRecord,
  DocumentRecord,
  ScopeItemRecord,
} from "@/lib/server/amc/client-profile";
import type { DocumentLevel } from "@/lib/amc/client-profile";

/** Browser calls for the client profile, property extras and documents (Phase 2). */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(url, {
    ...init,
    headers: isForm ? init?.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

export type { AccessRuleRecord, AssetRecord, CommunicationRecord, ContactRecord, DocumentRecord, ScopeItemRecord };

export interface ContactInput {
  role: string;
  name: string;
  position?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface CommunicationInput {
  channel: string;
  direction: "outbound" | "inbound" | "internal";
  subject?: string | null;
  summary: string;
  occurredAt?: string;
  propertyId?: string | null;
  contractId?: string | null;
}

export interface AssetInput {
  assetType: string;
  trade: string;
  quantity: number;
  location?: string | null;
  make?: string | null;
  model?: string | null;
  serialNo?: string | null;
  capacity?: string | null;
  installedOn?: string | null;
  condition: string;
  notes?: string | null;
}

export interface AccessRuleInput {
  accessType: string;
  issuer?: string | null;
  leadTimeDays: number;
  permittedDays: number[];
  permittedFrom?: string | null;
  permittedTo?: string | null;
  parking?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface ScopeItemInput {
  serviceId: string;
  trade: string;
  assetId?: string | null;
  quantity: number;
  frequencyPerYear?: number | null;
  durationMinutes?: number | null;
  preferredMonths: number[];
  preferredDays: number[];
  exclusions?: string | null;
  notes?: string | null;
  active?: boolean;
}

const c = (customerId: string) => `/api/amc-contracts/customers/${customerId}`;
const p = (propertyId: string) => `/api/amc-contracts/properties/${propertyId}`;
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const clientProfileService = {
  contacts: (customerId: string) => request<{ contacts: ContactRecord[]; migrated: boolean }>(`${c(customerId)}/contacts`),
  addContact: (customerId: string, input: ContactInput) => request<{ contact: ContactRecord }>(`${c(customerId)}/contacts`, json("POST", input)),
  updateContact: (customerId: string, contactId: string, input: ContactInput) =>
    request<{ contact: ContactRecord }>(`${c(customerId)}/contacts/${contactId}`, json("PATCH", input)),

  communications: (customerId: string, offset = 0) =>
    request<{ entries: CommunicationRecord[]; migrated: boolean }>(`${c(customerId)}/communications?offset=${offset}`),
  logCommunication: (customerId: string, input: CommunicationInput) => request<{ ok: true }>(`${c(customerId)}/communications`, json("POST", input)),

  setConsent: (customerId: string, input: { consent: boolean; source: string }) => request<{ ok: true }>(`${c(customerId)}/consent`, json("POST", input)),

  assets: (propertyId: string) => request<{ assets: AssetRecord[]; migrated: boolean }>(`${p(propertyId)}/assets`),
  addAsset: (propertyId: string, input: AssetInput) => request<{ asset: AssetRecord }>(`${p(propertyId)}/assets`, json("POST", input)),
  updateAsset: (propertyId: string, assetId: string, input: AssetInput) =>
    request<{ asset: AssetRecord }>(`${p(propertyId)}/assets/${assetId}`, json("PATCH", input)),
  retireAsset: (propertyId: string, assetId: string, reason: string) =>
    request<{ asset: AssetRecord }>(`${p(propertyId)}/assets/${assetId}/retire`, json("POST", { reason })),

  accessRules: (propertyId: string) => request<{ rules: AccessRuleRecord[]; migrated: boolean }>(`${p(propertyId)}/access-rules`),
  addAccessRule: (propertyId: string, input: AccessRuleInput) => request<{ rule: AccessRuleRecord }>(`${p(propertyId)}/access-rules`, json("POST", input)),
  updateAccessRule: (propertyId: string, ruleId: string, input: AccessRuleInput) =>
    request<{ rule: AccessRuleRecord }>(`${p(propertyId)}/access-rules/${ruleId}`, json("PATCH", input)),

  scope: (propertyId: string) => request<{ items: ScopeItemRecord[]; migrated: boolean }>(`${p(propertyId)}/scope`),
  addScopeItem: (propertyId: string, input: ScopeItemInput) => request<{ item: ScopeItemRecord }>(`${p(propertyId)}/scope`, json("POST", input)),
  updateScopeItem: (propertyId: string, itemId: string, input: ScopeItemInput) =>
    request<{ item: ScopeItemRecord }>(`${p(propertyId)}/scope/${itemId}`, json("PATCH", input)),

  documents: (filter: { level: DocumentLevel; entityId: string } | { customerId: string }) => {
    const q = "customerId" in filter ? `customerId=${filter.customerId}` : `level=${filter.level}&entityId=${filter.entityId}`;
    return request<{ documents: DocumentRecord[]; migrated: boolean }>(`/api/amc-documents?${q}`);
  },
  uploadDocument: (input: { file: File; level: DocumentLevel; entityId: string; category: string; title: string; expiresOn?: string | null; notes?: string | null }) => {
    const form = new FormData();
    form.set("file", input.file);
    form.set("level", input.level);
    form.set("entityId", input.entityId);
    form.set("category", input.category);
    form.set("title", input.title);
    if (input.expiresOn) form.set("expiresOn", input.expiresOn);
    if (input.notes) form.set("notes", input.notes);
    return request<{ document: DocumentRecord }>("/api/amc-documents", { method: "POST", body: form });
  },
  documentUrl: (documentId: string) => request<{ url: string }>(`/api/amc-documents/${documentId}`),
};
