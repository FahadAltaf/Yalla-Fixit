import type {
  ContractDisplayStatus,
  ContractEntitlement,
  CoverageResult,
} from "@/lib/amc/contracts";

/**
 * Browser calls for AMC contracts. Everything goes through
 * /api/amc-contracts, which checks the caller and writes with the service
 * role: the browser never touches the contract tables.
 */

export type ContractListStatus =
  | "all"
  | "pending_activation"
  | "not_started"
  | "active"
  | "expiring"
  | "expired"
  | "cancelled";

export interface ContractListRow {
  kind: "contract" | "pending";
  id: string;
  submissionId: string;
  proposalNumber: string;
  customerName: string;
  propertyLabel: string;
  accountManager: string;
  startDate: string | null;
  endDate: string | null;
  displayStatus: ContractDisplayStatus;
  grandTotal: number;
  daysRemaining: number | null;
  canActivate: boolean;
}

export interface ContractListResponse {
  rows: ContractListRow[];
  totalCount: number;
  counts: Partial<Record<ContractListStatus, number>>;
  canApprove: boolean;
}

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
  entitlements: Array<
    ContractEntitlement & {
      id: string;
      remainingQuantity: number | null;
      usagePercent: number | null;
      usageLabel: string;
      consumable: boolean;
    }
  >;
  usage: Array<{
    id: string;
    entitlementId: string;
    kind: "consumption" | "adjustment";
    quantity: number;
    occurredAt: string;
    source: string;
    externalType: string | null;
    externalReference: string | null;
    notes: string | null;
    createdAt: string;
    createdBy: string | null;
  }>;
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
  } | null;
  permissions: { canRecordUsage: boolean; canCancel: boolean; canRenew: boolean };
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
  list(params: { status: ContractListStatus; search?: string; page: number; pageSize: number }) {
    const query = new URLSearchParams({
      status: params.status,
      page: String(params.page),
      pageSize: String(params.pageSize),
    });
    if (params.search) query.set("search", params.search);
    return request<ContractListResponse>(`/api/amc-contracts?${query.toString()}`);
  },
  get(id: string) {
    return request<ContractDetail>(`/api/amc-contracts/${id}`);
  },
  activate(input: { submissionId: string; startDate: string; endDate: string }) {
    return request<{ contract: { id: string } }>("/api/amc-contracts", {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
  recordUsage(
    id: string,
    input: {
      entitlementId: string;
      kind: "consumption" | "adjustment";
      quantity: number;
      occurredAt: string;
      externalType?: "fsm_work_order" | "fsm_appointment" | null;
      externalReference?: string | null;
      notes?: string | null;
    },
  ) {
    return request<{ usage: { id: string } }>(`/api/amc-contracts/${id}/usage`, {
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
  startRenewal(id: string) {
    return request<{ submissionId: string; droppedServiceIds: string[] }>(
      `/api/amc-contracts/${id}/renewal`,
      { method: "POST" },
    );
  },
  coverage(params: { customerRef: string; serviceId: string; date?: string }) {
    const query = new URLSearchParams(params as Record<string, string>);
    return request<{ coverage: CoverageResult }>(`/api/amc-contracts/coverage?${query.toString()}`);
  },
};
