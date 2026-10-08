import type { z } from "zod";

import type { BalanceSummary, ChequeStatus, paymentActionSchema } from "@/lib/amc/payments";
import type {
  ChequeRecord,
  ContractPayments,
  ContractRef,
  InstalmentFilter,
  InstalmentRecord,
  PaymentRecord,
} from "@/lib/server/amc/payments";

/**
 * Browser calls for AMC payments (Phase 7). A contract's schedule, cheques
 * and receipts go through /api/amc-contracts/<id>/payments; Finance's
 * views across contracts through /api/amc-payments. The server checks who
 * may do what; the permissions it returns only decide what is offered.
 */

export type { BalanceSummary, ChequeRecord, ContractPayments, ContractRef, InstalmentRecord, PaymentRecord };

/** What a screen sends: the schema's input, before its defaults and trims. */
export type PaymentActionInput = z.input<typeof paymentActionSchema>;

export interface PaymentPermissions {
  canRecord: boolean;
  canEdit: boolean;
  canApprove: boolean;
}

export type ContractPaymentsResponse = ContractPayments & { permissions: PaymentPermissions };

export interface PaymentActionResult {
  ok: true;
  /** For a reminder: the WhatsApp text prepared for the coordinator. */
  message?: string;
  /** For a reminder: a wa.me link with that text, when the client has a phone. */
  whatsapp?: string | null;
  /** For a reminder: what happened to the email. */
  outcome?: "sent" | "failed" | "no_recipient" | string;
}

export type InstalmentListRow = InstalmentRecord & { contract: ContractRef | null };
export type ChequeListRow = ChequeRecord & { contract: ContractRef | null; instalmentNo: number | null };

/** Keeps the HTTP status, so a screen can tell "not allowed" (403) from a failure. */
export class PaymentsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PaymentsRequestError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new PaymentsRequestError(typeof body?.error === "string" ? body.error : "Something went wrong", response.status);
  }
  return body as T;
}

type ListParams = { q?: string; clientId?: string; page?: number; pageSize?: number };

function listQuery(view: "instalments" | "cheques", status: string | null | undefined, params: ListParams) {
  const query = new URLSearchParams({ view });
  if (status) query.set("status", status);
  if (params.q) query.set("q", params.q);
  if (params.clientId) query.set("clientId", params.clientId);
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  return `/api/amc-payments?${query.toString()}`;
}

export const paymentsService = {
  contractPayments(contractId: string) {
    return request<ContractPaymentsResponse>(`/api/amc-contracts/${contractId}/payments`);
  },
  paymentAction(contractId: string, action: PaymentActionInput) {
    return request<PaymentActionResult>(`/api/amc-contracts/${contractId}/payments`, {
      method: "POST",
      body: JSON.stringify(action),
    });
  },
  /* page is 1-based, as the route reads it. */
  listInstalments(params: ListParams & { status?: InstalmentFilter } = {}) {
    return request<{ migrated: boolean; instalments: InstalmentListRow[]; total: number; summary: BalanceSummary }>(
      listQuery("instalments", params.status, params),
    );
  },
  listCheques(params: ListParams & { status?: ChequeStatus | null } = {}) {
    return request<{ migrated: boolean; cheques: ChequeListRow[]; total: number }>(listQuery("cheques", params.status, params));
  },
};
