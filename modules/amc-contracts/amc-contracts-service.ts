import type {
  ContractDisplayStatus,
  ContractEntitlement,
  ContractSummary,
  CoverageResult,
  CoverageVerdict,
  EntitlementState,
} from "@/lib/amc/contracts";
import type { SlaDefinition } from "@/lib/amc/sla";
import type { SignedCommitments } from "@/lib/amc/commitments";
import type { AmcNotificationSettings } from "@/lib/amc/notifications";
import type { InAppNotification } from "@/lib/server/amc/notifications";
import type { SignedArchiveRecord } from "@/lib/server/amc/signed-archive";
import type { AssessmentPhoto } from "@/lib/server/amc/assessment-photos";
import type { SweepResult } from "@/lib/server/amc/reminders";
import type { activationPreview } from "@/lib/server/amc/contracts";
import type {
  ContractFsmActivity,
  FsmWorkOrderForAmc,
  SyncOutcome,
  fsmContextForWorkOrder,
  serviceMappingOverview,
} from "@/lib/server/amc/fsm-integration";
import type {
  AmcReports,
  AssessmentRecord,
  ChecklistItem,
  CommercialHistory,
  CustomerOverview,
  CustomerRecord,
  PropertyOverview,
  PropertyRecord,
  QuoteRecord,
} from "@/lib/server/amc/business";
import type { AdditionalServiceEligibility, DiscountConfig } from "@/lib/amc/business";
import type {
  ContractsDashboard,
  ReminderPlan,
  RenewalOverview,
  UsageEntry,
} from "@/lib/server/amc/contract-operations";

/**
 * Browser calls for AMC contracts. Everything goes through
 * /api/amc-contracts, which checks the caller and writes with the service
 * role: the browser never touches the contract tables.
 */

export type { ContractsDashboard, ReminderPlan, RenewalOverview, UsageEntry };
export type { AmcNotificationSettings, AssessmentPhoto, InAppNotification, SignedArchiveRecord, SweepResult };
export type ActivationPreview = Awaited<ReturnType<typeof activationPreview>>;
export type { ContractFsmActivity, FsmWorkOrderForAmc, SyncOutcome };
export type {
  AmcReports,
  AssessmentRecord,
  ChecklistItem,
  CommercialHistory,
  CustomerOverview,
  CustomerRecord,
  PropertyOverview,
  PropertyRecord,
  QuoteRecord,
  AdditionalServiceEligibility,
  DiscountConfig,
};
export type LiveLinks = { migrated: boolean; customer: CustomerRecord | null; property: PropertyRecord | null };
export type CustomerInput = { name: string; customerRef?: string | null; company?: string | null; email?: string | null; phone?: string | null; notes?: string | null };
export type PropertyInput = {
  label: string;
  address?: string | null;
  community?: string | null;
  propertyCategory?: "residential" | "commercial" | null;
  unitType?: "villa" | "apartment" | "townhouse" | "office" | "other" | null;
  bedrooms?: number | null;
  sizeSqft?: number | null;
  notes?: string | null;
};
export type AdditionalServiceRequest = {
  serviceKey: string;
  serviceLabel: string;
  amcServiceId?: string | null;
  category?: string | null;
  date: string;
  standardPrice: number | null;
  notes?: string | null;
};
export type FsmServiceMappingOverview = Awaited<ReturnType<typeof serviceMappingOverview>> & { canEdit?: boolean };
export type FsmWorkOrderContext = Awaited<ReturnType<typeof fsmContextForWorkOrder>>;

export type ContractListStatus =
  | "all"
  | "pending_activation"
  | "not_started"
  | "active"
  | "expiring"
  | "expired"
  | "cancelled";

export type ContractSortKey = "contract" | "customer" | "property" | "start" | "end" | "value";

