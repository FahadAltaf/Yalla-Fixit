// Browser client for the Manpower Compliance API. Thin: every rule lives on
// the server. Nothing here may import the admin client or Zoho code (this
// file ends up in client bundles through the modules barrel).

import { executeRESTBackend } from "@/lib/rest-server";
import type {
  CertificateType,
  ComplianceSettings,
  EmployeeListResponse,
  EmployeeRecord,
  LookupOption,
  OverviewKpis,
  ReminderRow,
  SiteClientOption,
  SitePropertyOption,
  TechnicianOption,
} from "@/lib/compliance/types";
import type { ComplianceRights } from "@/lib/server/compliance/access";
import type { EmployeeInput } from "@/lib/compliance/validation";

export type ComplianceListKey = "designation" | "nationality";

export type EmployeePatchBody = Partial<Omit<EmployeeInput, "identity" | "certificates">> & {
  identity?: Partial<EmployeeInput["identity"]>;
  certificates?: EmployeeInput["certificates"];
};

export type SettingsResponse = ComplianceSettings & {
  deactivation_request_recipients: { id: string; email: string; name: string }[];
};

export type PortalUserOption = { id: string; name: string; email: string };

export type ComplianceDocument = {
  id: string;
  employee_id: string;
  item_key: string;
  expiry_date: string | null;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  uploader: string | null;
  created_at: string;
  current: boolean;
};

const clean = (params: Record<string, string | number | undefined | null | boolean>) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => [k, String(v)])) as Record<string, string>;

/** A refused write, with the per-field messages the server sent, so the form can highlight them. */
export class ComplianceApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(message: string, status: number, fields: Record<string, string> = {}) {
    super(message);
    this.name = "ComplianceApiError";
    this.status = status;
    this.fields = fields;
  }
}

/*
  Writes go through fetch directly rather than executeRESTBackend, which
  throws a plain Error and drops the `fields` map (lib/rest-server.ts). A
  401 is still surfaced the same way the rest of the app expects.
*/
async function write<T>(endpoint: string, method: "POST" | "PATCH", body: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string; fields?: Record<string, string> };
  if (!response.ok) {
    if (response.status === 401) throw new ComplianceApiError("Your session has expired. Sign in again.", 401);
    throw new ComplianceApiError(payload.error ?? `Request failed (${response.status})`, response.status, payload.fields ?? {});
  }
  return payload.data as T;
}

