import type { ClientReport } from "@/lib/server/amc/client-report";
import type { commercialReport, managementDashboard, operationalReport } from "@/lib/server/amc/insights";

/**
 * Browser calls for the AMC management dashboard, the operational and
 * commercial reports (Phase 12: DEV-411, 412, 414) and a contract's client
 * report (DEV-410). The server scopes every figure to the contracts the
 * caller may see and checks who may send; nothing here decides access.
 */

export type ManagementDashboard = Awaited<ReturnType<typeof managementDashboard>>;
export type OperationalReport = Awaited<ReturnType<typeof operationalReport>>;
export type CommercialReport = Awaited<ReturnType<typeof commercialReport>>;
export type { ClientReport };

export type ClientReportOutcome = "sent" | "failed" | "no_recipient";

export interface ClientReportSendResult {
  outcome: ClientReportOutcome;
  documentId: string;
  /** The prepared WhatsApp text. */
  message: string;
  /** A wa.me link, or null without a phone number on file. */
  whatsapp: string | null;
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

const insightsUrl = (view: string, period?: { from: string; to: string }) => {
  const query = new URLSearchParams({ view });
  if (period) {
    query.set("from", period.from);
    query.set("to", period.to);
  }
  return `/api/amc-insights?${query.toString()}`;
};

const reportUrl = (contractId: string) => `/api/amc-contracts/${encodeURIComponent(contractId)}/client-report`;

export const insightsService = {
  dashboard() {
    return request<{ dashboard: ManagementDashboard }>(insightsUrl("dashboard"));
  },
  operational(from: string, to: string) {
    return request<{ report: OperationalReport }>(insightsUrl("operational", { from, to }));
  },
  commercial(from: string, to: string) {
    return request<{ report: CommercialReport }>(insightsUrl("commercial", { from, to }));
  },
  /** Opens in a new tab: the report as a page, to preview or print. */
  clientReportHref(contractId: string) {
    return reportUrl(contractId);
  },
  clientReport(contractId: string) {
    return request<{ report: ClientReport }>(`${reportUrl(contractId)}?format=json`);
  },
  /** Without `to`, the server sends to the client's email on file. */
  sendClientReport(contractId: string, to?: string | null) {
    return request<ClientReportSendResult>(reportUrl(contractId), { method: "POST", body: JSON.stringify(to ? { to } : {}) });
  },
};

/* The same calls as plain functions, for screens that import them one by one. */
export const { dashboard, operational, commercial, clientReportHref, clientReport, sendClientReport } = insightsService;