export interface ContractListRow {
  kind: "contract" | "pending";
  id: string;
  submissionId: string;
  proposalNumber: string;
  customerName: string;
  propertyLabel: string;
  accountManagers: string[];
  startDate: string | null;
  endDate: string | null;
  displayStatus: ContractDisplayStatus;
  expiryLabel: string;
  grandTotal: number;
  daysRemaining: number | null;
  /** Null for proposals still waiting for activation. */
  coverage: {
    totalServices: number;
    withRemaining: number;
    exhausted: number;
    unlimited: number;
    informational: number;
  } | null;
  canActivate: boolean;
}

export interface ContractListResponse {
  rows: ContractListRow[];
  totalCount: number;
  counts: Partial<Record<ContractListStatus, number>>;
  managers: string[];
  canApprove: boolean;
}

export type SlaTarget = SlaDefinition & { state: "unknown" };

export interface ContractDetail {
  contract: {
    id: string;
    submissionId: string;
    proposalNumber: string;
    status: "active" | "cancelled";
    displayStatus: Exclude<ContractDisplayStatus, "pending_activation">;
    daysRemaining: number | null;
    customerName: string;
    customerRef: string | null;
    propertyLabel: string;
    customer: Record<string, unknown>;
    property: Record<string, unknown>;
    accountManagers: Array<{ name: string; phone: string }>;
    startDate: string;
    endDate: string;
    termMonths: number | null;
    currency: string;
    subtotal: number;
    discountPercent: number;
    discountAmount: number;
    finalPrice: number;
    vatAmount: number;
    grandTotal: number;
    signedAt: string;
    signedByName: string;
    renewedFromContractId: string | null;
    renewedByContractId: string | null;
    activatedAt: string;
    cancelledAt: string | null;
    cancellationReason: string | null;
  };
  expiryLabel: string;
  summary: ContractSummary;
  entitlements: Array<
    ContractEntitlement & {
      id: string;
      remainingQuantity: number | null;
      usagePercent: number | null;
      usageLabel: string;
      consumable: boolean;
      state: EntitlementState;
    }
  >;
  sla: SlaTarget[];
  /** Present once the API serves it; older responses lack it. */
  commitments?: SignedCommitments;
  audit: Array<{
    id: string;
    type: string;
    actor: string | null;
    note: string | null;
    payload: Record<string, unknown> | null;
    at: string;
  }>;
  source: {
    id: string;
    proposal_number: string;
    status: string;
    signed_at: string | null;
    signed_by_name: string | null;
    proposal_sent_at: string | null;
    contract_sent_at: string | null;
  } | null;
  permissions: { canRecordUsage: boolean; canCorrect: boolean; canCancel: boolean; canRenew: boolean };
}

export interface CoverageCheckResponse {
  coverage: CoverageResult;
  verdict: { verdict: CoverageVerdict; headline: string; details: string[] };
  date: string;
  sla: SlaTarget | null;
}

export interface CoverageCatalogueItem {
  id: string;
  label: string;
  callOutClass: "emergency" | "non_emergency" | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  }
  return body as T;
}