export const complianceService = {
  rights: () => executeRESTBackend<ComplianceRights>("/api/compliance/me"),

  listEmployees: (params: {
    q?: string;
    employment_status?: string;
    item_status?: string;
    site?: string;
    include_archived?: boolean;
    page: number;
    pageSize: number;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }) => executeRESTBackend<EmployeeListResponse>("/api/compliance/employees", { params: clean(params) }),

  findByMaherId: (maherId: string) => executeRESTBackend<EmployeeRecord[]>("/api/compliance/employees", { params: { maher_id: maherId } }),

  getEmployee: (id: string) => executeRESTBackend<EmployeeRecord>(`/api/compliance/employees/${id}`),

  createEmployee: (body: EmployeeInput) => write<EmployeeRecord>("/api/compliance/employees", "POST", body),

  updateEmployee: (id: string, body: EmployeePatchBody) => write<EmployeeRecord>(`/api/compliance/employees/${id}`, "PATCH", body),

  setArchived: (id: string, archived: boolean, reason?: string | null) =>
    executeRESTBackend<EmployeeRecord>(`/api/compliance/employees/${id}/archive`, { method: "POST", body: { archived, reason: reason ?? null } }),

  /** Files on an employee (C2); needs the identity right. */
  documents: (id: string) => executeRESTBackend<ComplianceDocument[]>(`/api/compliance/employees/${id}/documents`),
  openDocument: (id: string, documentId: string) =>
    executeRESTBackend<{ url: string }>(`/api/compliance/employees/${id}/documents`, { params: { open: documentId } }),
  uploadDocument: async (id: string, itemKey: string, file: File, expiryDate: string | null): Promise<ComplianceDocument> => {
    const form = new FormData();
    form.append("file", file);
    form.append("item_key", itemKey);
    if (expiryDate) form.append("expiry_date", expiryDate);
    const response = await fetch(`/api/compliance/employees/${id}/documents`, { method: "POST", body: form, credentials: "same-origin" });
    const payload = (await response.json().catch(() => ({}))) as { data?: ComplianceDocument; error?: string };
    if (!response.ok) throw new ComplianceApiError(payload.error ?? `Upload failed (${response.status})`, response.status);
    return payload.data as ComplianceDocument;
  },

  /** Full number for one field; needs the identity right. Audited on the server. */
  revealIdentity: (id: string, field: "emirates_id" | "passport") =>
    write<{ field: string; value: string | null }>(`/api/compliance/employees/${id}/identity/reveal`, "POST", { field }),

  requestDeactivation: (id: string, note?: string | null) =>
    executeRESTBackend<{ sent: true; recipients: string[] }>(`/api/compliance/employees/${id}/deactivation-request`, { method: "POST", body: { note: note ?? null } }),

  reminders: (params: { item?: string; status?: string; site?: string }) =>
    executeRESTBackend<{ rows: ReminderRow[]; as_of: string }>("/api/compliance/reminders", { params: clean(params) }),

  kpis: () => executeRESTBackend<OverviewKpis>("/api/compliance/overview/kpis"),

  certificateTypes: (includeInactive = true) =>
    executeRESTBackend<CertificateType[]>("/api/compliance/certificate-types", { params: { include_inactive: String(includeInactive) } }),
  createCertificateType: (body: { name: string; expires: boolean; sort_order?: number }) =>
    executeRESTBackend<CertificateType>("/api/compliance/certificate-types", { method: "POST", body }),
  updateCertificateType: (body: { id: string; name?: string; expires?: boolean; sort_order?: number; is_active?: boolean }) =>
    executeRESTBackend<CertificateType>("/api/compliance/certificate-types", { method: "PATCH", body }),

  listOptions: (key: ComplianceListKey) => executeRESTBackend<LookupOption[]>(`/api/compliance/lists/${key}`),
  createOption: (key: ComplianceListKey, name: string) => executeRESTBackend<LookupOption>(`/api/compliance/lists/${key}`, { method: "POST", body: { name } }),
  renameOption: (key: ComplianceListKey, id: string, name: string) =>
    executeRESTBackend<LookupOption>(`/api/compliance/lists/${key}`, { method: "PATCH", body: { id, name } }),
  deleteOption: (key: ComplianceListKey, id: string) => executeRESTBackend<{ deleted: true }>(`/api/compliance/lists/${key}`, { method: "DELETE", params: { id } }),

  siteClients: (q: string, page = 0, pageSize = 20) =>
    executeRESTBackend<{ data: SiteClientOption[]; hasMore: boolean; source: "fsm" | "portal" }>("/api/compliance/sites", { params: clean({ q, page, pageSize }) }),
  siteProperties: (clientId: string) => executeRESTBackend<SitePropertyOption[]>("/api/compliance/sites", { params: { client: clientId } }),
  resolveSite: (client: { id?: string | null; fsm_contact_id?: string | null }, property?: string | null) =>
    executeRESTBackend<{ site_client_id: string; client_name: string; site_property_id: string | null }>("/api/compliance/sites", { method: "POST", body: { client, property: property ?? null } }),

  technicians: (q: string) => executeRESTBackend<TechnicianOption[]>("/api/compliance/technicians", { params: clean({ q }) }),
  /** Run the FSM roster sync now (Compliance Edit). */
  refreshRoster: () => executeRESTBackend<{ synced_at: string | null }>("/api/compliance/technicians/refresh", { method: "POST" }),
  rosterSyncedAt: () => executeRESTBackend<{ synced_at: string | null }>("/api/compliance/technicians/refresh"),

  settings: () => executeRESTBackend<SettingsResponse>("/api/compliance/settings"),
  updateSettings: (body: { overdue_repeat_days?: number; deactivation_request_user_ids?: string[] }) =>
    executeRESTBackend<SettingsResponse>("/api/compliance/settings", { method: "PATCH", body }),

  portalUsers: (q = "") => executeRESTBackend<PortalUserOption[]>("/api/compliance/users", { params: clean({ q }) }),
};
