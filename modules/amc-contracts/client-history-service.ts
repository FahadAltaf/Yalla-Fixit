import type {
  assetHistory,
  clientAdditionalWorkTotals,
  clientPaymentsReceived,
  clientSchedule,
  clientServiceHistory,
} from "@/lib/server/amc/client-history";
import type { CustomerRecord } from "@/lib/server/amc/business";

/**
 * Browser calls for a client's history across their contracts (BRD 5.9)
 * and an asset's own history (BRD 5.2). Read only, except the FSM contact
 * id, which goes through the client's ordinary update.
 */

export type ClientScheduleVisit = Awaited<ReturnType<typeof clientSchedule>>["visits"][number];
export type ServiceHistoryEntry = Awaited<ReturnType<typeof clientServiceHistory>>["entries"][number];
export type ClientPaymentReceived = Awaited<ReturnType<typeof clientPaymentsReceived>>["payments"][number];
export type AdditionalWorkTotals = Awaited<ReturnType<typeof clientAdditionalWorkTotals>>;
export type AssetHistory = NonNullable<Awaited<ReturnType<typeof assetHistory>>>;

/** Keeps the HTTP status, so a screen can tell "not allowed" (403) from a failure. */
export class HistoryRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HistoryRequestError";
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new HistoryRequestError(typeof body?.error === "string" ? body.error : "Something went wrong", response.status);
  return body as T;
}

const historyUrl = (customerId: string, part: "schedule" | "service" | "payments" | "additional_work") =>
  `/api/amc-contracts/customers/${encodeURIComponent(customerId)}/history?part=${part}`;

export const clientHistoryService = {
  schedule(customerId: string) {
    return request<{ visits: ClientScheduleVisit[] }>(historyUrl(customerId, "schedule"));
  },
  service(customerId: string) {
    return request<{ entries: ServiceHistoryEntry[] }>(historyUrl(customerId, "service"));
  },
  /** 403 without AMC Payments (View). */
  payments(customerId: string) {
    return request<{ payments: ClientPaymentReceived[] }>(historyUrl(customerId, "payments"));
  },
  additionalWork(customerId: string) {
    return request<AdditionalWorkTotals>(historyUrl(customerId, "additional_work"));
  },
  asset(propertyId: string, assetId: string) {
    return request<AssetHistory>(
      `/api/amc-contracts/properties/${encodeURIComponent(propertyId)}/assets/${encodeURIComponent(assetId)}/history`,
    );
  },
  /** Opens the visit's stored service report (the route redirects to a short-lived link). */
  visitReportUrl(visitId: string) {
    return `/api/amc-visits/${encodeURIComponent(visitId)}/job-sheet/report`;
  },
  /**
   * Links the client to their FSM customer (Contact id). The update writes
   * the shared client's name and contact fields too, so they are sent as
   * they are; everything else is left out and stays unchanged.
   */
  setFsmContact(customer: Pick<CustomerRecord, "id" | "name" | "company" | "email" | "phone" | "notes">, fsmContactId: string | null) {
    return request<{ customer: CustomerRecord }>(`/api/amc-contracts/customers/${encodeURIComponent(customer.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: customer.name,
        company: customer.company,
        email: customer.email,
        phone: customer.phone,
        notes: customer.notes,
        fsmContactId: fsmContactId?.trim() || null,
      }),
    });
  },
};