export const amcContractsService = {
  list(params: {
    status: ContractListStatus;
    search?: string;
    manager?: string;
    sort?: ContractSortKey;
    dir?: "asc" | "desc";
    page: number;
    pageSize: number;
  }) {
    const query = new URLSearchParams({
      status: params.status,
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.search) query.set("search", params.search);
    if (params.manager) query.set("manager", params.manager);
    if (params.sort) query.set("sort", params.sort);
    if (params.dir) query.set("dir", params.dir);
    return request<ContractListResponse>(`/api/amc-contracts?${query.toString()}`);
  },
  summary() {
    return request<{ summary: ContractsDashboard }>("/api/amc-contracts/summary");
  },
  get(id: string) {
    return request<ContractDetail>(`/api/amc-contracts/${id}`);
  },
  activationPreview(submissionId: string) {
    return request<{ preview: ActivationPreview }>(
      `/api/amc-contracts/activation-preview?submissionId=${encodeURIComponent(submissionId)}`,
    );
  },
  activate(input: { submissionId: string; startDate: string; endDate: string; confirmed: true }) {
    return request<{ contract: { id: string } }>("/api/amc-contracts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  usage(id: string, params: { page: number; pageSize: number; entitlementId?: string | null }) {
    const query = new URLSearchParams({ page: String(params.page), pageSize: String(params.pageSize) });
    if (params.entitlementId) query.set("entitlementId", params.entitlementId);
    return request<{ rows: UsageEntry[]; totalCount: number }>(`/api/amc-contracts/${id}/usage?${query.toString()}`);
  },
  recordUsage(
    id: string,
    input: {
      entitlementId: string;
      quantity: number;
      occurredAt: string;
      externalType?: "fsm_work_order" | "fsm_appointment" | null;
      externalReference?: string | null;
      notes?: string | null;
    },
  ) {
    return request<{ usage: { id: string } }>(`/api/amc-contracts/${id}/usage`, {
      method: "POST",
      body: JSON.stringify({ ...input, kind: "consumption" }),
    });
  },
  correctUsage(id: string, usageId: string, input: { amount: number; reason: string }) {
    return request<{ correction: UsageEntry }>(`/api/amc-contracts/${id}/usage/${usageId}/correction`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  cancel(id: string, reason: string) {
    return request<{ contract: { id: string } }>(`/api/amc-contracts/${id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  },
  renewal(id: string) {
    return request<{ renewal: RenewalOverview }>(`/api/amc-contracts/${id}/renewal`);
  },
  startRenewal(id: string) {
    return request<{ submissionId: string; droppedServiceIds: string[] }>(
      `/api/amc-contracts/${id}/renewal`,
      { method: "POST" },
    );
  },
  reminders(id: string) {
    return request<{ reminders: ReminderPlan }>(`/api/amc-contracts/${id}/reminders`);
  },
  createReminders(id: string) {
    return request<{ reminders: ReminderPlan }>(`/api/amc-contracts/${id}/reminders`, { method: "POST" });
  },
  fsm(id: string) {
    return request<{ fsm: ContractFsmActivity }>(`/api/amc-contracts/${id}/fsm`);
  },
  fsmWorkOrder(ref: string, contractId?: string) {
    const query = new URLSearchParams({ ref });
    if (contractId) query.set("contractId", contractId);
    return request<{ workOrder: FsmWorkOrderForAmc }>(`/api/amc-contracts/fsm/work-order?${query.toString()}`);
  },
  fsmContext(workOrderId: string, date?: string) {
    const query = new URLSearchParams({ workOrderId });
    if (date) query.set("date", date);
    return request<{ context: FsmWorkOrderContext }>(`/api/amc-contracts/fsm/context?${query.toString()}`);
  },
  linkFsmCustomer(id: string, workOrderId: string) {
    return request<{ customer: { fsmContactId: string; fsmContactName: string | null; fsmCustomerId: string | null; matchesProposalCustomerId: boolean | null } }>(
      `/api/amc-contracts/${id}/fsm/customer`,
      { method: "POST", body: JSON.stringify({ workOrderId }) },
    );
  },
  linkFsmWork(
    id: string,
    input: { workOrderId: string; appointmentId?: string | null; serviceLineItemId?: string | null; entitlementId: string; requestedAt?: string | null },
  ) {
    return request<{ verdict: { verdict: string; headline: string; details: string[] } }>(`/api/amc-contracts/${id}/fsm/links`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  unlinkFsmWork(id: string, linkId: string, reason: string) {
    return request<{ ok: true }>(`/api/amc-contracts/${id}/fsm/links/${linkId}`, {
      method: "DELETE",
      body: JSON.stringify({ reason }),
    });
  },
  checkFsm(id: string) {
    return request<{ checked: number; outcomes: SyncOutcome[] }>(`/api/amc-contracts/${id}/fsm/check`, { method: "POST" });
  },
  syncFsmAppointment(id: string, appointmentId: string, input: { confirm?: boolean; quantity?: number | null } = {}) {
    return request<{ outcome: SyncOutcome }>(`/api/amc-contracts/${id}/fsm/appointments/${encodeURIComponent(appointmentId)}`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  fsmServices() {
    return request<FsmServiceMappingOverview>("/api/amc-contracts/fsm/services");
  },
  saveFsmService(input: { amcServiceId: string; fsmServiceId: string | null; fsmServiceName?: string | null; active: boolean }) {
    return request<FsmServiceMappingOverview>("/api/amc-contracts/fsm/services", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  /* Customers and properties */
  customers(q = "") {
    return request<{ customers: CustomerRecord[] }>(`/api/amc-contracts/customers?q=${encodeURIComponent(q)}`);
  },
  createCustomer(input: CustomerInput) {
    return request<{ customer: CustomerRecord }>("/api/amc-contracts/customers", { method: "POST", body: JSON.stringify(input) });
  },
  updateCustomer(id: string, input: CustomerInput) {
    return request<{ customer: CustomerRecord }>(`/api/amc-contracts/customers/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  customer(id: string) {
    return request<{ overview: CustomerOverview }>(`/api/amc-contracts/customers/${id}`);
  },
  customerProperties(id: string) {
    return request<{ properties: PropertyRecord[] }>(`/api/amc-contracts/customers/${id}/properties`);
  },
  createProperty(customerId: string, input: PropertyInput) {
    return request<{ property: PropertyRecord }>(`/api/amc-contracts/customers/${customerId}/properties`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  updateProperty(id: string, input: PropertyInput) {
    return request<{ property: PropertyRecord }>(`/api/amc-contracts/properties/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  },
  property(id: string) {
    return request<{ overview: PropertyOverview }>(`/api/amc-contracts/properties/${id}`);
  },
  links(contractId: string) {
    return request<{ links: LiveLinks }>(`/api/amc-contracts/${contractId}/links`);
  },
  setLink(contractId: string, input: { kind: "customer" | "property"; id?: string | null; createFromSnapshot?: boolean }) {
    return request<{ links: LiveLinks }>(`/api/amc-contracts/${contractId}/links`, { method: "PUT", body: JSON.stringify(input) });
  },
  /* Commercial */
  commercial(contractId: string) {
    return request<{ commercial: CommercialHistory }>(`/api/amc-contracts/${contractId}/commercial`);
  },
  checkAdditionalService(contractId: string, input: AdditionalServiceRequest) {
    return request<{ eligibility: AdditionalServiceEligibility }>(`/api/amc-contracts/${contractId}/additional-services`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  createQuote(contractId: string, input: AdditionalServiceRequest) {
    return request<{ quote: QuoteRecord }>(`/api/amc-contracts/${contractId}/quotes`, { method: "POST", body: JSON.stringify(input) });
  },
  updateQuote(contractId: string, quoteId: string, input: { action: "link_estimate"; estimateNumber: string } | { action: "cancel"; reason: string }) {
    return request<{ quote: QuoteRecord }>(`/api/amc-contracts/${contractId}/quotes/${quoteId}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    });
  },
  /* Assessments */
  assessments(params: { status?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.q) query.set("q", params.q);
    if (params.page) query.set("page", String(params.page));
    if (params.pageSize) query.set("pageSize", String(params.pageSize));
    return request<{ assessments: AssessmentRecord[]; total: number; page: number; pageSize: number }>(
      `/api/amc-contracts/assessments?${query.toString()}`,
    );
  },
  assessment(id: string) {
    return request<{ assessment: AssessmentRecord; canEdit: boolean }>(`/api/amc-contracts/assessments/${id}`);
  },
  createAssessment(input: { customerId: string | null; propertyId: string | null; contractId?: string | null }) {
    return request<{ assessment: AssessmentRecord }>("/api/amc-contracts/assessments", { method: "POST", body: JSON.stringify(input) });
  },
  updateAssessment(id: string, patch: Record<string, unknown>) {
    return request<{ assessment: AssessmentRecord }>(`/api/amc-contracts/assessments/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
  },
  deleteAssessment(id: string) {
    return request<{ ok: true }>(`/api/amc-contracts/assessments/${id}`, { method: "DELETE" });
  },
  completeAssessment(id: string) {
    return request<{ assessment: AssessmentRecord }>(`/api/amc-contracts/assessments/${id}/complete`, { method: "POST" });
  },
  proposalFromAssessment(id: string) {
    return request<{ submissionId: string; proposalNumber: string; droppedServiceIds: string[] }>(
      `/api/amc-contracts/assessments/${id}/proposal`,
      { method: "POST" },
    );
  },
  /* Settings */
  checklist() {
    return request<{ items: ChecklistItem[]; canEdit: boolean }>("/api/amc-contracts/settings/checklist");
  },
  saveChecklistItem(input: { itemKey?: string | null; categoryLabel: string; label: string; sortOrder?: number; active: boolean }) {
    return request<{ items: ChecklistItem[]; canEdit: boolean }>("/api/amc-contracts/settings/checklist", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  discountConfig() {
    return request<{ config: DiscountConfig & { migrated: boolean }; canEdit: boolean }>("/api/amc-contracts/settings/discount");
  },
  saveDiscountConfig(input: DiscountConfig) {
    return request<{ config: DiscountConfig & { migrated: boolean }; canEdit: boolean }>("/api/amc-contracts/settings/discount", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  /* Reports */
  reports(filters: { manager?: string; customer?: string; property?: string } = {}) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) query.set(k, v);
    return request<{ reports: AmcReports }>(`/api/amc-contracts/reports?${query.toString()}`);
  },
  coverageCatalogue() {
    return request<{ catalogue: CoverageCatalogueItem[] }>("/api/amc-contracts/coverage?catalogue=1");
  },
  coverage(params: { contractId?: string; customerRef?: string; serviceId: string; date?: string }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return request<CoverageCheckResponse>(`/api/amc-contracts/coverage?${query.toString()}`);
  },
  /* Notifications (in-app) */
  notifications() {
    return request<{ notifications: InAppNotification[]; unread: number; migrated: boolean }>("/api/amc-notifications");
  },
  markNotificationsRead(input: { all: true } | { ids: string[] }) {
    return request<{ ok: true }>("/api/amc-notifications", { method: "POST", body: JSON.stringify(input) });
  },
  notificationSettings() {
    return request<{ settings: AmcNotificationSettings; canEdit: boolean }>("/api/amc-contracts/settings/notifications");
  },
  saveNotificationSettings(input: AmcNotificationSettings) {
    return request<{ settings: AmcNotificationSettings; canEdit: boolean }>("/api/amc-contracts/settings/notifications", {
      method: "PUT",
      body: JSON.stringify(input),
    });
  },
  runReminders() {
    return request<SweepResult>("/api/amc-contracts/reminders", { method: "POST", body: "{}" });
  },
  /* The archived signed contract */
  signedDocument(submissionId: string, open = false) {
    return request<{ archive: SignedArchiveRecord | null; url: string | null; signed: boolean }>(
      `/api/amc-submissions/signed-document?id=${encodeURIComponent(submissionId)}${open ? "&open=1" : ""}`,
    );
  },
  archiveSignedDocument(submissionId: string) {
    return request<{ archive: SignedArchiveRecord }>("/api/amc-submissions/signed-document", {
      method: "POST",
      body: JSON.stringify({ id: submissionId }),
    });
  },
  /* Assessment photos */
  assessmentPhotos(assessmentId: string) {
    return request<{ photos: AssessmentPhoto[]; migrated: boolean }>(`/api/amc-contracts/assessments/${assessmentId}/photos`);
  },
  async addAssessmentPhoto(assessmentId: string, file: File, caption?: string) {
    const form = new FormData();
    form.append("file", file);
    if (caption) form.append("caption", caption);
    /* Not request(): the browser sets the multipart boundary itself. */
    const response = await fetch(`/api/amc-contracts/assessments/${assessmentId}/photos`, { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not add the photo");
    return body as { photo: AssessmentPhoto };
  },
  removeAssessmentPhoto(assessmentId: string, photoId: string) {
    return request<{ ok: true }>(`/api/amc-contracts/assessments/${assessmentId}/photos/${photoId}`, { method: "DELETE" });
  },
};
