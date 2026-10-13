import type { z } from "zod";

import type { amendmentActionSchema, amendmentRequestSchema } from "@/lib/amc/amendments";
import type { RenewalOutcome, renewalOutcomeSchema } from "@/lib/amc/renewal-outcomes";
import type { AmendmentRecord } from "@/lib/server/amc/amendments";
import type { PastYearSummary, RenewalDueRow } from "@/lib/server/amc/renewals";
import type { RenewalOverview } from "@/lib/server/amc/contract-operations";

/**
 * Browser calls for AMC renewals and amendments (Phase 13: DEV-415, 416,
 * 417): the renewals due list, a contract's renewal with last year beside
 * it and its outcome, recording the outcome, and a contract's amendments
 * with their approve / reject / apply / withdraw steps. The server checks
 * who may do what; the `can*` flags only decide what is offered.
 */

export type { AmendmentRecord, PastYearSummary, RenewalDueRow, RenewalOverview };

/** What a screen sends: the schemas' input, before their trims. */
export type RenewalOutcomeBody = z.input<typeof renewalOutcomeSchema>;
export type AmendmentRequestBody = z.input<typeof amendmentRequestSchema>;
export type AmendmentActionBody = z.input<typeof amendmentActionSchema>;

export interface RenewalsDueResponse {
  migrated: boolean;
  today: string;
  leadDays: number;
  escalationPercent: number;
  rows: RenewalDueRow[];
}

export interface RenewalOutcomeState {
  renewal_outcome: RenewalOutcome | null;
  renewal_outcome_reason: string | null;
  renewal_outcome_at: string | null;
  renewal_reminded_at: string | null;
}

export interface ContractRenewalResponse {
  renewal: RenewalOverview;
  pastYear: PastYearSummary;
  outcome: RenewalOutcomeState | null;
  canRecordOutcome: boolean;
}

export interface AmendmentsResponse {
  migrated: boolean;
  amendments: AmendmentRecord[];
  canRequest: boolean;
  canApprove: boolean;
  userId: string;
}

export interface AmendmentActionResult {
  ok: true;
  /** apply: what changed. */
  details?: Record<string, unknown>;
  /** apply on a scope change: the draft proposal it opened. */
  submissionId?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "Something went wrong");
  return body as T;
}

const contractUrl = (id: string) => `/api/amc-contracts/${encodeURIComponent(id)}`;

/** Where a draft proposal opens for editing (the renewal tab links the same way). */
export const proposalEditHref = (submissionId: string) => `/extensions/amc/${submissionId}/edit`;
export const proposalHref = (submissionId: string) => `/extensions/amc/${submissionId}`;

export const renewalsService = {
  due() {
    return request<RenewalsDueResponse>("/api/amc-renewals");
  },
  renewal(contractId: string) {
    return request<ContractRenewalResponse>(`${contractUrl(contractId)}/renewal`);
  },
  startRenewal(contractId: string) {
    return request<{ submissionId: string; droppedServiceIds: string[] }>(`${contractUrl(contractId)}/renewal`, { method: "POST" });
  },
  recordOutcome(contractId: string, body: RenewalOutcomeBody) {
    return request<{ ok: true }>(`${contractUrl(contractId)}/renewal/outcome`, { method: "POST", body: JSON.stringify(body) });
  },
  amendments(contractId: string) {
    return request<AmendmentsResponse>(`${contractUrl(contractId)}/amendments`);
  },
  requestAmendment(contractId: string, body: AmendmentRequestBody) {
    return request<{ id: string }>(`${contractUrl(contractId)}/amendments`, { method: "POST", body: JSON.stringify(body) });
  },
  amendmentAction(contractId: string, amendmentId: string, body: AmendmentActionBody) {
    return request<AmendmentActionResult>(`${contractUrl(contractId)}/amendments/${encodeURIComponent(amendmentId)}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
};
