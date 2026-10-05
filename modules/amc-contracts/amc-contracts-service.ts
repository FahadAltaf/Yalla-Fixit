import type {
  ContractDisplayStatus,
  ContractEntitlement,
  ContractSummary,
  CoverageResult,
  CoverageVerdict,
  EntitlementState,
} from "@/lib/amc/contracts";
import type { SlaDefinition } from "@/lib/amc/sla";
import type { activationPreview } from "@/lib/server/amc/contracts";
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
export type ActivationPreview = Awaited<ReturnType<typeof activationPreview>>;

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
  coverageCatalogue() {
    return request<{ catalogue: CoverageCatalogueItem[] }>("/api/amc-contracts/coverage?catalogue=1");
  },
  coverage(params: { contractId?: string; customerRef?: string; serviceId: string; date?: string }) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
    return request<CoverageCheckResponse>(`/api/amc-contracts/coverage?${query.toString()}`);
  },
};
